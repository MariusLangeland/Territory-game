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

- **Current model — Frontage v1:** 51 states (1 human + 50 AI). One **supply** resource pays for cards, upgrades, and durable fronts. Supply income/cap derive from territory, Command Posts, and War Academies; the cap has **no global maximum**. Artillery is an active siege structure: 1000 supply to build, 300 supply per level fired, 140 px range, 6 s cooldown, one 2 s shell per level with ±36 px spread, 12 px blast, 64 px district, 16 px build clearance, and immunity for State structures. Cards cost 40/80/120/160/240 supply for Fortification/Command Post/War Academy/Jammer/Barracks, upgrades cost `base + 5 × current level`, and Fortifications add +1 defense. Effective attack levels are `max(0, attacker Barracks stacks − defender Jammer stacks)`. A launch costs `30 + 15 × effective levels` and grants `1500 + 450 × levels` strength; power/piercing use `logTier = floor(log2(levels + 1))`. Jammers suppress enemy attacks globally without adding pixel defense. Captures spend power and strength; mutual contact trades `100 + 50 × opponent logTier` once per pair per tick. No fixed lifetime; 20 idle ticks kill a front. Cancellation refunds `floor(cost × remaining/initial strength)`. Holding 70% of land wins instantly; no time limit. State structures project +20 aura over 16px; districts are bounded noisy Voronoi regions; mutually hostile bots use personality profiles, threat reserves, and staggered build ticks.
- Implemented: seeded 2048×1024 world, 51 starts, supply economy, durable fronts/attrition/cancellation/70% victory, State/buildable structures, bot personalities/threat defense, districts/auras/noise cleanup, growth layers, claim provenance, determinism/checksums, WebGPU dirty-tile rendering, 51-state HUD, onboarding, keyboard cursor, pinch zoom, telemetry, tests, benchmark.
- Not implemented: coordinated team bot AI, online server/WebSockets/lobbies/accounts/persistence, replay viewer, fog, audio, 320–430px mobile validation.
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
5. **Protect input latency:** use the dirty-tile path for normal updates. District palette changes report `districtTiles` and rewrite only alpha bytes for those tiles; do not force a full control-texture rebuild for a structure build. Heavy/dispersed updates may switch to adaptive full-texture resync, but it must be chunked across frames; never block a single frame with a full-map upload. Keep HUD snapshots throttled and the leaderboard virtualized.
6. **Renderer never mutates simulation state.**
7. **Version intentional changes:** map generation → `MAP_VERSION`; wire changes → `NET_PROTOCOL_VERSION`; simulation changes → determinism review + tests.
8. **Do not claim online support.** It is a documented target, not current behavior.
9. **Frontage v1 is the current combat model.** Supply, durable strength, attrition, refunds, and 70% victory are implemented; EXP-001 is retired. Read [docs/COMBAT_DESIGN.md](docs/COMBAT_DESIGN.md) before changing combat constants.
10. **Growth layers only select frontier candidates.** Ownership, edge connectivity, capture budget, order lifetime, and checksums stay in `simulation.ts`. Never let a layer bypass those checks.
11. **Distance-based growth starts at the border.** The attack anchor is the rounded centroid of the initial seed contact; the clicked cell is only a target/search selector. Do not anchor growth on a deep click.
12. **Growth selection must be deterministic.** Integer keys/tie-breaks; organic randomness comes only from its per-attack seeded PRNG. Include frontier state and growth mode in checksums.
13. **Mutual fronts attrit at contact.** Claim provenance is authoritative. Both fronts lose `100 + 50 × opponent logTier` durable strength simultaneously, once per pair per tick. At 0 strength the front dies; the survivor pauses. Do not affect unrelated pairs.
14. **Annex only to a surrounding protected mainland.** A component is protected if it contains a live State structure of the same owner; ties and border counts are deterministic. Leave islands with no foreign-protected contact alone. Every 100 ticks, separately fill neutral pockets ≤96 cells that border an owner into the largest-border owner (lower id on ties). Ocean contact is allowed for that cleanup; ownerless islands and larger neutral regions are skipped.
15. **State structures are authoritative objects.** Place one at each start, destroy it when its cell changes owner, include it in snapshots/checksums, and render it from registry/snapshot state. Do not infer protection from component size.
16. **Defense is derived and integer.** `1 + elevation + occupied + aura`; do not add a mutable defense array or float modifier. Fronts have per-tick power and a durable strength pool; both must pay `max(1, defense − logTier)`. Requeue an unaffordable candidate rather than losing it.
17. **Elevation is versioned map data.** Changing tier thresholds, level count, or defense meaning requires `MAP_VERSION`/protocol review and updated tests.
18. **Structure effects are defined by type and derived into overlays.** State auras stamp +20 with max-overlap semantics; Fortifications add +1 per stack. A buildable defense aura covers **every cell in its own district** and ignores effect radius. State has no district and keeps its 16 px radius. Barracks raises attack strength/cost linearly and speed/piercing by log2 tiers, uncapped. Jammer is a global suppression aura that subtracts effective enemy Barracks levels and never changes pixel defense. Defensive auras require owner match. Rebuild derived auras when structures or districts change; include effect descriptors in public structure payloads. Do not serialize a mutable per-cell aura array. High-frequency attack/income lookups use the structure stack cache; direct stack mutation outside the registry must invalidate it.
19. **Card economy is command-driven.** Build and district-upgrade commands queue and apply inside `step()`. Builds validate supply/card/owned land/empty structure slot/**8 px structure spacing**; a card landing in a matching district pays `base card cost + 5 × current level`, while a new structure pays base cost. Click upgrades resolve the district's structure and spend `base card cost + 5 × projected current level` without consuming a card. Merged same-owner/same-type districts select the lowest projected structure first; merged commands pin `structureId` so a noisy Voronoi centre assignment cannot redirect them. Holding Ctrl disables merging and targets the clicked structure. The permanent six-card hand has no draw, deck, consumption, or reroll; repeat purchases are allowed. Captured structures are razed.
20. **Supply is the only resource and the cap is uncapped.** Cards, upgrades, and fronts spend supply. Cap is `120 + territory/1000 + 40 × War Academy stacks` with no upper bound. A launch uses effective Barracks levels minus defender Jammers; cost/strength scale linearly and power/pierce logarithmically. Cancellation refunds `floor(launchCost × remainingStrength / initialStrength)`. Include supply/accrual, front strength/initial strength/power/pierce/idle ticks, and grievance/threat state in checksums.
21. **Districts are bounded, owner-local Voronoi regions.** They are derived from owners + buildable structure ranges, with deterministic integer noise on distance comparisons and a `DISTRICT_NOISE_MARGIN` scan margin; never serialize a mutable authoritative district map. Ties use type code then structure id. Auras must check `districtStructureIds[index] === structure.id` for buildables. New district recomputation happens on structure creation/destruction; ordinary captures update one cell. State capitals have no district.
22. **Multiple structures/districts per owner/type are allowed.** Same-type drops inside a district increment that district's stacks; same-type drops outside all districts create another district. Different types inside a district are rejected. Stacking must not change district geometry.
23. **Do not reintroduce per-attack Sets without measurements.** Prefer flat structures; the current layers use a number-array heap, radial-band arrays, or an array + RNG.
24. **Least resistance samples, it does not globally re-sort.** Each capture samples `LEAST_RESISTANCE_SAMPLE_SIZE` (10) candidates in growth order, picks the integer-cheapest effective defense, requeues the rest, and breaks ties by sample order. It must stay deterministic and must not bypass connectivity, ownership, mutual-contact, or budget checks.
25. **Frontage v1 scales infinitely.** Effective levels = `max(0, attacker Barracks stacks − defender Jammer stacks)`. Strength = `1500 + 450 × levels`; launch cost = `30 + 15 × levels`; `logTier = 31 - clz32(levels + 1)`; power = `30 + 15 × logTier`; pierce = `logTier`; capture cost = `max(1, defense − logTier)`; contact damage = `100 + 50 × opponent logTier`. No caps. No fixed lifetime; idle 20 captureless ticks. Do not merge clicks or reinforce an existing front.
26. **Artillery is expensive, inaccurate, and deterministic.** Build cost 1000; it requires `ARTILLERY_BUILD_CLEARANCE` (16 px) free of existing districts and has a 64 px district. A fire command queues/resolves next tick; every ready battery within `ARTILLERY_RANGE` fires `stacks` shells at `ARTILLERY_SUPPLY_COST_PER_LEVEL` (300) each. The full volley cost is validated and spent before cooldowns/shells. Shells land after `ARTILLERY_SHELL_TRAVEL_TICKS` with deterministic `ARTILLERY_SHELL_SPREAD` (±36), no target snapping, then remove one level from the nearest non-State hostile structure within `ARTILLERY_BLAST_RADIUS`. States are immune. Cooldown is per battery. Include shell ids/positions/ticks and cooldowns in checksums.

27. **Merged districts are a throttled visual/upgrade convenience.** Touching same-owner districts of one type form groups via a union scan of `districtStructureIds`; membership recomputes at most every 5 ticks and stack totals refresh per read. The territory shader removes internal seams by comparing the district type base when `mergeDistrictSeams` is on; the 2D overlay draws one combined icon per multi-structure group. Gameplay auras/districts remain per-structure. Ctrl turns the shader flag and icon merging off and directs upgrades to the clicked structure. Do not serialize groups into checksums.

28. **Bot strategy is deterministic hash-derived state.** `botProfiles` derive aggression/economy/fortification/command/vengeance/caution/conciliation/opportunism and a six-type `buildPlan` from `hash32` of seed and player id, never from the shared PRNG. Bots accrue supply continuously, build the next placeable type in their plan, and upgrade the lowest-level existing type when no new placement is possible; they choose targets by scoring neutral expansion, grudges, target strength, active attacks on the target, and the target's available supply. Aggression gates attempt frequency. Record per-defender grievances on capture, include them and bot gold/accrual in checksums. Refresh threat/posture/reserve once per decision tick (active fronts 25 cap 50, hostile contact 1 cap 8, recent grievances 2 cap 20; enter at 20, leave at 10). Threatened bots reserve up to 40 supply for a Fortification, then Barracks, then the cheaper upgrade; the reserve releases after 3 stalled build intervals and is biased toward retaliation. New/destroyed buildables refresh districts only within their own range (`refreshDistrictsAround`), never with a full-map rebuild, and report `districtTiles` for alpha-only dirty uploads. Stagger bot build ticks by player id across `BOT_BUILD_INTERVAL`; batch the aura rebuild once per simulation tick.

## Where things live

- `src/routes/+page.svelte` — screen flow and HUD. Large file by design; keep gameplay rules out.
- `src/lib/components/GameCanvas.svelte` — canvas/fixed loop/pointer; do not add simulation logic here.
- `src/lib/game/constants.ts` — rules and palette. Changing these can change match outcomes.
- `src/lib/game/simulation.ts` — the core. Prefer focused edits and add tests.
- `src/lib/game/growth/` — growth-layer interface, factory, and circular/radial-band smooth/organic implementations. Keep simulation invariants out of these modules.
- `src/lib/game/growth/growth.test.ts` — layer selection invariants.
- `src/lib/game/Structures/` — one definition file per structure type (`state.ts`, `artillery.ts`, `barracks.ts`, `fortification.ts`, `jammer.ts`, `command-post.ts`, `war-academy.ts`), plus shared `types.ts`, `definitions.ts`, `registry.ts`, and `index.ts`.
- `src/lib/game/economy.test.ts` — permanent hand, income, repeat-build/stack, and effect invariants.
- `src/lib/game/integrity.ts` — connected-component planning, detached-territory annexation, and neutral-pocket cleanup.
- `src/lib/game/integrity.test.ts` — anchored-mainland, island, and tie-break invariants.
- `src/lib/components/GameCanvas.svelte` — structure markers use the same camera on a transparent 2D overlay.
- `src/lib/game/render/territory-renderer.ts` — GPU resource lifecycle and uploads.
- `src/lib/game/render/territory.wgsl.ts` — shader source as a TypeScript string.
- `src/lib/game/net/protocol.ts` — protocol draft; keep docs synchronized.
- `scripts/benchmark.ts` — performance baseline, including all growth layers.
- `scripts/telemetry.ts` — deterministic headless multi-seed match metrics ([docs/TELEMETRY.md](docs/TELEMETRY.md)).
- `docs/COMBAT_DESIGN.md` — implemented Frontage v1 design and rationale.

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
4. Deploy, confirm the 51-state virtualized leaderboard and active-front count; scroll it to the last rank.
5. Click a frontier, confirm a success toast and territory growth.
6. Pause with Space and confirm the tick freezes.
7. Switch the growth layer through CIRCULAR / SMOOTH / ORGANIC and confirm new attacks use it while in-flight orders keep theirs.
8. Confirm elevation colors and contours render, hovering shows the correct tier/base/total defense, and attacks divert into cheaper frontier cells instead of stalling on a high-defense strongpoint.
9. Confirm State structure capital-star circles are drawn at capitals, aura circles are absent, minimap ringed dots track them, and the commander readout says ANCHORED.
10. Hover an aura pixel and confirm the defense readout includes `AURA +20` and the total is raised accordingly over the 16 px radius.
11. Deploy, confirm all six CCG cards are free-floating at bottom center with no empty placeholders; move the pointer off the hand and confirm it sinks to a peeking strip, then re-enters to raise it.
12. Drag a card and confirm there is no ghost card at the cursor: a curved arrow runs from the raised card, and the landing exclusion circle is green for legal cells and red for blocked cells.
13. Confirm buildable districts have subtly irregular extents and borders, render with a type tint and per-district variation, and remain separable even when same-type.
14. Drop a new type inside a district and confirm rejection with no cost. Drop the same type inside its district and confirm it stacks (marker count and stronger effect); drop the same type outside all districts and confirm it creates another district.
15. Drop into controlled territory; confirm supply is spent and the structure appears while the card stays in hand. Try a drop within 8 px of an existing structure and confirm it is rejected at no cost.
16. Zoom in and out and confirm structure icons keep the same screen size (15/11 px State, 10 px buildable) rather than growing with zoom.
17. Build a card, confirm it stays in the hand, and buy it again after supply recovers; confirm there is no Refresh control.
18. Confirm the horizontal supply bar fills toward cap with current supply left and max right inline, sits just above the collapsed hand, is covered by raised cards, and overlays a red cost segment when hovering a valid frontier/upgrade/artillery click. Confirm CANCEL FRONT refunds a proportional strength share.
19. Build a Command Post and observe supply income rise by 2/s; build a War Academy and confirm supply cap rises by 40. Build Artillery only after creating 16 px of district clearance; confirm FIRE / `A` shows range rings, shells scatter widely, and a State structure is never destroyed by a hit.
20. Click anywhere inside one of your buildable districts and confirm its structure gains a level without consuming a card. Hover it and confirm the cursor tooltip shows the total cost; hold Shift and confirm the tooltip shows the five-level total, then Shift-click and confirm exactly five levels are queued. Build two touching same-type districts and confirm their seams disappear and one combined-level icon shows their total; click one and confirm the lowest-level structure upgrades first. Hold Ctrl and confirm individual seams/icons return and the clicked structure is upgraded.
21. Capture a structure (or fabricate a capture in a test) and confirm it disappears with its effects, the owner shows NO ANCHOR, districts recompute, and a war-feed event appears.
22. Run ORGANIC for several seconds; confirm mutual fronts trade strength instead of interpenetrating, no isolated owner specks remain, and repeated clicks create separate attacks rather than upgrading one.
23. Check the HUD perf readout: calls/s should be modest; heavy full-resync chunks are expected under saturation.
24. Drag-pan for several seconds with ~100 fronts and confirm no periodic 10 Hz hitch.
25. Test a narrow viewport and scroll the 51-state leaderboard to the bottom.

## Style

- TypeScript strict mode; explicit public types.
- Svelte 5 runes, not legacy reactive syntax.
- Prefer `#lib` subpath imports in app/components.
- Use `pnpm format` before finishing (Prettier).
- Comments explain invariants and why, not obvious code.
- Avoid adding dependencies unless they remove meaningful complexity.
