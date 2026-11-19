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

- **Active experiment EXP-001:** 108 states (1 human + 107 AI), free attacks with a 50-tick/5-second order lifetime, no troops/production caps, attack orders of 3 human / 2 bots refreshed every 10 seconds. Attacks spend 30 points per tick against pixel defense (`1 + elevation + occupied + aura`). State structures project a +20 defense aura over 12 px. The human has a gold/card economy (3 starting gold, +1/10s, three-card hand, Refresh, five buildable card types including Command Post and War Academy). Three selectable growth layers: circular, smooth, organic. Mutual fronts cancel at contact. Each state has a capturable State structure anchoring protected territory; disconnected unprotected territory is annexed into surrounding protected mainlands. Elevation tiers color the map. This is not the final combat model.
- Implemented: seeded 2048 × 1024 world with six elevation tiers, 108 starts, State and buildable structures, gold/card/attack-order economy, terrain defense/attack points, free attack flood fill, pluggable growth layers, claim provenance, territory-integrity cleanup, WebGPU rendering, virtualized 108-state HUD, tests, benchmark.
- Not implemented: final attack design, bot card economy/build AI, full resource economy, online server, WebSockets, lobbies, accounts, persistence, replays UI, fog, audio, pinch zoom.
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
9. **Do not treat EXP-001 as final design.** Free attacks, 108 states, 10-second attack-order refreshes, and the card pool are stress-test choices; read [docs/EXPERIMENTS.md](docs/EXPERIMENTS.md) before building on them.
10. **Growth layers only select frontier candidates.** Ownership, edge connectivity, capture budget, order lifetime, and checksums stay in `simulation.ts`. Never let a layer bypass those checks.
11. **Distance-based growth starts at the border.** The attack anchor is the rounded centroid of the initial seed contact; the clicked cell is only a target/search selector. Do not anchor growth on a deep click.
12. **Growth selection must be deterministic.** Integer keys/tie-breaks; organic randomness comes only from its per-attack seeded PRNG. Include frontier state and growth mode in checksums.
13. **Mutual fronts cancel at contact.** Claim provenance is authoritative. Do not let interpenetrating fronts keep capturing around each other, and do not cancel unrelated pairs.
14. **Annex only to a surrounding protected mainland.** A component is protected if it contains a live State structure of the same owner; ties and border counts are deterministic. Leave islands with no foreign-protected contact alone.
15. **State structures are authoritative objects.** Place one at each start, destroy it when its cell changes owner, include it in snapshots/checksums, and render it from registry/snapshot state. Do not infer protection from component size.
16. **Defense is derived and integer.** `1 + elevation + occupied + aura`; do not add a mutable defense array or float modifier. Attacks spend 30 points/tick; requeue an unaffordable candidate rather than losing it.
17. **Elevation is versioned map data.** Changing tier thresholds, level count, or defense meaning requires `MAP_VERSION`/protocol review and updated tests.
18. **Structure effects are defined by type and derived into overlays.** State auras stamp +20 within 12 px with max-overlap semantics; Defense Posts add. Rebuild derived auras when a structure is destroyed; include effect descriptors in public structure payloads. Do not serialize a mutable per-cell aura array.
19. **Card economy is command-driven.** Build/refresh must queue and apply inside `step()`, validate gold/card/owned land/empty structure slot, and use the dedicated card RNG. Cards draw independently from the five-type buildable pool with replacement. Captured structures are razed.
20. **Attack orders are per-player integer charges.** A launch spends exactly one order. Every 100 ticks refresh to `max(current, cap)`; orders may exceed cap only through Command Post grants. Base caps are 3 human / 2 bots; War Academy cap effects are derived from live structures. Include orders and both timers in checksums.
21. **Do not reintroduce per-attack Sets without measurements.** Prefer flat structures; the current layers use a number-array heap, radial-band arrays, or an array + RNG.

## Where things live

- `src/routes/+page.svelte` — screen flow and HUD. Large file by design; keep gameplay rules out.
- `src/lib/components/GameCanvas.svelte` — canvas/fixed loop/pointer; do not add simulation logic here.
- `src/lib/game/constants.ts` — rules and palette. Changing these can change match outcomes.
- `src/lib/game/simulation.ts` — the core. Prefer focused edits and add tests.
- `src/lib/game/growth/` — growth-layer interface, factory, and circular/radial-band smooth/organic implementations. Keep simulation invariants out of these modules.
- `src/lib/game/growth/growth.test.ts` — layer selection invariants.
- `src/lib/game/structures.ts` — structure registry, definitions, buildable cards, and effect descriptors.
- `src/lib/game/economy.test.ts` — starting hand/income/build/refresh/effect invariants.
- `src/lib/game/integrity.ts` — connected-component planning and detached-territory annexation.
- `src/lib/game/integrity.test.ts` — anchored-mainland, island, and tie-break invariants.
- `src/lib/components/GameCanvas.svelte` — structure markers use the same camera on a transparent 2D overlay.
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
8. Confirm elevation colors and contours render, hovering shows the correct tier/base/total defense, and high-defense captures are visibly slower.
9. Confirm State structure capital-star circles are drawn at capitals, their aura fields appear at tactical zoom, minimap ringed dots track them, and the commander readout says ANCHORED.
10. Hover an aura pixel and confirm the defense readout includes `AURA +20` and the total is raised accordingly.
11. Deploy, drag a card into controlled territory, and confirm gold/card removal/structure placement; try an invalid drop and confirm no cost.
12. Click Refresh and confirm 1 gold is spent and three fresh cards replace the hand.
13. Confirm the ORDERS readout drops per launch, accepts up to 3 immediate human attacks, rejects a fourth until refresh, and refills after 10 seconds.
14. Build a Command Post and observe an extra order on the next 60-second pulse; build a War Academy and confirm the refresh cap rises.
15. Capture a structure (or fabricate a capture in a test) and confirm it disappears with its effects, the owner shows NO ANCHOR, and a war-feed event appears.
16. Run ORGANIC for several seconds; confirm mutual fronts disappear instead of interpenetrating and no isolated owner specks remain after a cleanup pass.
17. Check the HUD perf readout: calls/s should be modest; heavy full-resync chunks are expected under saturation.
18. Drag-pan for several seconds with ~100 fronts and confirm no periodic 10 Hz hitch.
19. Test a narrow viewport and scroll the 108-state leaderboard to the bottom.

## Style

- TypeScript strict mode; explicit public types.
- Svelte 5 runes, not legacy reactive syntax.
- Prefer `#lib` subpath imports in app/components.
- Use `pnpm format` before finishing (Prettier).
- Comments explain invariants and why, not obvious code.
- Avoid adding dependencies unless they remove meaningful complexity.
