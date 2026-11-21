# Architecture

This document describes the code as it exists in v0.44.0. For current rules, the attack experiment, and future online design, read [SPEC.md](SPEC.md), [EXPERIMENTS.md](EXPERIMENTS.md), and [NETWORKING.md](NETWORKING.md).

---

## 1. High-level shape

Territory is a client-rendered SvelteKit application with a pure TypeScript simulation core. There is no backend in v0.44.0. The simulation and renderer are deliberately hard to couple: they exchange a packed change batch after each tick and share immutable map arrays.

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Svelte route: src/routes/+page.svelte                                │
│  - screen state, HUD values, overlays, toasts, seed flow             │
│  - calls camera bridge and simulation.enqueueAttack                  │
│  - receives HUD snapshots at 5 Hz; territory renders at 10 Hz        │
└───────────────▲───────────────────────────────┬──────────────────────┘
                │ GameSnapshot                   │ props / callbacks
                │                                ▼
┌───────────────┴──────────────────────────────────────────────────────┐
│ GameCanvas.svelte                                                    │
│  - owns requestAnimationFrame loop and fixed-step accumulator        │
│  - owns pointer/wheel input and camera bridge actions                │
│  - calls simulation.step(), consumes changes, renders every frame    │
└───────┬──────────────────────────────────────────────────┬───────────┘
        │ change batch                                     │ arrays + camera
        ▼                                                  ▼
