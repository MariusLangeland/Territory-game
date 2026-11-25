# Multiplayer Spacetime Schema

Target: SpacetimeDB/Spacetime 2.x TypeScript module.

Deployment decision: **one Spacetime database per room**.

This is the coordinator schema only. The server does not store the simulation
grid. Clients run the simulation locally from transaction rows.

The server does **not** periodically seal ticks. Transactions are appended when
they occur; each row carries the server-assigned tick. Clients simulate behind an
estimated server clock by a safe time delta.

```ts
import { schema, table, t } from 'spacetimedb/server';

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

const VersionFingerprint = t.object('VersionFingerprint', {
	ledger: t.u32(),
	simulation: t.u32(),
	map: t.u32(),
	bots: t.u32(),
	app: t.string(),
	protocol: t.u32()
});

// ---------------------------------------------------------------------------
// Room and seats (one database per room)
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
		// Latest transaction tick observed, including idle heartbeat rows.
		// Updated only when a row is appended; there is no tick seal.
		headTick: t.u64(),
		// Arbiter decisions are final for disputed rows.
		arbiterRequired: t.bool()
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

// The reducer must enforce unique playerId values.

// ---------------------------------------------------------------------------
// Ledger transactions
// ---------------------------------------------------------------------------

export const ledgerTransactions = table(
	{ name: 'ledger_transactions', public: true },
	{
		// Global monotonic insertion order. Clients sort same-tick rows by this.
		rowIndex: t.u64().primaryKey().autoInc(),
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
//
// Liveness rows:
//   type = "heartbeat"
//   playerId/seatId = 0
//   data = empty
// These are emitted when the coordinator has seen no transaction for 10 ticks.
// Clients use them only to reset their staleness timer; they are skipped by
// simulation, replay, checksums, flags, and quorum counting.

// ---------------------------------------------------------------------------
// Flags and invalidation
// ---------------------------------------------------------------------------

export const transactionFlags = table(
	{ name: 'transaction_flags', public: true },
	{
		flagId: t.u64().primaryKey().autoInc(),
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
// Trusted arbiter / admin (decision is final)
// ---------------------------------------------------------------------------

export const arbiters = table(
	{ name: 'arbiters', public: true },
	{
		arbiterId: t.u64().primaryKey().autoInc(),
		identity: t.identity().unique(),
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
		arbiterIdentity: t.identity(),
		decision: ArbitrationDecision,
		stateRoot: t.u32(),
		reason: t.string(),
		createdAt: t.timestamp()
	}
);

// An arbiter is a privileged identity, not a normal voter. Arbitration decisions
// are append-only; the original transaction row remains in history. Arbiter
// decisions are final for the disputed row.

// ---------------------------------------------------------------------------
// Keyframes
// ---------------------------------------------------------------------------

export const keyframes = table(
	{ name: 'keyframes', public: true },
	{
		keyframeId: t.u64().primaryKey().autoInc(),
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
		rowIndex: t.u64(),
		tick: t.u64()
	}
);

/** One-shot match anchor broadcast when the room enters running state. */
export const firstTickEvent = table(
	{ name: 'first_tick_event', public: true, event: true },
	{
		tick: t.u64(),
		startedAt: t.timestamp()
	}
);

export const invalidationEvent = table(
	{ name: 'invalidation_event', public: true, event: true },
	{
		rowIndex: t.u64(),
		tick: t.u64()
	}
);

export const arbitrationEvent = table(
	{ name: 'arbitration_event', public: true, event: true },
	{
		disputeId: t.u64(),
		rowIndex: t.u64(),
		decision: ArbitrationDecision
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
	ledgerTransactions,
	transactionFlags,
	invalidations,
	arbiters,
	disputes,
	arbitrations,
	keyframes,
	newTransactionEvent,
	firstTickEvent,
	invalidationEvent,
	arbitrationEvent
});

export default spacetimedb;
```

## Reducer responsibilities

- `create_room`, `join_room`, `leave_room`, `ready`.
- `start_match`:
  - host-only;
  - set `status = running` and `startedAt`;
  - schedule liveness;
  - broadcast `first_tick_event` with `tick = 0` and the same `startedAt`;
  - clients treat the broadcast as the simulation start anchor.
- `submit_transaction`:
  - authenticate the caller against a seat;
  - validate schema and rate/sequence;
  - compute `tick = floor((ctx.timestamp - startedAt) / 100ms)`;
  - insert a `ledger_transactions` row;
  - update `rooms.headTick`;
  - emit `new_transaction_event`.
- `check_liveness` scheduled reducer (about once per second):
  - if `currentTick - lastTransactionTick >= 10`, insert an empty `heartbeat`
    row at `currentTick`;
  - update `rooms.headTick`;
  - emit `new_transaction_event`.
- `flag_transaction`:
  - authenticate seat;
  - reject stale-state flags;
  - insert a flag.
- `open_dispute`:
  - escalate repeated/conflicting flags or no-quorum cases.
- `arbitrate_dispute`:
  - privileged arbiter only;
  - replay/verify the disputed row;
  - append a final arbitration decision;
  - optionally invalidate/finalize or publish a certified keyframe.
- `invalidate_transaction`:
  - verify quorum or final arbiter decision;
  - append `invalidations`;
  - update transaction status;
  - emit `invalidation_event`.
- `grant_arbiter`, `revoke_arbiter`:
  - host/admin only;
  - audit identity and timestamp.
- `submit_keyframe`.

No periodic tick-seal reducer and no `room_ticks` table: transactions are the
only ledger entries. A roughly once-per-second liveness reducer may append an
empty heartbeat transaction after 10 idle ticks.

## Client read/apply model

The client does **not** wait for a per-tick seal. It maintains a safe time delta
from the estimated server clock:

```text
serverHeadTick = floor((estimatedServerNow - startedAt) / 100ms)
targetTick     = serverHeadTick - safeDeltaTicks

confirmedTick = last locally applied tick

while confirmedTick < targetTick:
  collect rows for confirmedTick + 1
  sort by rowIndex
  apply gameplay rows for the whole tick
  skip invalidated and heartbeat rows
  verify resulting stateRoot
  confirmedTick++
```

Heartbeat rows update `lastServerActivityTick` but do not change simulation
state. If no row arrives for 20 ticks, the client marks the link stale; it does
not treat the room as ended or roll back state.

If a transaction row arrives for a tick at or before `confirmedTick`, the client
has simulated past the ledger head and must pause/rollback/resync. The safe time
delta is chosen to make this rare: it must exceed one-way transaction delivery,
server processing, subscription batching, and clock-estimation error.

Clients render at display rate but consume whole authoritative ticks. They never
use variable-dt simulation.

## Deliberate omissions

- No periodic tick seal. Idle heartbeats are liveness-only transaction rows.
- No block table.
- No block hash or previous-block chain.
- No server-side simulation state.
- No server-side legality validation.
- No cryptographic consensus.
- No per-cell state stream.
- No periodic tick checks.

Those are intentionally deferred. The coordinator's job is ordering, timestamping,
notifications, flags, invalidation, arbitration, and keyframe storage.
