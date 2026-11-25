import { ScheduleAt } from 'spacetimedb';
import { SenderError, t, type InferSchema, type ReducerCtx } from 'spacetimedb/server';
import spacetimedb, { heartbeatTimers } from './schema';

export { default } from './schema';

const TICK_MICROS = 100_000n;
const HEARTBEAT_INTERVAL_TICKS = 10n;
const HEARTBEAT_TYPE = 'heartbeat';

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;

function currentRoom(ctx: Ctx) {
	for (const room of ctx.db.rooms.iter()) return room;
	return null;
}

function requireRoom(ctx: Ctx) {
	const room = currentRoom(ctx);
	if (!room) throw new SenderError('room has not been created');
	return room;
}

function currentSeat(ctx: Ctx) {
	return ctx.db.seats.identity.find(ctx.sender);
}

function requireSeat(ctx: Ctx) {
	const seat = currentSeat(ctx);
	if (!seat) throw new SenderError('caller is not seated in this room');
	return seat;
}

function tickFor(
	room: { startedAt: { microsSinceUnixEpoch: bigint } | undefined },
	ctx: Ctx
): bigint {
	if (!room.startedAt) return 0n;
	const elapsed = ctx.timestamp.microsSinceUnixEpoch - room.startedAt.microsSinceUnixEpoch;
	return elapsed <= 0n ? 0n : elapsed / TICK_MICROS;
}

function appendTransaction(
	ctx: Ctx,
	seatId: bigint,
	playerId: number,
	clientSequence: bigint,
	type: string,
	data: number[],
	tick: bigint,
	status: string
) {
	const row = ctx.db.ledgerTransactions.insert({
		rowIndex: 0n,
		tick,
		seatId,
		playerId,
		clientSequence,
		type,
		data,
		status,
		createdAt: ctx.timestamp
	});
	const room = requireRoom(ctx);
	if (tick > room.headTick) {
		ctx.db.rooms.roomCode.update({ ...room, headTick: tick });
	}
	ctx.db.newTransactionEvent.insert({ rowIndex: row.rowIndex, tick });
	return row;
}

export const init = spacetimedb.init((_ctx) => {
	// One database per room; no seed rows are needed here.
});

export const onConnect = spacetimedb.clientConnected((ctx) => {
	const seat = currentSeat(ctx);
	if (!seat) return;
	ctx.db.seats.seatId.update({ ...seat, connected: true });
});

export const onDisconnect = spacetimedb.clientDisconnected((ctx) => {
	const seat = currentSeat(ctx);
	if (!seat) return;
	ctx.db.seats.seatId.update({ ...seat, connected: false });
});

export const createRoom = spacetimedb.reducer(
	{
		roomCode: t.string(),
		hostName: t.string(),
		seed: t.u32(),
		width: t.u32(),
		height: t.u32(),
		playerCount: t.u8(),
		botDifficulty: t.string(),
		timerMinutes: t.u8(),
		botCommandPostStacks: t.u32(),
		version: t.string()
	},
	(ctx, args) => {
		if (currentRoom(ctx)) throw new SenderError('this database already has a room');
		if (args.roomCode.trim().length === 0) throw new SenderError('room code is required');
		if (args.playerCount < 2) throw new SenderError('player count must be at least 2');
		ctx.db.rooms.insert({
			roomCode: args.roomCode,
			host: ctx.sender,
			status: 'waiting',
			seed: args.seed,
			width: args.width,
			height: args.height,
			playerCount: args.playerCount,
			botDifficulty: args.botDifficulty,
			timerMinutes: args.timerMinutes,
			botCommandPostStacks: args.botCommandPostStacks,
			version: args.version,
			startedAt: undefined,
			endedAt: undefined,
			headTick: 0n
		});
		ctx.db.seats.insert({
			seatId: 0n,
			identity: ctx.sender,
			playerId: 1,
			name: args.hostName,
			isHost: true,
			connected: true,
			ready: false,
			joinedAt: ctx.timestamp
		});
	}
);