┌──────────────────────────────┐              ┌─────────────────────────┐
│ TerritorySimulation          │              │ TerritoryRenderer       │
│  - owners / land / shade     │              │  - control texture      │
│  - elevation / defense       │              │  - elevation channel    │
│  - players, attacks, RNG     │              │  - palette / uniforms   │
│  - no DOM, no clock          │              │  - WGSL pass            │
└──────────────────────────────┘              └─────────────────────────┘
```

`Minimap.svelte` reads the simulation arrays and camera view independently to paint a throttled 2D overview.

---

## 2. Module map

| Module                                      | Layer     | Responsibility                                                                        | Key exports                  |
| ------------------------------------------- | --------- | ------------------------------------------------------------------------------------- | ---------------------------- |
| `src/routes/+page.svelte`                   | UI        | Layout, HUD, intro/result/help/error overlays, input commands, seed flow              | Svelte component             |
| `src/routes/+page.ts`                       | UI        | Disables SSR; the game is browser-only                                                | `ssr = false`                |
| `src/lib/components/GameCanvas.svelte`      | Driver    | Canvas lifecycle, fixed timestep, pointer handling, camera bridge                     | Svelte component             |
| `src/lib/components/Minimap.svelte`         | UI        | 2D owner overview and camera rectangle                                                | Svelte component             |
| `src/lib/game/constants.ts`                 | Rules     | Map size, balance, palette, names, versions                                           | constants, helpers           |
| `src/lib/game/rng.ts`                       | Core      | Mulberry32 deterministic PRNG                                                         | `DeterministicRng`           |
| `src/lib/game/map.ts`                       | Core      | Seeded map generation, terrain shade, elevation tiers, starts                         | `generateMap`, `hash32`      |
| `src/lib/game/simulation.ts`                | Core      | World state, free attacks, bots, checksums, snapshots                                 | `TerritorySimulation`, types |
| `src/lib/game/growth/`                      | Core      | Pluggable frontier selection: circular heap, smooth radial bands, organic random pool | `GrowthLayer`, factory       |
| `src/lib/game/integrity.ts`                 | Core      | Component labeling, detached-territory annexation, neutral-pocket cleanup             | `TerritoryIntegrity`         |
| `src/lib/game/Structures/`                  | Core      | Per-type structure definitions, shared types, registry, and effects                   | `StructureRegistry`, cards   |
| `src/lib/game/net/protocol.ts`              | Contract  | Future wire message shapes                                                            | message types, guard         |
| `src/lib/game/render/camera.ts`             | Render    | Camera state and coordinate transforms                                                | `MapCamera`                  |
| `src/lib/game/render/camera-bridge.ts`      | UI/Render | Imperative camera actions without component exports                                   | `GameCameraBridge`           |
| `src/lib/game/render/territory.wgsl.ts`     | Render    | Vertex and fragment shader source                                                     | `TERRITORY_SHADER`           |
| `src/lib/game/render/territory-renderer.ts` | Render    | WebGPU device, textures, pipeline, adaptive chunked uploads, frame submission         | `TerritoryRenderer`          |
| `scripts/benchmark.ts`                      | Tooling   | Map/tick/checksum benchmark                                                           | CLI                          |

---

## 3. Simulation

### 3.1 State ownership

`TerritorySimulation` is the single source of truth for:

- `owners: Uint16Array` — length 2,097,152; owner id per cell, `0` for unclaimed.
- `land: Uint8Array` — static land mask.
- `shade: Uint8Array` — static terrain brightness for the renderer.
- `elevation: Uint8Array` — six discrete terrain tiers; base defense = `1 + elevation`.
- `players: PlayerState[]` — alive flag, territory count, derived frontier sets.
- `attacks: AttackState[]` — per-front growth layer, anchor, durable strength, power, pierce, idle counter, effective Barracks levels, and captures.
- `artilleryShells: ArtilleryShell[]` — in-flight shells with source, impact point, launch tick, and arrival tick.
- `artilleryCooldownUntil: Map<structureId, tick>` — per-battery active-ability cooldown.
- `claimedBy: Uint32Array` — id of the attack that most recently captured each cell; used to detect mutual front contact. Starting territory is 0.
- `structures: StructureRegistry` — live structures. One State structure is created at each state's start cell; `at(index)` is the capture lookup and `forOwner()` feeds the derived structure-stack cache.
- `auraDefense: Uint16Array` — derived per-cell defense bonus. Defense auras with `max` stacking (State) are applied first, then additive auras (Fortifications), only on cells owned by the structure owner and covered by that structure's district. State auras use their fixed radius. Rebuilt on structure changes; captured cells are locally recomputed.
- `districtTypes: Uint8Array` — structure-type code of each cell's district, or 0.
- `districtStructureIds: Uint32Array` — winning structure id for each district cell; needed now that an owner can have multiple same-type structures.
- `districtColorCodes: Uint8Array` — 5-bit render palette (type group plus per-district variant) packed into the control texture.
- Districts are derived from owners + structures by a bounded Voronoi pass; State structures have `districtRange: 0` and are skipped.
- `defenseAt` = `1 + elevation + occupied + aura`. Capture cost is `max(1, defenseAt − pierce)` paid from power and strength.
- Supply: `gold` holds human supply (legacy field name), `goldAccrual` the human remainder, `botGold`/`botGoldAccrual` the bot equivalents. Income is `3 + floor(territory/1000) + supply-income effects` per second (+1/s per 1,000 owned pixels) with no income cap; cap is `120 + territory/1000 + 80 × Academy stacks` with no upper bound. `supplyCap` is public.
- No attack-order inventory exists. Front launch cost/strength derive from effective live Barracks levels; power/pierce derive from integer log2 tiers. A defending Jammer subtracts one effective level per stack.
- `structureStacksByType` caches owner/type stack totals and refreshes only when `StructureRegistry.version` changes, so per-tick income and per-launch attack stats do not scan every structure.
- Permanent hand: all six buildable types with fixed ids, available for repeat purchases; no draw, consumption, or reroll.
- Bot economy: `botGold`, `botGoldAccrual`, and deterministic `botProfiles` (traits plus per-type affinity). Bots use utility scores, strategic reserves, cap growth, and expansion pressure rather than a fixed build script.
- Bot budgets and profiles affect checksums through their supply and the structures they create.
- Structure stacks: multiple structures and districts of the same type are allowed. `structure.stacks` multiplies supply income, aura defense, effective attack levels, Jammer suppression, and supply cap.
- `rng: DeterministicRng` — simulation PRNG.
- `tick`, `winnerId`, `ended`.
- Pending command queue and packed change buffer.

The public arrays are exposed read-only-by-convention for the renderer and minimap. Nothing outside the simulation writes to them.

### 3.2 Ownership representation and packing

- Owner values are `1..51`; `Uint16Array` allows headroom for future player counts.
- The renderer only needs a byte per owner. It packs changed cells as:

```text
 31                    21 20                    0
