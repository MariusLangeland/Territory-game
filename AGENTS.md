# AGENTS.md

Orientation for coding agents working on Territory. Read this before changing simulation, rendering, or protocol behavior.

## Read order

1. [docs/SPEC.md](docs/SPEC.md) — canonical current product and rules.
2. [docs/EXPERIMENTS.md](docs/EXPERIMENTS.md) — temporary attack stress deviations and exit plan.
3. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — current code boundaries.
4. [docs/DETERMINISM.md](docs/DETERMINISM.md) if the change touches ticks, RNG, commands, attacks, map generation, checksums, or networking.
5. [docs/RENDERING.md](docs/RENDERING.md) if the change touches WebGPU, shaders, texture uploads, or camera math.
6. [docs/NETWORKING.md](docs/NETWORKING.md) before adding any server or multiplayer code.
7. [docs/PERFORMANCE.md](docs/PERFORMANCE.md) before performance-sensitive work.

## Current status

- **Active experiment EXP-001:** 108 states (1 human + 107 AI), free attacks with a 50-tick/5-second order lifetime, no troops/income/caps/costs, technical active-front caps of 3 human / 2 bot. Three selectable growth layers: circular, smooth, organic. This is not the final combat model.
- Implemented: seeded 2048 × 1024 world, 108 starts, free attack flood fill, pluggable growth layers, WebGPU rendering, virtualized 108-state HUD, tests, benchmark.
- Not implemented: final attack design, economy, online server, WebSockets, lobbies, accounts, persistence, replays UI, fog, audio, pinch zoom.
- WebGPU is required. There is no fallback map renderer.

## Commands

```sh
pnpm install
pnpm dev
pnpm check
pnpm test
pnpm bench
pnpm build
pnpm lint
```

If `pnpm`/`node` is not on PATH in this environment, use the runtime paths provided by the harness (`load_workspace_dependencies`) instead of modifying global PATH assumptions in the repo.

## Non-negotiable invariants

1. **Simulation purity:** no DOM, no `Date`, no `performance`, no `Math.random`, no network, no UI access in `src/lib/game/simulation.ts`, `map.ts`, or `rng.ts`.
2. **Fixed tick:** gameplay changes happen inside `step()` at 10 Hz. Input callbacks only validate/queue.
3. **Integer outcomes:** new gameplay quantities must be integer/deterministic. If float distance or trigonometry is unavoidable, justify it and version it.
4. **Stable ordering:** commands, attacks, RNG draws, and collection iteration that affect outcomes must have explicitly defined order.
5. **Protect input latency:** use the dirty-tile path for normal updates. Heavy/dispersed updates may switch to adaptive full-texture resync, but it must be chunked across frames; never block a single frame with a full-map upload. Keep HUD snapshots throttled and the leaderboard virtualized.
6. **Renderer never mutates simulation state.**
7. **Version intentional changes:** map generation → `MAP_VERSION`; wire changes → `NET_PROTOCOL_VERSION`; simulation changes → determinism review + tests.
8. **Do not claim online support.** It is a documented target, not current behavior.
9. **Do not treat EXP-001 as final design.** Free attacks, 108 states, and active-front caps are stress-test choices; read [docs/EXPERIMENTS.md](docs/EXPERIMENTS.md) before building on them.
10. **Growth layers only select frontier candidates.** Ownership, edge connectivity, capture budget, order lifetime, and checksums stay in `simulation.ts`. Never let a layer bypass those checks.
11. **Distance-based growth starts at the border.** The attack anchor is the rounded centroid of the initial seed contact; the clicked cell is only a target/search selector. Do not anchor growth on a deep click.
12. **Growth selection must be deterministic.** Integer keys/tie-breaks; organic randomness comes only from its per-attack seeded PRNG. Include frontier state and growth mode in checksums.
13. **Do not reintroduce per-attack Sets without measurements.** Prefer flat structures; the current layers use a number-array heap, radial-band arrays, or an array + RNG.

## Where things live

- `src/routes/+page.svelte` — screen flow and HUD. Large file by design; keep gameplay rules out.
- `src/lib/components/GameCanvas.svelte` — canvas/fixed loop/pointer; do not add simulation logic here.
- `src/lib/game/constants.ts` — rules and palette. Changing these can change match outcomes.
- `src/lib/game/simulation.ts` — the core. Prefer focused edits and add tests.
- `src/lib/game/growth/` — growth-layer interface, factory, and circular/radial-band smooth/organic implementations. Keep simulation invariants out of these modules.
- `src/lib/game/growth/growth.test.ts` — layer selection invariants.
- `src/lib/game/render/territory-renderer.ts` — GPU resource lifecycle and uploads.
- `src/lib/game/render/territory.wgsl.ts` — shader source as a TypeScript string.
- `src/lib/game/net/protocol.ts` — protocol draft; keep docs synchronized.
- `scripts/benchmark.ts` — performance baseline, including all growth layers.

## Definition of done

For any meaningful change:

- `pnpm check` passes.
- `pnpm test` passes.
- `pnpm build` passes for user-facing changes.
- New gameplay behavior has a determinism or invariant test.
- Renderer changes were checked in a WebGPU browser (no error overlay, no synchronous full-map upload regression).
- Docs updated if rules, architecture, protocol, or performance changed.
- No generated output (`.svelte-kit/`, `build/`, `node_modules/`) edited directly.

## Browser verification

WebGPU is not available in jsdom. Verify visually and interactively:

1. Start `pnpm dev`.
2. Open a seeded URL such as `/?seed=1234` in current Chrome/Edge.
3. Confirm the intro appears, WebGPU error modal is absent, and DEPLOY is enabled.
4. Deploy, confirm the 108-state virtualized leaderboard and active-front count; scroll it to the last rank.
5. Click a frontier, confirm a success toast and territory growth.
6. Pause with Space and confirm the tick freezes.
7. Switch the growth layer through CIRCULAR / SMOOTH / ORGANIC and confirm new attacks use it while in-flight orders keep theirs.
8. Check the HUD perf readout: calls/s should be modest; heavy full-resync chunks are expected under saturation.
9. Drag-pan for several seconds with ~200 fronts and confirm no periodic 10 Hz hitch.
10. Test a narrow viewport and scroll the 108-state leaderboard to the bottom.

## Style

- TypeScript strict mode; explicit public types.
- Svelte 5 runes, not legacy reactive syntax.
- Prefer `#lib` subpath imports in app/components.
- Use `pnpm format` before finishing (Prettier).
- Comments explain invariants and why, not obvious code.
- Avoid adding dependencies unless they remove meaningful complexity.
