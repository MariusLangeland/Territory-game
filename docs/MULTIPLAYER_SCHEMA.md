# Multiplayer Spacetime Schema

Target: SpacetimeDB/Spacetime 2.x TypeScript module.

This is the coordinator schema only. The server does not store the simulation
grid. Clients run the simulation locally from transaction rows and tick seals.

```ts
import { ScheduleAt, schema, table, t } from 'spacetimedb/server';

// ---------------------------------------------------------------------------
// Shared value types
// ---------------------------------------------------------------------------

const RoomStatus = t.enum('RoomStatus', {
	Waiting: t.unit(),
	Running: t.unit(),
	Completed: t.unit()
});

const TransactionStatus = t.enum('TransactionStatus', {
	Provisional: t.unit(),
	Final: t.unit(),
	Invalidated: t.unit()
});

const VersionFingerprint = t.object('VersionFingerprint', {
	ledger: t.u32(),
	simulation: t.u32(),
	map: t.u32(),
	bots: t.u32(),
	app: t.string(),
	protocol: t.u32()
});

const DisputeStatus = t.enum('DisputeStatus', {
	Open: t.unit(),
	Arbitrating: t.unit(),
	Resolved: t.unit(),
	Dismissed: t.unit()
});

const ArbitrationDecision = t.enum('ArbitrationDecision', {
	Invalid: t.unit(),
	Valid: t.unit(),
	Dismissed: t.unit()
});

// ---------------------------------------------------------------------------
// Rooms and seats
// ---------------------------------------------------------------------------

export const rooms = table(
	{ name: 'rooms', public: true },
	{
		roomId: t.string().primaryKey(),
		roomCode: t.string().unique(),
		host: t.identity(),
		status: RoomStatus,
		seed: t.u32(),
		width: t.u32(),
		height: t.u32(),
		playerCount: t.u8(),
		botDifficulty: t.string(),
		timerMinutes: t.u8(),
		botCommandPostStacks: t.u32(),
		version: VersionFingerprint,
		startedAt: t.option(t.timestamp()),
		endedAt: t.option(t.timestamp()),
		// Tick closure watermark: transactions append only to openTick.
		openTick: t.u64(),
		sealedThrough: t.u64(),
		// Optional trusted arbitration for disputes.
		arbiterRequired: t.bool()
	}
);

export const seats = table(
	{ name: 'seats', public: true },
	{
		seatId: t.u64().primaryKey().autoInc(),
		roomId: t.string().index('btree'),
		identity: t.identity(),
		playerId: t.u8(),
		name: t.string(),
		isHost: t.bool(),
		connected: t.bool(),
		ready: t.bool(),
		joinedAt: t.timestamp()
	}
);

// The reducer must enforce one seat per (roomId, playerId) and one active seat
// per identity per room.

// ---------------------------------------------------------------------------
// Timer / tick sealing
// ---------------------------------------------------------------------------

export const tickTimers = table(
	{ name: 'tick_timers' },
	{
		scheduledId: t.u64().primaryKey().autoInc(),
		scheduledAt: t.scheduleAt(),
		roomId: t.string().index('btree')
	}
);

export const roomTicks = table(
	{ name: 'room_ticks', public: true },
	{
		tickId: t.u64().primaryKey().autoInc(),
		roomId: t.string().index('btree'),
		tick: t.u64().index('btree'),
		sealedAt: t.timestamp(),
		stateRoot: t.option(t.u32())
	}
);

// One scheduled 10 Hz reducer per room reads its tick_timers row and inserts a
// room_ticks seal. It does not advance or simulate the game.

// ---------------------------------------------------------------------------
// Ledger transactions
// ---------------------------------------------------------------------------

export const ledgerTransactions = table(
	{ name: 'ledger_transactions', public: true },
	{
		// Global monotonic insertion order. Clients sort same-tick rows by this.
		rowIndex: t.u64().primaryKey().autoInc(),
		roomId: t.string().index('btree'),
		tick: t.u64().index('btree'),
		seatId: t.u64().index('btree'),
		playerId: t.u8(),
		clientSequence: t.u64(),
		type: t.string(),
		data: t.array(t.u8()),
		status: TransactionStatus,
		createdAt: t.timestamp()
	}
);

// Canonical order:
//   ORDER BY tick ASC, rowIndex ASC
//
// Canonical replay excludes rows whose status is Invalidated.

// ---------------------------------------------------------------------------
// Flags and invalidation
// ---------------------------------------------------------------------------

export const transactionFlags = table(
	{ name: 'transaction_flags', public: true },
	{
		flagId: t.u64().primaryKey().autoInc(),
		roomId: t.string().index('btree'),
		rowIndex: t.u64().index('btree'),
		tick: t.u64(),
		seatId: t.u64(),
		playerId: t.u8(),
		stateRoot: t.u32(),
		reason: t.string(),
		createdAt: t.timestamp()
	}
);

export const invalidations = table(
	{ name: 'invalidations', public: true },
	{
		invalidationId: t.u64().primaryKey().autoInc(),
		roomId: t.string().index('btree'),
		rowIndex: t.u64().index('btree'),
		tick: t.u64(),
		reason: t.string(),
		flagCount: t.u16(),
		replacementTick: t.u64(),
		createdAt: t.timestamp()
	}
);

// A quorum invalidation marks the transaction row invalid and broadcasts the
// invalidation. The original row is never deleted.

// ---------------------------------------------------------------------------
// Optional trusted arbiter / admin
// ---------------------------------------------------------------------------

export const arbiters = table(
	{ name: 'arbiters', public: true },
	{
		arbiterId: t.u64().primaryKey().autoInc(),
		roomId: t.string().index('btree'),
		identity: t.identity(),
		label: t.string(),
		active: t.bool(),
		grantedBy: t.identity(),
		grantedAt: t.timestamp()
	}
);

export const disputes = table(
	{ name: 'disputes', public: true },
	{
		disputeId: t.u64().primaryKey().autoInc(),
		roomId: t.string().index('btree'),
		rowIndex: t.u64().index('btree'),
		tick: t.u64(),
		status: DisputeStatus,
		reason: t.string(),
		createdAt: t.timestamp(),
		resolvedAt: t.option(t.timestamp())
	}
);

export const arbitrations = table(
	{ name: 'arbitrations', public: true },
	{
		arbitrationId: t.u64().primaryKey().autoInc(),
		disputeId: t.u64().index('btree'),
		roomId: t.string().index('btree'),
		arbiterIdentity: t.identity(),
		decision: ArbitrationDecision,
		stateRoot: t.u32(),
		reason: t.string(),
		createdAt: t.timestamp()
	}
);

// An arbiter is a privileged identity, not a normal voter. Arbitration decisions
// are append-only; the original transaction row remains in history.

// ---------------------------------------------------------------------------
// Optional per-tick state-root attestations
// ---------------------------------------------------------------------------

export const tickChecks = table(
	{ name: 'tick_checks', public: true },
	{
		checkId: t.u64().primaryKey().autoInc(),
		roomId: t.string().index('btree'),
		tick: t.u64().index('btree'),
		seatId: t.u64(),
		playerId: t.u8(),
		stateRoot: t.u32(),
		createdAt: t.timestamp()
	}
);

// Useful for early desync detection and diagnostics. Not required for the
// optimistic happy path.

// ---------------------------------------------------------------------------
// Keyframes
// ---------------------------------------------------------------------------

export const keyframes = table(
	{ name: 'keyframes', public: true },
	{
		keyframeId: t.u64().primaryKey().autoInc(),
		roomId: t.string().index('btree'),
		tick: t.u64().index('btree'),
		stateRoot: t.u32(),
		version: VersionFingerprint,
		// Versioned RLE snapshot bytes; clients validate before restoring.
		data: t.array(t.u8()),
		submittedBy: t.identity(),
		createdAt: t.timestamp()
	}
);

// Keyframes are used for late join, reconnect, and rollback. The coordinator
// stores them but does not validate their simulation contents.

// ---------------------------------------------------------------------------
// Event tables: immediate notifications
// ---------------------------------------------------------------------------

export const newTransactionEvent = table(
	{ name: 'new_transaction_event', public: true, event: true },
	{
		roomId: t.string(),
		rowIndex: t.u64(),
		tick: t.u64()
	}
);

export const tickSealedEvent = table(
	{ name: 'tick_sealed_event', public: true, event: true },
	{
		roomId: t.string(),
		tick: t.u64(),
		stateRoot: t.option(t.u32())
	}
);

export const invalidationEvent = table(
	{ name: 'invalidation_event', public: true, event: true },
	{
		roomId: t.string(),
		rowIndex: t.u64(),
		tick: t.u64()
	}
);

// Event rows are broadcast and discarded after commit. Persistent tables above
// remain the source for late join, reconnect, and replay.

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const spacetimedb = schema({
	rooms,
	seats,
	tickTimers,
	roomTicks,
	ledgerTransactions,
	transactionFlags,
	invalidations,
	arbiters,
	disputes,
	arbitrations,
	tickChecks,
	keyframes,
	newTransactionEvent,
	tickSealedEvent,
	invalidationEvent
});

export default spacetimedb;
```

