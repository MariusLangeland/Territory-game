# Architecture

## Runtime layers

```text
UI / Svelte
  -> frontend contracts
  -> ledger (Spacetime or local command source)
  -> match view
  -> worker view host
  -> TerritorySimulation
```

The simulation is deterministic and has no DOM, network, wall-clock, or UI
access. The main thread never steps it.

## Modules

### `src/lib/components/`

Svelte presentation and WebGPU canvas.

- `GameCanvas.svelte` — renderer host and pointer input.
- `MatchViewer.svelte` — canvas wrapper used by the game page.
- HUD: `GameTopBar`, `WorldRail`, `SupplyPanel`, `CardTray`, `MapTools`.
- Overlays: `IntroOverlay`, `RoomSelectScreen`, `RoomLobbyScreen`,
  `LoadingOverlay`, `ErrorModal`, `ResultModal`, `DefeatModal`, `HelpOverlay`.

### `src/lib/game/frontend/`

`contracts.ts` is the frontend command boundary. UI code depends on
`MatchCommandGateway`, not on transport details.

### `src/lib/game/ledger/`

Standard ledger boundary.

- `types.ts` — `LedgerRecord` mirrors the Spacetime `ledger_transactions` row;
  `LedgerSource` is the remote/local submission contract.
- `remote.ts` — `SpacetimeLedgerSource`, submission and row subscription.
- `codec.ts` — compact intent payloads.
- `index.ts` — public exports.

### `src/lib/game/view/`

Match view layer.

- `match-view.ts` — main-thread lifecycle: worker creation, bot roster,
  viewer seats, command routing, pause/resume, disposal.
- `worker-host.ts` — worker-owned fixed-tick host: applies accepted intents,
  steps simulation, builds visual deltas.
- `index.ts` — public exports.

### `src/lib/game/worker/`

Worker transport and mirror.

- `local-simulation.worker.ts` — 10 Hz loop.
- `local-client.ts` — worker message transport.
- `local-simulation.ts` — read-only mirror and async command facade.
- `view.ts` — mirror state.
- `local-protocol.ts` — worker messages.
- `intent.ts` — UI command to `OnlineIntent`.

### `src/lib/game/simulation.ts` and `simulation/`

Deterministic game core: map, ownership, supply, structures, fronts, artillery,
naval, alliances, bots, districts, integrity, checksums, snapshots.

### `src/lib/game/ai/`

Bot genomes, Markov controllers, strategic options, saved difficulty pools, and
the shipped gauntlet survivor roster.

### `src/lib/spacetime/`

Generated room/lobby bindings, room directory, room lobby session, intent codec
compatibility export.

### `spacetime/territory-room/`

One Spacetime database per room. Owns room lifecycle, seats, readiness,
participation lock, ledger rows, and validation. It does not simulate gameplay.

### `spacetime/territory-lobby/`

Room directory database used by the landing page.

## Data flow

```text
input
  -> frontend command
  -> local simulation validation (invalid commands discarded)
  -> Spacetime ledger row (server tick assigned)
  -> accepted row subscription
  -> MatchView.applyRemoteIntent
  -> MatchViewHost catch-up to rowTick - 1
  -> queue intent for rowTick
  -> TerritorySimulation.step()
  -> visual deltas
  -> main-thread mirror
  -> WebGPU renderer
```

Lobby lifecycle:

```text
connect room DB -> create/join -> ready -> host start
-> participation lock -> first_tick_event -> local simulation
```

## Invariants

- Fixed 10 Hz simulation tick.
- Stable command, attack, and RNG ordering.
- No renderer mutation of simulation state.
- No local ledger in online matches.
- Late joins are rejected after the tick-0 lock.
- WebGPU is required.