┌───────────────────────┬───────────────────────┐
│ owner (11 bits used)  │ pixel index (21 bits) │
└───────────────────────┴───────────────────────┘
```

Because `2048 × 1024 = 2²¹`, indices fit exactly. Decode:

```ts
const owner = packed >>> 21;
const index = packed & 0x1f_ffff;
```

### 3.3 Change buffer

- `Uint32Array(16_384)` reused each tick.
- `step()` resets `changeCount` and `changesOverflow`.
- Every ownership transition writes one word.
- The driver calls `renderer.applyChanges(result.changes, result.changeCount, result.changesOverflow, result.districtsChanged, result.districtTiles)` before the next tick.
- District changes rewrite only the packed alpha channel in the reported 32 × 32 tiles. A full control-texture rebuild happens only on overflow or an explicit resync. Game state is unaffected.

Supply income and launch costs bound active fronts. The 16,384-word change buffer remains comfortably above observed capture batches; defense spending reduces the actual capture count. Stress tests assert no overflow during sustained runs.

### 3.4 Derived frontier sets

Each player has a `Set<number>` of frontier cells. This is a cache, not independent truth.

- Rebuilt once after starting territories are painted.
- On `claim(index, newOwner)`:
  - remove the old cell from the old owner's set;
  - assign the new owner and refresh the new cell;
  - refresh the four neighbours because their frontier status may have changed.
- `isBorderCell` checks the four adjacent cells for land owned by a different player.
- The sets are updated deterministically because insertion/removal order follows deterministic claim order. Bot frontier sampling iterates the set in insertion order and draws a seeded index.

If a bug is suspected, a brute-force border scan in `simulation.test.ts` compares every player's set against the full map.

### 3.5 Tick pipeline

```text
step()
 ├─ reset change batch
 ├─ if ended: emit snapshot only
 ├─ tick += 1
 ├─ apply pending growth-mode switch
 ├─ accrue supply from territory/Command Posts every tick
 ├─ applyPendingCommands()
 │    └─ sort by (sequence, playerId), validate, spend supply, create fronts/builds
 ├─ runBotEconomy() every 30 ticks (save, build/upgrade focus structure)
 ├─ runBotDecisions() every 10 ticks (requires launch supply)
 ├─ runBotArtillery() every 10 ticks (ready batteries target hostile structures)
 ├─ processArtilleryShells() (2-second flight; blast damages one structure level)
 ├─ processAttacks()
 │    ├─ drop fronts at zero strength or after 20 idle ticks
 │    ├─ for each attack id: sample up to 10 top growth-layer candidates
 │    ├─ validate target ownership + attacker border at capture time
 │    ├─ on opposing claim: trade durable strength once per pair
 │    ├─ take the cheapest sampled defense and requeue the rest
 │    ├─ claim until power/strength runs out, write provenance, push neighbours
 │    ├─ destroy any structure if its cell is captured and rebuild auras
 │    ├─ skip stale/disconnected candidates without spending attack points
 │    ├─ drop a front if it had zero legal captures this tick
 │    └─ drop completed/expired attacks
 ├─ every 10 ticks or after a cancellation: annex detached components
 ├─ every 100 ticks: fill small neutral pockets into their dominant neighbour
 ├─ updateEliminations()
 ├─ checkVictory()
 └─ buildSnapshot()