## Reducer responsibilities

- `create_room`, `join_room`, `leave_room`, `ready`, `start_match`.
- `submit_transaction`:
  - authenticate the caller against a seat;
  - validate schema and rate/sequence;
  - compute the current server tick from `startedAt` and `ctx.timestamp`;
  - insert a `ledger_transactions` row;
  - emit `new_transaction_event`.
- `seal_tick` scheduled reducer:
  - insert a `room_ticks` seal;
  - emit `tick_sealed_event`;
  - no simulation.
- `flag_transaction`:
  - authenticate seat;
  - reject stale-state flags;
  - insert a flag.
- `open_dispute`, `arbitrate_dispute`:
  - privileged arbiter only;
  - replay/verify the disputed row;
  - append an arbitration decision;
  - optionally invalidate the row or publish a certified keyframe.
- `invalidate_transaction`:
  - verify quorum or arbiter decision;
  - append `invalidations`;
  - update transaction status;
  - emit `invalidation_event`.
- `grant_arbiter`, `revoke_arbiter`:
  - host/admin only;
  - audit identity and timestamp.
- `submit_keyframe`, optional `submit_tick_check`.

## Client read/apply model

```text
subscribe room_ticks, ledger_transactions, invalidations

confirmedTick = last locally applied tick

safeHead = latest tick where:
  tick seal received
  AND all transaction rows received

while confirmedTick < safeHead:
  sort next tick's rows by rowIndex
  apply the whole tick
  skip invalidated rows
  verify resulting stateRoot
  confirmedTick++
```

