# Territory Room Directory

Public room discovery for the one-database-per-room architecture. This module
does not simulate a match; it stores preview metadata for rooms hosted by
separate Spacetime databases.

## What exists

- `room_directory` — public room cards: name, rules, settings, status, host.
- `register_room` — registers a room database and its preview.
- `set_room_status` — host-only lifecycle update (`open`, `running`, `closed`).
- `remove_room` — host-only directory removal.

## Publish and bind

Run from this directory:

```powershell
spacetime build
cd spacetimedb
pnpm install
pnpm test
cd ..
spacetime publish territory-lobby --server maincloud --yes
spacetime generate --lang typescript --out-dir ../../src/lib/spacetime/lobby_bindings --module-path ./spacetimedb --import-extension none
```

The Svelte landing page connects to `territory-lobby` and subscribes to
`room_directory`. The generated bindings live in
`src/lib/spacetime/lobby_bindings`.

## Current demo rooms

| Database                 | Room            |
| ------------------------ | --------------- |
| `territory-room-alpha`   | BORDER SKIRMISH |
| `territory-room-bravo`   | SUPPLY SIEGE    |
| `territory-room-charlie` | IRON TIDE       |
| `territory-room-delta`   | TOTAL FRONT     |

Each room database currently starts empty. The next integration step is for a
client selecting a room to create/join its room-database session before starting
the local simulation.
