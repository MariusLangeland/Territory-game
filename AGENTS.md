# AGENTS.md

Orientation for coding agents working on Territory.

## Read order

1. [docs/SPEC.md](docs/SPEC.md) — canonical product and behavior.
2. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — module boundaries and data flow.
3. [docs/REFERENCE.md](docs/REFERENCE.md) — generated rules and costs.
4. [docs/MULTIPLAYER_SCHEMA.md](docs/MULTIPLAYER_SCHEMA.md) — Spacetime schema and reducers.

## Model

- **Frontage v1.** One supply resource; 8–51 states; deterministic organic growth.
- Player matches use locked organic growth.
- State structures anchor connected territory.
- Holding 70% of land wins instantly; optional timer awards the largest living state.
- Only code and tests are authoritative for values. [docs/REFERENCE.md](docs/REFERENCE.md) is generated.
- WebGPU is required. There is no fallback renderer.

## Multiplayer

- One Spacetime database per room plus a `territory-lobby` directory database.
- A room has a waiting lobby: seats join and ready up; the host starts.
- Tick-0 locks participation and starts local simulations.
- Player input is validated against the local simulation before submission. Invalid commands are discarded and never become ledger rows.
- Valid input is submitted as a compact Spacetime ledger row. The server assigns the tick; clients apply accepted intents to their local simulation.
- Losing the room authority pauses the local simulation.
- A room resets when its match ends or its last connected player leaves.
- Room protocol version changes require a matching client; mismatched clients are rejected.

## Commands

```sh
pnpm dev
pnpm check
pnpm test
pnpm test:fast
pnpm test:worker
pnpm check:boundaries
pnpm bench
pnpm docs:reference
pnpm docs:check
pnpm build
pnpm lint
pnpm format
```

## Invariants

1. **Simulation purity:** no DOM, `Date`, `performance`, `Math.random`, network, or UI access in `simulation.ts`, `map.ts`, or `rng.ts`.
2. **Fixed step, variable rate:** gameplay changes happen inside `step()`. 10 Hz is the normal target, not a hard constraint; accepted ledger rows may fast-forward the simulation to `rowTick - 1`. Input callbacks only validate and queue.
3. **Integer outcomes:** new gameplay quantities must be integer and deterministic.
4. **Stable ordering:** commands, attacks, RNG draws, and outcome-affecting iteration need explicit order.
5. **Renderer never mutates simulation state.**
6. **Version generation changes:** map generation → `MAP_VERSION`; wire format changes → protocol review; simulation changes → determinism tests.
7. **The main thread never steps the simulation.** The worker view host owns stepping, snapshots, and accepted-intent application.
8. **Validate before submitting.** The local simulation's deterministic rules reject illegal commands before they become ledger rows.
9. **Do not add a second ledger implementation.** Remote submission uses `SpacetimeLedgerSource`; all accepted intents share the canonical ledger record shape.
10. **No flag/quorum/arbiter layer.** Invalid intents are deterministic no-ops on every honest client; the server validates protocol shape, not gameplay.
11. **Do not reintroduce the retired HTTP/SSE online MVP, Evolution Lab, replay viewer, or local ledger.** These were removed deliberately.

## Where things live

- `src/routes/+page.svelte` — page shell and screen flow.
- `src/lib/components/` — Svelte UI, canvas, HUD, overlays.
- `src/lib/game/frontend/contracts.ts` — frontend command boundary.
- `src/lib/game/ledger/` — `types.ts` (canonical record/source), `remote.ts` (Spacetime), `codec.ts` (compact intent payloads).
- `src/lib/game/view/` — `match-view.ts` (main-thread lifecycle), `worker-host.ts` (fixed-tick view host).
- `src/lib/game/worker/` — transport, protocol, mirror, worker entry.
- `src/lib/game/simulation.ts` and `simulation/` — deterministic core.
- `src/lib/game/structures/` — structure definitions and registry.
- `src/lib/game/ai/` — genomes, Markov controllers, bot pool.
- `src/lib/game/page/` — page state, controllers, selectors.
- `src/lib/spacetime/` — generated bindings, room directory, room lobby, intent codec.
- `spacetime/territory-room/` — one-room coordinator module.
- `spacetime/territory-lobby/` — room directory module.
- `docs/` — specification, architecture, generated reference, multiplayer schema.

## Definition of done

- `pnpm check` passes.
- `pnpm test` passes.
- `pnpm build` passes for user-facing changes.
- New gameplay behavior has a determinism or invariant test.
- `pnpm docs:check` passes.
- Generated output (`.svelte-kit/`, `build/`, `node_modules/`) is never edited directly.
