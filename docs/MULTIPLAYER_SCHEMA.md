# Spacetime Room Schema

One Spacetime database per room. The room module is a coordinator only; it does
not store or simulate the game grid.

## Tables

### `rooms`

Single room row.

```ts
{
  roomCode: string primaryKey,
  host: Identity,
  status: string,
  seed: u32,
  width: u32,
  height: u32,
  playerCount: u8,
  botDifficulty: string,
  timerMinutes: u8,
  botCommandPostStacks: u32,
  version: string,
  startedAt?: Timestamp,
  headTick: u64,
  participationLocked: bool
}
```

### `seats`

```ts
{
  seatId: u64 primaryKey autoInc,
  identity: Identity unique,
  playerId: u8 unique,
  name: string,
  isHost: bool,
  connected: bool,
  ready: bool,
  joinedAt: Timestamp,
  lastClientSequence: u64
}
```

### `ledger_transactions`

The canonical ledger record. Clients apply accepted rows in `rowIndex` order.

```ts
{
  rowIndex: u64 primaryKey autoInc,
  tick: u64,
  seatId: u64,
  playerId: u8,
  clientSequence: u64,
  type: string,          // attack, build, upgrade, ...
  data: array<u8>,       // compact intent payload
  createdAt: Timestamp
}
```

### `first_tick_event`

```ts
{ tick: u64, startedAt: Timestamp }
```

Emitted once when a room starts. Participation is locked in the same commit.

### `heartbeat_timers`

Private schedule table. Heartbeat emission is currently disabled.

## Reducers

- `create_room` - creates the room and host seat; rejects clients whose `version` does not match the module protocol.
- `join_room` - joins a waiting, unlocked room; takes `{ name, version }` and rejects clients whose protocol version differs from the room.
- `set_ready` — updates the caller's seat readiness.
- `start_match` — host-only; requires every seat ready; sets running, locks
  participation, sets `startedAt`, emits `first_tick_event`.
- `submit_transaction` — validates seat, intent type, exact payload size, and
  monotonic client sequence; computes the server tick; appends the row.
- `leave_room` - removes the caller's seat, promotes a connected guest to host
  if needed, and resets the database when no connected seats remain.
- `finish_match` - called by a seated client when the local simulation ends;
  resets the database. Later calls are idempotent no-ops.
- `check_liveness` - no-op while heartbeat emission is disabled.

## Room lifecycle

```text
waiting -> running (lock + first tick) -> reset (empty)
waiting -> reset (empty) when every player leaves
```

Resetting deletes the room row, seats, ledger rows, and timers. The database
can then create a fresh room on the next lobby connection. Event-table rows are
not persisted and require no cleanup.

Late joins are rejected once `participationLocked` is true.

The current protocol version is `territory-room/2`. Bump the server constant and
`ROOM_VERSION` in `room-session.ts` together whenever reducer arguments or the
intent contract change incompatibly. The server rejects mismatched creates and
joins; clients also check the stored room version before joining.

## Client model

- Connect to the room database.
- Check the room `version` against the client protocol before joining; reject
  incompatible rooms with a refresh/update message.
- Create the room if empty; otherwise join while waiting.
- Ready up; host starts.
- On `first_tick_event`, start the local simulation.
- Submit intents as compact rows.
- Apply accepted rows at their server-assigned tick.
- Pause the local simulation while the room authority is unavailable.
