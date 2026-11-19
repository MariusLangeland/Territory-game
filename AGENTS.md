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

- **Active experiment EXP-001:** 108 states (1 human + 107 AI), free attacks with embedded-order lifetimes, no troops/production caps, attack orders of 3 human / 2 bots with +1 gained every 10 seconds up to cap. Attacks embed 1 order plus one per Barracks stack; extra orders scale points, defense piercing, and lifetime (base 50 ticks plus 10 per extra order) against pixel defense (`1 + elevation + occupied + aura`). Each capture samples the top 10 frontier candidates to favor the cheapest local defense. State structures project a +20 defense aura over 16 px. Every buildable structure seeds a bounded, noise-edged Voronoi district of at least 32 px; auras apply only inside their district; different types cannot share a district, while multiple same-type districts are allowed and same-type drops stack. The human has a gold/card economy (3 starting gold, continuously accrued income, all five build cards permanently available with repeat purchases, click-to-upgrade districts). Three selectable growth layers: circular, smooth, organic. Mutual fronts attrit: the defender spends available orders up to its issued attack strength, stripping incoming embedded orders. Each state has a capturable State structure anchoring protected territory; disconnected unprotected territory is annexed into surrounding protected mainlands. Elevation tiers color the map. This is not the final combat model.
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
9. **Do not treat EXP-001 as final design.** Free attacks, 108 states, 10-second attack-order grants, and the card pool are stress-test choices; read [docs/EXPERIMENTS.md](docs/EXPERIMENTS.md) before building on them.
10. **Growth layers only select frontier candidates.** Ownership, edge connectivity, capture budget, order lifetime, and checksums stay in `simulation.ts`. Never let a layer bypass those checks.
11. **Distance-based growth starts at the border.** The attack anchor is the rounded centroid of the initial seed contact; the clicked cell is only a target/search selector. Do not anchor growth on a deep click.
12. **Growth selection must be deterministic.** Integer keys/tie-breaks; organic randomness comes only from its per-attack seeded PRNG. Include frontier state and growth mode in checksums.
13. **Mutual fronts attrit at contact.** Claim provenance is authoritative. The defender spends `min(issued attack strength, remaining attack-order inventory, incoming embedded orders)` and strips one embedded order per spent order. At 0 the incoming front halts; otherwise it pauses for the tick. No spendable orders lets it break through. Do not affect unrelated pairs.
14. **Annex only to a surrounding protected mainland.** A component is protected if it contains a live State structure of the same owner; ties and border counts are deterministic. Leave islands with no foreign-protected contact alone.
15. **State structures are authoritative objects.** Place one at each start, destroy it when its cell changes owner, include it in snapshots/checksums, and render it from registry/snapshot state. Do not infer protection from component size.
16. **Defense is derived and integer.** `1 + elevation + occupied + aura`; do not add a mutable defense array or float modifier. Attack budget and capture cost scale with embedded orders; requeue an unaffordable candidate rather than losing it.
17. **Elevation is versioned map data.** Changing tier thresholds, level count, or defense meaning requires `MAP_VERSION`/protocol review and updated tests.
18. **Structure effects are defined by type and derived into overlays.** State auras stamp +20 with max-overlap semantics; Defense Posts add. A buildable defense aura covers **every cell in its own district** and ignores effect radius. State has no district and keeps its 16 px radius. Barracks is not an aura: each stack adds one embedded order to every attack the owner launches and raises its defensive clash strength. Defensive auras require owner match. Rebuild derived auras when structures or districts change; include effect descriptors in public structure payloads. Do not serialize a mutable per-cell aura array.
19. **Card economy is command-driven.** Build and district-upgrade commands queue and apply inside `step()`. Builds validate gold/card/owned land/empty structure slot/**8 px structure spacing**; a card landing in a matching district pays `base card cost + current level`, while a new structure pays base cost. Click upgrades resolve the district's structure and spend `base card cost + projected current level` without consuming a card. The permanent five-card hand has no draw, deck, consumption, or reroll; repeat purchases are allowed. Captured structures are razed.
20. **Attack orders are per-player integer charges, separate from embedded attack orders.** A launch spends exactly one inventory order and embeds `1 + Barracks stacks`; clicking again creates a separate attack and never upgrades it. Every 100 ticks each living player gains 1 base order, clamped to the cap. Command Posts accrue continuously toward 600-point order chunks. Include inventory orders, embedded/initial orders, lifetimes, the base grant timer, and command-post accrual in checksums.
21. **Districts are bounded, owner-local Voronoi regions.** They are derived from owners + buildable structure ranges, with deterministic integer noise on distance comparisons and a `DISTRICT_NOISE_MARGIN` scan margin; never serialize a mutable authoritative district map. Ties use type code then structure id. Auras must check `districtStructureIds[index] === structure.id` for buildables. New district recomputation happens on structure creation/destruction; ordinary captures update one cell. State capitals have no district.
22. **Multiple structures/districts per owner/type are allowed.** Same-type drops inside a district increment that district's stacks; same-type drops outside all districts create another district. Different types inside a district are rejected. Stacking must not change district geometry.
23. **Do not reintroduce per-attack Sets without measurements.** Prefer flat structures; the current layers use a number-array heap, radial-band arrays, or an array + RNG.
24. **Least resistance samples, it does not globally re-sort.** Each capture samples `LEAST_RESISTANCE_SAMPLE_SIZE` (10) candidates in growth order, picks the integer-cheapest effective defense, requeues the rest, and breaks ties by sample order. It must stay deterministic and must not bypass connectivity, ownership, mutual-contact, or budget checks.
25. **Embedded orders scale attacks.** Points = `30 + 15 × (orders − 1)`, capture cost = `max(1, defense − orders + 1)`, lifetime = `50 + 10 × (initialOrders − 1)`. Do not merge clicks or spend extra inventory on a stronger existing front.

## Where things live

- `src/routes/+page.svelte` — screen flow and HUD. Large file by design; keep gameplay rules out.
- `src/lib/components/GameCanvas.svelte` — canvas/fixed loop/pointer; do not add simulation logic here.
- `src/lib/game/constants.ts` — rules and palette. Changing these can change match outcomes.
- `src/lib/game/simulation.ts` — the core. Prefer focused edits and add tests.
- `src/lib/game/growth/` — growth-layer interface, factory, and circular/radial-band smooth/organic implementations. Keep simulation invariants out of these modules.
- `src/lib/game/growth/growth.test.ts` — layer selection invariants.
- `src/lib/game/Structures/` — one definition file per structure type (`state.ts`, `mine.ts`, `barracks.ts`, `defense-post.ts`, `command-post.ts`, `war-academy.ts`), plus shared `types.ts`, `definitions.ts`, `registry.ts`, and `index.ts`.
- `src/lib/game/economy.test.ts` — permanent hand, income, repeat-build/stack, and effect invariants.
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
8. Confirm elevation colors and contours render, hovering shows the correct tier/base/total defense, and attacks divert into cheaper frontier cells instead of stalling on a high-defense strongpoint.
9. Confirm State structure capital-star circles are drawn at capitals, aura circles are absent, minimap ringed dots track them, and the commander readout says ANCHORED.
10. Hover an aura pixel and confirm the defense readout includes `AURA +20` and the total is raised accordingly over the 16 px radius.
11. Deploy, confirm all five CCG cards are free-floating at bottom center with no empty placeholders; move the pointer off the hand and confirm it sinks to a peeking strip, then re-enters to raise it.
12. Drag a card and confirm there is no ghost card at the cursor: a curved arrow runs from the raised card, and the landing exclusion circle is green for legal cells and red for blocked cells.
13. Confirm buildable districts have subtly irregular extents and borders, render with a type tint and per-district variation, and remain separable even when same-type.
14. Drop a new type inside a district and confirm rejection with no cost. Drop the same type inside its district and confirm it stacks (marker count and stronger effect); drop the same type outside all districts and confirm it creates another district.
15. Drop into controlled territory; confirm gold is spent and the structure appears while the card stays in hand. Try a drop within 8 px of an existing structure and confirm it is rejected at no cost.
16. Zoom in and out and confirm structure icons keep the same screen size (15/11 px State, 10 px buildable) rather than growing with zoom.
17. Build a card, confirm it stays in the hand, and buy it again after gold recovers; confirm there is no Refresh control.
18. Confirm the compact ORDERS readout beside gold drops per launch, accepts up to 3 immediate human attacks, rejects a fourth, and gains only +1 (not a full refill) after 10 seconds.
19. Build a Command Post and observe orders arriving gradually over the next 60 seconds; build a War Academy and confirm the order cap rises.
20. Click anywhere inside one of your buildable districts and confirm its structure gains a level without consuming a card.
21. Capture a structure (or fabricate a capture in a test) and confirm it disappears with its effects, the owner shows NO ANCHOR, districts recompute, and a war-feed event appears.
22. Run ORGANIC for several seconds; confirm mutual fronts trade orders instead of interpenetrating, no isolated owner specks remain, and repeated clicks create separate attacks rather than upgrading one.
23. Check the HUD perf readout: calls/s should be modest; heavy full-resync chunks are expected under saturation.
24. Drag-pan for several seconds with ~100 fronts and confirm no periodic 10 Hz hitch.
25. Test a narrow viewport and scroll the 108-state leaderboard to the bottom.

## Style

- TypeScript strict mode; explicit public types.
- Svelte 5 runes, not legacy reactive syntax.
- Prefer `#lib` subpath imports in app/components.
- Use `pnpm format` before finishing (Prettier).
- Comments explain invariants and why, not obvious code.
- Avoid adding dependencies unless they remove meaningful complexity.
