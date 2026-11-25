import { schema, table, t } from 'spacetimedb/server';

/**
 * The room database is intentionally one database per match. The coordinator
 * stores no simulation grid: it only orders transactions, tracks presence, and
 * keeps enough liveness metadata for clients to distinguish idle from stale.
 */
export const rooms = table(
	{ name: 'rooms', public: true },
	{
		roomCode: t.string().primaryKey(),
		host: t.identity(),
		status: t.string(),
		seed: t.u32(),
		width: t.u32(),
		height: t.u32(),
		playerCount: t.u8(),
		botDifficulty: t.string(),
		timerMinutes: t.u8(),
		botCommandPostStacks: t.u32(),
		version: t.string(),
		startedAt: t.option(t.timestamp()),
		endedAt: t.option(t.timestamp()),
		// Latest row tick, including idle heartbeat rows.
		headTick: t.u64()
	}
);

export const seats = table(
	{ name: 'seats', public: true },
	{
		seatId: t.u64().primaryKey().autoInc(),
		identity: t.identity().unique(),
		playerId: t.u8().unique(),
		name: t.string(),
		isHost: t.bool(),
		connected: t.bool(),
		ready: t.bool(),
		joinedAt: t.timestamp()
	}
);

export const ledgerTransactions = table(
	{ name: 'ledger_transactions', public: true },
	{
		rowIndex: t.u64().primaryKey().autoInc(),
		tick: t.u64().index('btree'),
		seatId: t.u64().index('btree'),
		playerId: t.u8(),
		clientSequence: t.u64(),
		type: t.string(),
		data: t.array(t.u8()),
		status: t.string(),
		createdAt: t.timestamp()
	}
);

export const heartbeatTimers = table(
	{ name: 'heartbeat_timers' },
	{
		scheduledId: t.u64().primaryKey().autoInc(),
		scheduledAt: t.scheduleAt()
	}
);

export const newTransactionEvent = table(
	{ name: 'new_transaction_event', public: true, event: true },
	{
		rowIndex: t.u64(),
		tick: t.u64()
	}
);

const spacetimedb = schema({
	rooms,
	seats,
	ledgerTransactions,
	heartbeatTimers,
	newTransactionEvent
});

export default spacetimedb;