```

No rendering, DOM, timers, or promises are present in this path.

### Bot strategy layer

Each bot receives a deterministic `BotProfile` derived from `hash32` of the player id and world seed: aggression, economy, fortification, command, vengeance, caution, conciliation, opportunism, and a per-type `structureBias` (with a display-only sorted `buildPlan`). No new RNG stream is introduced.

- At every `BOT_DECISION_INTERVAL` (10 ticks), `updateBotThreat` refreshes active-attacker pressure and a per-bot integer threat score: active fronts (25 each, cap 50), hostile border contact (1 each, cap 8), and recent grievance deltas (2 each, cap 20). Posture enters at 20 and leaves at 10, with a 40-supply defensive reserve and a 3-interval stall release.
- Each bot evaluates construction once per `BOT_BUILD_INTERVAL` (30 ticks), staggered by player id. `chooseBotEconomicAction` scores every build and upgrade candidate from affinity, novelty / repeated-copy penalty, threat response (diluted by existing defense stacks), income and cap pressure, and a small cost-efficiency term. It picks the highest-scoring placeable action. Threat is a utility input, not a forced Fortification→Barracks order.
- Strategic savings: after two buildables, `botAspiration` selects the highest-affinity missing type with a cap-overrun penalty. `botStrategicReserve` holds its cost (or War Academy cap-growth cost when the stock cap is the bottleneck) until affordable. `botEconomicBuffer` also prevents attack spending from draining the next economic purchase. Up to two non-defensive actions execute per interval; a threatened bot executes at most one defensive action, and defensive candidates may use the defensive reserve.
- Expansion: when any missing type has no legal build cell, `botNeedsExpansion` makes expansion the priority; attack spending then ignores the economic/aspiration reserves.
- Each new/destroyed buildable refreshes districts only within its own range; aura rebuilds batch once after all bots act.
- `runBotDecisions` computes player strength (`territory/4 + structure levels*300 + supply*2`), samples border neighbours, and uses `scoreBotTarget`. Attack chance is then derived from target score, aggression, supply pressure, and held reserves, replacing the old flat aggression roll. Threat biases retaliation: a grudge holder gains a large bonus, an active attacker a counter bonus, and unrelated neighbours a penalty.
- `scoreBotTarget` combines neutral-expansion score, aggression, stored grievances, opportunism × target pressure, and caution/conciliation penalties against stronger targets or targets holding launch supply. Vengeful bots retaliate, cautious bots avoid retaliation-capable targets, conciliatory bots avoid stronger neighbours, and opportunistic bots pile onto contested or weak targets.
- Captures increment `botGrievance[defender * PLAYER_COUNT + attacker]`, capped at 65,535.
- Profiles, affinities, and utility decisions are hash-derived/deterministic; bot supply, accrual, grievance counts, threat, posture, reserve, stall counters, and grievance marks are checksummed.

### Conflicting fronts

Each attack capture writes its id into `claimedBy[index]`. Before claiming a candidate, the attacking front checks the four neighbouring cells for a claim from an active mutual attack (`other.attackerId === attack.defenderId` and vice versa). On contact:

- both fronts lose `100 + 50 × opponent logTier` strength simultaneously;
- damage is applied once per pair per tick;
- at 0 strength a front dies; otherwise it pauses on the contact line and keeps its frontier.

This is front-line attrition, not a global truce: attacks against other states and third-party attacks continue.

For each capture, the simulation pops up to `LEAST_RESISTANCE_SAMPLE_SIZE` (10) candidates from the attack's growth layer, validates them, and picks the one with the lowest effective defense cost. The unchosen candidates are pushed back, so geometry still bounds the choice, but a costly strongpoint does not consume the whole budget while a cheaper adjacent lane exists. If even the cheapest sampled candidate costs more than remaining power or strength, all are requeued and the tick ends. The capture spends `max(1, defense − pierce)` from both pools. Defense is derived from elevation and live ownership; it is not allocated per attack.

Attack frontier processing also enforces border connectivity at capture time: the candidate cell must share a land edge with the attacker. If opposing fronts sever that path, the candidate is skipped. A front that captures nothing for 20 consecutive ticks dies; a clash resets the idle counter. This prevents enclaves, phase-through attacks, and indefinitely stalled fronts.

### Growth layers

Each `AttackState` owns a `GrowthLayer` selected from `growthMode` at creation:

- **Circular** — integer min-heap keyed by squared distance from the border-contact anchor; approximates a disc.
- **Smooth** — squared-distance bands served nearest-first, preferring candidates with more attacker-owned neighbours inside the active band. This prevents a straight frontier's tangent direction from growing far ahead of the radial front.

The least-resistance sampler is deliberately outside the growth layers: layers nominate candidates, while the simulation compares defense costs. It samples only the top candidates, so the layer's overall shape remains dominant.

- **Organic** — uniformly random candidate selection via a per-attack deterministic PRNG.

The simulation validates every candidate identically. The layer never claims ownership or bypasses connectivity. See [SPEC.md](SPEC.md) section 4.12 for selection semantics.

### Territory integrity

`TerritoryIntegrity` labels every owned land component in scan order. The simulation passes only State structures as anchors; a component is **protected** if it contains a live State structure owned by the same player. Every other component — including components containing only Artillery, Barracks, Fortifications, Jammers, Command Posts, or War Academies — is unprotected. An unprotected component is annexed only when it directly touches a foreign protected component; the target is the owner with the largest shared border, with lower player id as the tie-break. Components touching only water, unclaimed land, or another unprotected component are left untouched, so valid islands and chains are not deleted. Annexations go through `claim(..., 0)`, which updates territory counts, borders, renderer changes, and clears attack provenance.

`cleanupUnclaimedPockets` is a second labeling pass over neutral land. It fills components of at most `UNCLAIMED_POCKET_MAX_AREA` (96) that directly border an owner, assigning the pocket to the owner with the largest shared border (lowest id tie-break). Ocean contact is intentionally allowed so thin coastal slivers left by organic fronts are removed; ownerless islands and larger neutral regions are skipped. It runs every 100 ticks and also applies claims through `claim(..., 0)`.

Capturing a structure's cell calls `structures.destroyAt(index)` inside `claim`. The structure disappears from the map, minimap, snapshot, and checksums, its aura is removed, and the owner loses protection for all remaining components. A dead state's territory is therefore not a valid annexation target, though it can still be attacked.

### Structure effects and State auras

`Structures/` keeps each structure definition in its own file: `state.ts`, `artillery.ts`, `barracks.ts`, `fortification.ts`, `jammer.ts`, `command-post.ts`, and `war-academy.ts`. Shared effect/card types live in `types.ts`, the aggregate tables and helpers in `definitions.ts`, the registry in `registry.ts`, and the public API in `index.ts`. Effect descriptors per structure type:

- State: `defense-aura` radius 16, +20, max stacking, friendly-owned land only, no district.
- Fortification: `defense-aura`, +1, additive stacking, friendly-owned land only, covers the full 40 px district.
- Barracks: `barracks-power`, +1 effective attack level per stack; cost/strength linear, power/pierce log2.
- Jammer: `barracks-suppression`, −1 effective enemy Barracks level per stack, global and no pixel defense.
- Artillery: `artillery`, cost 1000, 64 px district, 16 px district-free build clearance, 140 px range, 6-second cooldown, one shell per level at 300 supply/level with ±36 px spread; shells remove one level from the nearest non-State hostile structure in a 12 px blast.
- Command Post: `supply-income`, +1 supply per second.
- War Academy: `supply-cap`, +40.

`simulation.rebuildAuraDefense` clears the overlay, applies max-stacking auras, then adds additive auras, skipping every cell not owned by the aura's structure owner **or outside that structure's district** (State auras use their radius, with no district). `defenseAt` reads it, so effects share the attack-point economy. When ownership changes without destroying a structure, `updateAuraAt` recomputes just that cell from the new owner's structures, immediately removing the old owner's aura. A full rebuild still runs at world creation, structure creation, and structure destruction. `getAttackStats` combines live Barracks stacks with the defender's Jammer suppression using the stack cache.

### Districts

`simulation.rebuildDistricts` clears the district arrays, then for each buildable structure scans its `districtRange` bounding box expanded by `DISTRICT_NOISE_MARGIN`. Every owned cell is assigned the nearest eligible structure of that owner; the comparison distance is `actual distance + integerNoiseOffset`, with ties breaking on structure type code then id. The offset comes from coherent 8 px value noise plus per-pixel jitter (`districtNoise`), so outer edges grow/shrink by roughly two pixels and split lines wiggle. The result is a constrained, non-overlapping Voronoi partition. `districtStructureIds` records the winning structure so same-type districts remain distinct; `districtColorCodes` gives each a render palette variant. `updateDistrictAt` handles an ordinary ownership change by reassigning just that cell.

`getMergedDistricts` performs a throttled union scan over `districtStructureIds`: touching cells of the same owner and type union their districts, yielding visual/upgrade groups with combined stacks, a mean icon centre, and the pinned lowest structure. Membership recomputes at most every 5 ticks and refreshes totals per read; it is not authoritative gameplay state or checksum input. The territory shader compares type base codes while `mergeDistrictSeams` is on, removing internal seams; the 2D overlay suppresses individual icons for multi-structure groups and draws one combined-level icon. Ctrl sets the shader flag off and bypasses group targeting.

Placing a new type requires an unassigned owned cell outside all districts. If the target is inside a same-type district, that district's structure's `stacks` is incremented. If the same type lands outside all districts, a new structure and district are created. Different types inside any district are rejected. Structure creation/destruction calls `refreshDistrictsAround`, which recomputes only the affected neighbourhood and records dirty renderer tiles; stacking leaves the district map unchanged.

The scan is preallocated and runs at most once per second (or immediately after a clash halts a front, with a cooldown). Labeling is single-threaded and deterministic.

`createAttack` computes the growth anchor as the rounded centroid of the seed cells on the attacker's border. The clicked target is retained only for public state. This keeps all distance-based growth emanating from the border instead of growing a tendril toward a deep click.

`TerritorySimulation.setGrowthMode(mode)` sets a pending mode applied at the next tick, before commands and bots create attacks. Existing attacks retain their original layer. Growth mode, per-attack layer, and frontier state are included in checksums.

### 3.6 Commands

Command union:

```ts
type GameCommand =
	| { type: 'attack'; playerId; x; y; sequence }
	| { type: 'build'; playerId; cardId; x; y; sequence };
