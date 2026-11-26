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

- `create_room` — creates the room and host seat.
- `join_room` — joins a waiting, unlocked room.
- `set_ready` — updates the caller's seat readiness.
- `start_match` — host-only; requires every seat ready; sets running, locks
  participation, sets `startedAt`, emits `first_tick_event`.
- `submit_transaction` — validates seat, intent type, exact payload size, and
  monotonic client sequence; computes the server tick; appends the row.
- `leave_room` — marks the seat disconnected.
- `check_liveness` — no-op while heartbeat emission is disabled.

## Room lifecycle

```text
waiting -> running (lock + first tick) -> completed
```

Late joins are rejected once `participationLocked` is true.

## Client model

- Connect to the room database.
- Create the room if empty; otherwise join while waiting.
- Ready up; host starts.
- On `first_tick_event`, start the local simulation.
- Submit intents as compact rows.
- Apply accepted rows at their server-assigned tick.
- Pause the local simulation while the room authority is unavailable.
