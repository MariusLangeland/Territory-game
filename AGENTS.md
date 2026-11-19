# AGENTS.md

Orientation for coding agents working on Territory. Read this before changing simulation, rendering, or protocol behavior.

## Read order

1. [docs/SPEC.md](docs/SPEC.md) — intended product and rules.
2. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — current boundaries.
3. [docs/DETERMINISM.md](docs/DETERMINISM.md) if the change touches ticks, RNG, commands, attacks, map generation, checksums, or networking.
4. [docs/RENDERING.md](docs/RENDERING.md) if the change touches WebGPU, shaders, texture uploads, or camera math.
5. [docs/NETWORKING.md](docs/NETWORKING.md) before adding any server or multiplayer code.
6. [docs/PERFORMANCE.md](docs/PERFORMANCE.md) before performance-sensitive work.

## Current status

- Implemented: local single-player skirmish against 7 deterministic bots, WebGPU rendering, seeded worlds, HUD, tests, benchmark.
- Not implemented: online server, WebSockets, lobbies, accounts, persistence, replays UI, fog, audio, pinch zoom.
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
5. **No full-map uploads per tick:** use the dirty-tile path. A full upload is only for init/resync/overflow.
6. **Renderer never mutates simulation state.**
7. **Version intentional changes:** map generation → `MAP_VERSION`; wire changes → `NET_PROTOCOL_VERSION`; simulation changes → determinism review + tests.
8. **Do not claim online support.** It is a documented target, not current behavior.

## Where things live

- `src/routes/+page.svelte` — screen flow and HUD. Large file by design; keep gameplay rules out.
- `src/lib/components/GameCanvas.svelte` — canvas/fixed loop/pointer; do not add simulation logic here.
- `src/lib/game/constants.ts` — rules and palette. Changing these can change match outcomes.
- `src/lib/game/simulation.ts` — the core. Prefer focused edits and add tests.
- `src/lib/game/render/territory-renderer.ts` — GPU resource lifecycle and uploads.
- `src/lib/game/render/territory.wgsl.ts` — shader source as a TypeScript string.
- `src/lib/game/net/protocol.ts` — protocol draft; keep docs synchronized.
- `scripts/benchmark.ts` — performance baseline.

## Definition of done

For any meaningful change:

- `pnpm check` passes.
- `pnpm test` passes.
- `pnpm build` passes for user-facing changes.
- New gameplay behavior has a determinism or invariant test.
- Renderer changes were checked in a WebGPU browser (no error overlay, no full-map upload regression).
- Docs updated if rules, architecture, protocol, or performance changed.
- No generated output (`.svelte-kit/`, `build/`, `node_modules/`) edited directly.

## Browser verification

WebGPU is not available in jsdom. Verify visually and interactively:

1. Start `pnpm dev`.
2. Open a seeded URL such as `/?seed=1234` in current Chrome/Edge.
3. Confirm the intro appears, WebGPU error modal is absent, and DEPLOY is enabled.
4. Deploy, click a frontier, confirm a success toast and territory growth.
5. Pause with Space and confirm the tick freezes.
6. Check the HUD perf readout: uploads should be local, not a full-map-per-tick value.
7. Test a narrow viewport.

## Style

- TypeScript strict mode; explicit public types.
- Svelte 5 runes, not legacy reactive syntax.
- Prefer `#lib` subpath imports in app/components.
- Use `pnpm format` before finishing (Prettier).
- Comments explain invariants and why, not obvious code.
- Avoid adding dependencies unless they remove meaningful complexity.