```

`enqueueAttack`, `playCard`, and `upgradeDistrict` validate immediately and queue. Authoritative creation/spending still happens inside the next `step()`, where state may have changed. Attack validation reserves supply for already-queued fronts. Applying an attack spends launch supply and creates strength; builds validate supply, permanent-hand membership, the destination cell, the 8 px exclusion radius, district ownership, stack eligibility, and Artillery's 16 px district-free clearance again. A build that lands in a matching district pays `base cost + 15 × current level`; a new structure pays base cost. Upgrades resolve the district's structure, spend `base card cost + 15 × projected current level`, and increment stacks without consuming a card; pending upgrade costs are reserved against their projected levels during click validation. Cards are not removed. This separation is the model for future network intents. Resource accrual runs before the command queue each tick.

### 3.7 Snapshots

`GameSnapshot` contains only serializable UI data:

- tick, seed, land counts, claimed land;
- public player records;
- active attacks and live structures with effect descriptors;
- human supply, cap, income, and permanent hand;
- active fronts with strength/initial strength, power, pierce, idle ticks, and effective levels;
- winner/ended/human id and growth mode.

The UI never receives frontier sets, queue internals, or the PRNG.

### 3.8 Checksum

`checksum()` is an FNV-1a hash over:

- tick, RNG state, next attack id, ended/winner;
- every owner cell;
- each player's alive flag and territory;
- current/pending growth mode, annex scheduling, human and bot supply/accrual, districts, and structures;
- human and bot supply plus accrual remainders;
- every active front's durable strength, power, pierce, effective levels, and idle ticks;
- live structures and per-cell claim provenance;
- active attack ids, attacker/defender, target/anchor, growth mode, creation tick, capture count;
- each attack's growth-layer frontier state (heap, buckets, organic RNG/entries).

It intentionally excludes renderer state, camera, UI, and border sets (derived). It is used in tests and intended for server/client verification. Cost is about 18 ms on the development machine, so it is never run per tick in production.

---

## 4. Map generation

`generateMap(seed)`:

1. Computes a quantised elevation (0–65535) for every cell using five octaves of hashed value noise plus a broad continental signal and edge falloff.
2. Builds a 1024-bin elevation histogram and picks the threshold that yields the target 38% land.
3. Quantises land height into six tiers at fixed land-quantiles (45/65/80/92/98%), keeping most land lowland and peaks rare.
4. Writes the land mask, terrain shade, elevation tiers, and starts.
5. Chooses 51 start points with optimized farthest-point sampling from candidate land cells, enforcing a 34-cell preferred spacing.
6. Returns `{ width, height, land, shade, elevation, landCount, starts }`.

Start paint uses a ragged disc of radius ~16: a per-cell integer hash perturbs the radius, then cells outside land or already owned are ignored. A fallback ensures every state receives at least one land pixel. The initial frontiers are rebuilt afterward by one full scan.

Map generation with 51 starts is the slowest CPU operation (~220–230 ms) and happens once per world during the loading screen. It is not part of the tick budget.

### Attack frontier representation

Frontier storage is layer-specific:

- circular: a JavaScript number array treated as an integer min-heap; packed key = `distanceSq * pixelCount + index`;
- smooth: a map of squared-distance bands to candidate lists, with a minimum active band;
- organic: an array of candidate indices plus a per-attack `DeterministicRng`.

The simulation still performs ownership and border checks at pop time. Duplicates are tolerated. The old single FIFO queue was replaced by modules so growth selection can be swapped without touching capture, connectivity, cost, or UI logic.

The benchmark now runs all three layers. Together with the benchmark's additional simulations, Node RSS is ~303 MiB; this is not the browser working set. The integrity planner preallocates two 2M-entry typed arrays (~16 MiB), the aura overlay adds 4 MiB, and district arrays add 14 MiB per simulation.

---

## 5. Renderer

### 5.1 Resource ownership

`TerritoryRenderer.create(canvas, simulation)`:

1. Requests adapter and device.
2. Configures the canvas context with the preferred swapchain format.
3. Compiles the WGSL shader and checks compilation messages.
4. Creates the pipeline (`layout: 'auto'`), map texture, palette texture, sampler, uniform buffer, and bind group.
5. Builds the CPU RGBA shadow and uploads the full control texture once.

The renderer keeps references to the simulation so it can rebuild the shadow after a buffer overflow or device reset.

### 5.2 CPU control texture

`controlPixels: Uint8Array(width * height * 4)` is the bridge between ownership and the GPU:

| Channel | Meaning                           |
| ------- | --------------------------------- |
| R       | Owner id (`0` neutral)            |
| G       | Land mask (`0` ocean, `255` land) |
| B       | Terrain shade / relief            |
| A       | Normalized elevation tier 0–255   |
| A       | Unused (`255`)                    |

The palette is a 256 × 1 `rgba8unorm` texture. Index 0 is unclaimed land; indices 1–51 are player colors. The first eight colors are hand-picked and the rest are generated on a golden-angle hue wheel.

### 5.3 Dirty uploads

After a tick:

1. For each changed pixel, update the control shadow and mark its 32 × 32 tile dirty using a generation-stamped `Uint32Array`. District-only changes arrive as tile ids and rewrite the alpha channel for those tiles.
2. Clear a small per-tile-row dirty flag array and count unique dirty tiles.
3. If the dirty tile count is ≤ 96, merge contiguous dirty tiles per row and upload strips immediately.
4. If > 96 tiles are dirty, queue an adaptive full-texture resync instead.
5. During `render()`, advance at most two 1 MiB horizontal chunks of that resync per frame.
6. If more ticks arrive during a resync, schedule another pass; the CPU shadow always holds the latest state.
7. Add uploaded pixels and `writeTexture` calls to the perf readout.

Why not only one dirty rectangle: hundreds of attack fronts change scattered pixels across the whole map, so a single bounding box degenerates to a full texture upload every tick. Why not only fine tiles: at ~200 fronts, tile uploads generated ~2,169 texture writes/second and produced ~28 ms panning frames. The adaptive strategy keeps normal updates cheap and spreads dense resyncs across frames. Combined with 5 Hz HUD snapshots and a virtualized leaderboard, panning under ~209 fronts measured 144 fps with zero frames over 10 ms.

The initial full texture upload happens once before the first frame.

### 5.4 Frame loop

`GameCanvas.svelte` drives `requestAnimationFrame`:

- fixed simulation steps from an accumulator (max 4 per frame, 250 ms catch-up cap);
- consume change batches immediately;
- send HUD snapshots to Svelte at 5 Hz (or immediately on elimination/victory);
- render every frame with animated ocean and camera updates;
- report camera view to the bridge every ~140 ms;
- report renderer stats once per second.

Continuous rendering is intentional for ocean shimmer and smooth camera input. The CPU/GPU cost is a single full-screen shader pass plus tiny texture updates.

### 5.5 Camera and coordinate spaces

- Map space: integer cell units, `0..2047` × `0..1023`.
- CSS screen space: canvas client pixels.
- Physical GPU space: CSS multiplied by DPR (capped at 2).
- `MapCamera` owns center, zoom, fit scale, clamping, screen-to-map and map-to-screen.
- Pointer events are converted to map cells using CSS space.
- The renderer writes physical resolution and physical scale into uniforms.

### 5.6 Minimap

- A 260 × 130 `<canvas>`.
- Repaints are driven by a Svelte effect on snapshot tick and camera view.
- Owner/land sampling is throttled by tick (at most every 3 ticks) and by elapsed time (~650 ms).
- Camera rectangle is overlaid; clicks jump the camera.
- This is intentionally independent of the WebGPU path to keep a robust fallback visual.

---

## 6. UI orchestration

`src/routes/+page.svelte` owns:

- Creating a world from URL seed or random seed.
- The loading → intro → live → defeat/result flow.
- Snapshot state and derived HUD/leaderboard/result data.
- Structure auras and type-specific markers are drawn by a transparent 2D canvas above the WebGPU territory canvas, using the same `MapCamera`.
- The free-floating card hand reads supply/cap/income/hand from snapshots; keyed cards use Svelte fly/flip transitions for entrance and reflow. Hover/drag transforms are CSS, and the hand auto-sinks to a peeking strip. HTML drag-and-drop maps the drop point through `MapCamera` and queues a build command. Number keys 1-6 enter the same placement state without a native drag: the overlay shows the card arrow/landing circle, a map left-click queues `playCard`, and right-click/Escape clears the placement; the main shell suppresses the context menu. Clicking an owned district queues one upgrade command; Shift-click uses `getUpgradeQuote` to atomically queue five. Merged groups pick the lowest projected structure per level and pin `structureId`; Ctrl-click targets the clicked structure. A cursor tooltip above the pointer shows the quoted total for the current modifier and flags merged groups. A fixed horizontal supply bar above the hand fills by `supply/supplyCap` from snapshots and previews the hovered click cost (frontier launch, upgrade quote, or artillery volley) as an overlay segment plus a `-cost` chip; its action area hosts FIRE and CANCEL FRONT. The old supply/front/defense panel was removed. Drag rendering uses a transparent drag image plus an SVG curve and landing-radius circle; grid/target status panels were removed.
- Growth-layer test switch; new fronts use the pending simulation mode while in-flight fronts keep their captured mode.
- Seed input, rematch, new world, URL synchronization.
- Global keyboard shortcuts.
- Toasts and event feed.
- Modal states: result and defeat are match overlays; help sits above both; intro is the first-run state. Only one match-state overlay should be actionable at a time.

`GameCanvas` communicates upward only through callbacks:

- `onTick(snapshot, events)`
- `onHover(info | null)`
- `onAttack(x, y)`
- `onReady()`
- `onError(error)`
- `onPerf(stats)`

`GameCameraBridge` lets HUD buttons call camera actions without Svelte component instance APIs. It also reports camera views to the UI.

### Reactivity boundary

- Svelte state receives immutable snapshots at a throttled 5 Hz; the actual map updates at 10 Hz.
- The leaderboard is virtualized to the visible row window (~19 rows), so 51 logical states do not become 51 live DOM rows.
- The simulation object is not deeply reactive.
- The renderer mutates its own control texture/GPU resources outside Svelte reactivity.
- This avoids proxy overhead on multi-megabyte typed arrays.

---

## 7. Memory sketch

| Item                                     | Approx. size                         |
| ---------------------------------------- | ------------------------------------ |
| Owners (`Uint16Array`)                   | 4 MiB                                |
| Land (`Uint8Array`)                      | 2 MiB                                |
| Shade (`Uint8Array`)                     | 2 MiB                                |
| Renderer control shadow                  | 8 MiB                                |
| GPU map texture                          | 8 MiB                                |
| Palette texture                          | 1 KiB                                |
| Elevation scratch during map gen         | 4 MiB + histogram (transient)        |
| Start candidate land indices             | not retained; temp during generation |
| Frontier sets (51 states)                | map-dependent                        |
| Growth frontier candidates               | layer-dependent, bounded by lifetime |
| Svelte DOM/HUD (virtualized leaderboard) | small                                |

The measured Node RSS for all benchmark worlds (five stress simulations plus tooling) is ~303 MiB. That includes the Node runtime and five worlds and is not the browser working set. Earlier per-attack `Set` bookkeeping produced ~529 MiB for a two-world benchmark; packed/array frontiers and ownership-based duplicate handling removed most of that overhead.

---

## 8. Conventions

1. **File names:** kebab-case for modules, PascalCase for Svelte components.
2. **Imports:** `#lib/...` alias configured through package subpath imports plus TypeScript paths. Relative imports are used inside the sim.
3. **Types:** explicit public interfaces for snapshots, commands, protocol messages. Avoid `any`.
4. **Comments:** explain invariants and non-obvious performance choices, not line-by-line mechanics.
5. **No hidden mutation:** renderer cannot write simulation arrays; UI cannot claim pixels.
6. **Tick semantics:** side effects that affect gameplay belong inside `step()`, not in UI callbacks.
7. **Performance-sensitive code:** avoid object allocation per pixel. The change batch exists specifically to avoid per-cell objects.
8. **Docs:** update [SPEC.md](SPEC.md) and the relevant topic doc when behavior changes.