export const joinRoom = spacetimedb.reducer({ name: t.string() }, (ctx, { name }) => {
	const room = requireRoom(ctx);
	if (room.status !== 'waiting') throw new SenderError('room is no longer accepting players');
	const existing = currentSeat(ctx);
	if (existing) {
		ctx.db.seats.seatId.update({ ...existing, name, connected: true });
		return;
	}
	const seats = [...ctx.db.seats.iter()];
	if (seats.length >= room.playerCount) throw new SenderError('room is full');
	const used = new Set(seats.map((seat) => seat.playerId));
	let playerId = 0;
	for (let candidate = 1; candidate <= room.playerCount; candidate++) {
		if (!used.has(candidate)) {
			playerId = candidate;
			break;
		}
	}
	if (playerId === 0) throw new SenderError('no player slot available');
	ctx.db.seats.insert({
		seatId: 0n,
		identity: ctx.sender,
		playerId,
		name,
		isHost: false,
		connected: true,
		ready: false,
		joinedAt: ctx.timestamp
	});
});

export const setReady = spacetimedb.reducer({ ready: t.bool() }, (ctx, { ready }) => {
	const seat = requireSeat(ctx);
	ctx.db.seats.seatId.update({ ...seat, ready });
});

export const startMatch = spacetimedb.reducer((ctx) => {
	const room = requireRoom(ctx);
	if (room.status !== 'waiting') throw new SenderError('match already started or ended');
	if (!room.host.isEqual(ctx.sender)) throw new SenderError('only the host can start');
	const seats = [...ctx.db.seats.iter()];
	if (seats.length === 0) throw new SenderError('a room needs at least one seated player');
	ctx.db.rooms.roomCode.update({
		...room,
		status: 'running',
		startedAt: ctx.timestamp,
		headTick: 0n
	});
	for (const timer of [...ctx.db.heartbeatTimers.iter()]) {
		ctx.db.heartbeatTimers.scheduledId.delete(timer.scheduledId);
	}
	ctx.db.heartbeatTimers.insert({
		scheduledId: 0n,
		scheduledAt: ScheduleAt.interval(1_000_000n)
	});
});

export const submitTransaction = spacetimedb.reducer(
	{
		clientSequence: t.u64(),
		type: t.string(),
		data: t.array(t.u8())
	},
	(ctx, args) => {
		const room = requireRoom(ctx);
		if (room.status !== 'running') throw new SenderError('room is not running');
		const seat = requireSeat(ctx);
		if (seat.playerId === 0) throw new SenderError('spectators cannot submit transactions');
		if (!seat.connected) throw new SenderError('seat is disconnected');
		if (args.type.length === 0 || args.type === HEARTBEAT_TYPE) {
			throw new SenderError('invalid transaction type');
		}
		const tick = tickFor(room, ctx);
		appendTransaction(
			ctx,
			seat.seatId,
			seat.playerId,
			args.clientSequence,
			args.type,
			args.data,
			tick,
			'provisional'
		);
	}
);

export const leaveRoom = spacetimedb.reducer((ctx) => {
	const seat = currentSeat(ctx);
	if (!seat) return;
	ctx.db.seats.seatId.update({ ...seat, connected: false, ready: false });
});

export const checkLiveness = spacetimedb.reducer(
	{ onSchedule: heartbeatTimers },
	{ timer: heartbeatTimers.rowType },
	(ctx, _args) => {
		if (!ctx.sender.isEqual(ctx.databaseIdentity)) {
			throw new SenderError('heartbeat may only run from the scheduler');
		}
		const room = currentRoom(ctx);
		if (!room || room.status !== 'running') return;
		if (![...ctx.db.seats.iter()].some((seat) => seat.connected)) return;
		const tick = tickFor(room, ctx);
		if (tick - room.headTick < HEARTBEAT_INTERVAL_TICKS) return;
		appendTransaction(ctx, 0n, 0, 0n, HEARTBEAT_TYPE, [], tick, 'final');
	}
);