Clients render at display rate but consume whole authoritative ticks. They never
simulate beyond `safeHead`; if they fall behind they catch up in whole ticks. A
late row for an already-applied tick is a resync/rollback condition.

`rooms.openTick` is the only tick transactions may append to.
`rooms.sealedThrough` is the client-visible seal watermark.

## Optional arbiter authority

An arbiter is a privileged fallback, not part of the normal transaction path.

```text
quorum flags
  -> open dispute
  -> arbiter fetches keyframe + rows
  -> arbiter replays disputed tick
  -> arbitrations row: valid | invalid | dismissed
  -> optional invalidation / certified keyframe
```

Rules to define:

- is the arbiter decision final or only a tie-breaker?
- can the arbiter override a quorum?
- does the arbiter continuously validate or only replay disputes?
- what happens when the arbiter is offline?
- can one player/admin be an arbiter in their own match?

Clients must treat arbitration as an append-only ledger decision and apply the
resulting canonical replay/reorg.

## Deliberate omissions

- No block table.
- No block hash or previous-block chain.
- No server-side simulation state.
- No server-side legality validation.
- No cryptographic consensus.
- No per-cell state stream.

Those are intentionally deferred. The coordinator's job is ordering, timestamping,
notifications, flags, invalidations, and keyframe storage.