---

## 9. How to extend safely

### Add a new attack rule

1. Change `simulation.ts` only.
2. Decide deterministic ordering.
3. Add a focused test in `simulation.test.ts`.
4. Update rules in [SPEC.md](SPEC.md) section 4 and [DETERMINISM.md](DETERMINISM.md) if ordering changes.
5. Run `pnpm test` and both determinism tests.

### Add a visual feature

1. Prefer shader work over CPU loops per frame.
2. If it changes ownership display, ensure the CPU control texture remains the single source.
3. Check upload pixel counts in the HUD perf readout.
4. Add measurements to [PERFORMANCE.md](PERFORMANCE.md) if the feature touches the per-tick upload path.
5. Verify unsupported-WebGPU behavior is unaffected.

### Add an online transport

1. Implement a server process that imports the simulation core (no DOM dependencies).
2. Follow [NETWORKING.md](NETWORKING.md) and `protocol.ts`.
3. Keep command ordering explicit and versioned.
4. Add server/client checksum comparison before trusting any state.
5. Never let a client set owner ids, territory counts, or (when restored) resource values.

### Add map types or dimensions

The current constructor rejects non-standard dimensions. Supporting more maps requires:

- versioned map descriptors;
- start generation generalized off the constants;
- texture size limits and memory budgets checked at load;
- renderer camera/fit tests at multiple aspect ratios;
- URL/serialization updates.

---

## 10. Known limitations

- Simulation runs on the main thread.
- No WebGL fallback.
- No online transport yet.
- No fog of war, alliances, or spectators.
- Mobile pinch zoom missing.
- One map style and fixed dimensions.
- The minimap samples independently and can lag the main renderer slightly.
- Bot behavior is profile-driven but still simple: one focus structure, local placement, and no coordinated team attacks or defensive alliances.
- The 51-state free-attack mode is an experiment. Economy and final attack semantics remain provisional.
- The virtualized leaderboard mounts only the visible window plus overscan; rank numbers remain absolute.
- Upload volume in a fully active 51-state map is intentionally higher in exchange for smooth input under saturation.
