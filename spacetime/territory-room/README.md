# Territory Room Coordinator

One Spacetime database per room. This module does **not** simulate the game; it
orders client transactions, tracks seats/presence, and emits liveness rows.

## What exists

- `rooms` — room config, lifecycle status, authoritative head tick.
- `seats` — human seats, identity ownership, readiness/presence.
- `ledger_transactions` — ordered transaction rows and heartbeat rows.
- `new_transaction_event` — event-table notification for new rows.
- `first_tick_event` — one-shot tick-0 match-start broadcast; participation is
  locked atomically before it commits, so late-comers are rejected.
- `heartbeat_timers` — private once-per-second liveness schedule.

Reducers:

- `create_room` — creates the single room row and seeds the host seat.
- `join_room` — reserves the lowest free player slot.
- `set_ready`, `start_match`, `leave_room`.
- `submit_transaction` — records a seat-authorized row at the server-assigned tick.
- `check_liveness` — appends an empty `heartbeat` row after 10 idle ticks.

## Commands

Run from this directory:

```powershell
spacetime build
cd spacetimedb
pnpm install
pnpm test
cd ..
spacetime publish territory-room-dev --server local --yes
spacetime generate --lang typescript --out-dir ../../src/lib/spacetime/module_bindings --module-path ./spacetimedb --import-extension none
```

The generated client bindings live in `src/lib/spacetime/module_bindings`.

## Local flow

```powershell
spacetime start
spacetime call territory-room-dev create_room '"ROOM01"' '"Alice"' 1234 1024 512 8 '"standard"' 0 0 '"dev"' --server local
spacetime call territory-room-dev start_match --server local
spacetime sql territory-room-dev "SELECT * FROM ledger_transactions" --server local
```

The 10 Hz client simulation is not in this module. `/online` and the local room
UI still use their existing simulation paths until the client is connected to
these generated bindings.
