import { SenderError, t } from 'spacetimedb/server';
import spacetimedb from './schema';

export { default } from './schema';

const ROOM_STATUSES = new Set(['open', 'running', 'closed']);

export const init = spacetimedb.init((_ctx) => {
	// Room entries are registered by the room provisioning service.
});

export const registerRoom = spacetimedb.reducer(
	{
		databaseName: t.string(),
		name: t.string(),
		classification: t.string(),
		description: t.string(),
		rules: t.array(t.string()),
		accent: t.string(),
		seed: t.u32(),
		width: t.u32(),
		height: t.u32(),
		playerCount: t.u8(),
		botDifficulty: t.string(),
		timerMinutes: t.u8(),
		botCommandPostStacks: t.u32()
	},
	(ctx, args) => {
		if (args.databaseName.trim().length === 0) {
			throw new SenderError('database name is required');
		}
		if (ctx.db.roomDirectory.databaseName.find(args.databaseName)) {
			throw new SenderError('room is already registered');
		}
		ctx.db.roomDirectory.insert({
			databaseName: args.databaseName,
			name: args.name,
			classification: args.classification,
			description: args.description,
			rules: args.rules,
			accent: args.accent,
			status: 'open',
			seed: args.seed,
			width: args.width,
			height: args.height,
			playerCount: args.playerCount,
			botDifficulty: args.botDifficulty,
			timerMinutes: args.timerMinutes,
			botCommandPostStacks: args.botCommandPostStacks,
			host: ctx.sender,
			createdAt: ctx.timestamp,
			updatedAt: ctx.timestamp
		});
	}
);

export const setRoomStatus = spacetimedb.reducer(
	{ databaseName: t.string(), status: t.string() },
	(ctx, { databaseName, status }) => {
		if (!ROOM_STATUSES.has(status)) throw new SenderError('invalid room status');
		const room = ctx.db.roomDirectory.databaseName.find(databaseName);
		if (!room) throw new SenderError('room is not registered');
		if (!room.host.isEqual(ctx.sender)) throw new SenderError('only the host can update the room');
		ctx.db.roomDirectory.databaseName.update({
			...room,
			status,
			updatedAt: ctx.timestamp
		});
	}
);

export const removeRoom = spacetimedb.reducer(
	{ databaseName: t.string() },
	(ctx, { databaseName }) => {
		const room = ctx.db.roomDirectory.databaseName.find(databaseName);
		if (!room) return;
		if (!room.host.isEqual(ctx.sender)) throw new SenderError('only the host can remove the room');
		ctx.db.roomDirectory.databaseName.delete(databaseName);
	}
);
