# Architecture

This document describes the code as it currently exists; the app version comes from `package.json`. For current rules, the attack experiment, and future online design, read [SPEC.md](SPEC.md), [EXPERIMENTS.md](EXPERIMENTS.md), and [NETWORKING.md](NETWORKING.md).

---

## 1. Runtime topology

Territory is a client-rendered SvelteKit application. Local matches run the authoritative simulation in a Web Worker; the main thread keeps a read-only mirror. The optional `/online` route adds an in-memory HTTP/SSE room service on the Node adapter.

```text
Svelte route (+page.svelte)
  -> game-page controllers (state, match, interaction, overlay)
  -> GameSession
  -> Web Worker
       local-simulation.worker.ts
       local-host.ts -> TerritorySimulation (authoritative, 10 Hz)
       posts visual deltas + snapshots
  <- WorkerLocalSimulation (read-only mirror)
  -> GameCanvas / canvas helpers -> TerritoryRenderer (WebGPU, 10 Hz)
  -> Minimap (throttled 2D overview)

HUD path: throttled snapshots (5 Hz) -> page selectors/components

The evolution route uses its own worker/mirror split. Online rooms are separate:

/online controller -> HTTP intents + SSE ticks -> $lib/server/online.ts
                                              -> OnlineRoom (authoritative)
```

The simulation/renderer boundary is deliberately narrow: the renderer consumes `SimulationView` plus packed change batches, and never mutates simulation state. The worker host owns command validation and stepping; the page must not call `TerritorySimulation.step()`.

---

## 2. Module map

| Module                              | Layer      | Responsibility                                                                                            |
| ----------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------- |
| `src/routes/+page.svelte`           | UI         | Main game markup; delegates state/actions to page controllers.                                            |
| `src/lib/game/page/`                | UI         | Page state, selectors, match lifecycle, interaction, and overlay controllers.                             |
| `src/lib/components/`               | UI         | Extracted HUD, overlays, card tray, world rail, menus; scoped CSS.                                        |
| `src/lib/game/canvas/`              | Driver     | Frame loop, pointer/camera input, structure overlay helpers used by `GameCanvas.svelte`.                  |
| `src/lib/game/render/`              | Render     | Camera, WebGPU renderer, WGSL shader, dirty-upload scheduling.                                            |
| `src/lib/game/worker/`              | Transport  | Worker protocol, authoritative host, local worker entry, main-thread mirror.                              |
| `src/lib/game/session/`             | UI/service | Worker match lifecycle, roster loading, seed and onboarding persistence.                                  |
| `src/lib/game/simulation.ts`        | Core       | `TerritorySimulation` facade: world state, tick orchestration, commands, snapshots.                       |
| `src/lib/game/simulation/`          | Core       | Extracted simulation types, artillery shell math, bot profiles, checksums, geometry, snapshot converters. |
| `src/lib/game/ai/`                  | Core       | Genomes, Markov controllers, fitness/buckets, evolution worker, gauntlet logic.                           |
| `src/lib/game/growth/`              | Core       | Pluggable frontier-selection layers (organic used by player matches).                                     |
| `src/lib/game/structures/`          | Core       | One definition per structure type, shared registry, effects.                                              |
| `src/lib/game/integrity.ts`         | Core       | Mainland protection, annexation plans, neutral-pocket cleanup.                                            |
| `src/lib/game/naval.ts`             | Core       | Sea components and deterministic naval A* routing.                                                        |
| `src/lib/game/net/`                 | Contract   | Wire protocol, online room/intent/baseline types, authoritative `OnlineRoom`.                             |
| `src/lib/server/online.ts`          | Server     | In-memory room manager, 10 Hz ticker, SSE subscribers.                                                    |
| `src/routes/online/+page.svelte`    | UI         | Online lobby/live match markup; delegates to `game/online/page/`.                                         |
| `src/routes/evolution/+page.svelte` | UI         | AI Lab markup; delegates to `game/evolution/page/` and its worker.                                        |
| `src/lib/game/simulation-view.ts`   | Contract   | Read-only renderer contract shared by simulation and mirrors.                                             |
| `scripts/`                          | Tooling    | Benchmarks, telemetry, balance/soak, docs generation, import-boundary check.                              |

---

## 3. Simulation

### 3.1 State ownership

`TerritorySimulation` is the single source of truth for:

- `owners: Uint16Array` — length `width * height`; owner id per cell, `0` for unclaimed.
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
- Supply: `gold` holds human supply (legacy field name), `goldAccrual` the human remainder, `botGold`/`botGoldAccrual` the bot equivalents. Income is `3 + floor(territory/3000) + supply-income effects` per second (+1/s per 3,000 owned pixels) with no income cap; cap is `120 + territory/1000 + 80 × Academy stacks` with no upper bound. `supplyCap` is public.
- No attack-order inventory exists. Front launch cost/strength derive from effective live Barracks levels; power/pierce derive from integer log2 tiers. A defending Jammer subtracts one effective level per stack.
- `structureStacksByType` caches owner/type stack totals and refreshes only when `StructureRegistry.version` changes, so per-tick income and per-launch attack stats do not scan every structure.
- Permanent hand: all seven buildable types with fixed ids, available for repeat purchases; no draw, consumption, or reroll.
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
 31                    26 25                    0
┌───────────────────────┬───────────────────────┐
│ owner (6 bits used)   │ pixel index (26 bits) │
└───────────────────────┴───────────────────────┘
```

The 26-bit index supports arbitrary rectangular atlases up to **67,108,864 cells** and **8192 px per side**, with six owner bits reserved for the existing 64-seat headroom. Decode:

```ts
const owner = packed >>> 26;
const index = packed & 0x3ffffff;
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

If a bug is suspected, a brute-force border scan in `simulation.combat.test.ts` compares every player's set against the full map.

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
 ├─ every 30 ticks or after a cancellation: resolve detached components atomically
 ├─ every 100 ticks: fill small neutral pockets into their dominant neighbour
 ├─ updateEliminations()
 ├─ checkVictory()
 └─ buildSnapshot()
```

No rendering, DOM, timers, or promises are present in this path.

### Bot strategy layer

Each bot receives a deterministic `BotProfile` derived from `hash32` of the player id and world seed: aggression, economy, fortification, command, vengeance, caution, conciliation, opportunism, and a per-type `structureBias` (with a display-only sorted `buildPlan`). No new RNG stream is introduced.

- At every `BOT_DECISION_INTERVAL` (10 ticks), `updateBotThreat` refreshes active-attacker pressure and a per-bot integer threat score: active fronts (25 each, cap 50), hostile border contact (1 each, cap 8), and recent grievance deltas (2 each, cap 20). Posture enters at 20 and leaves at 10, with a 40-supply defensive reserve and a 3-interval stall release.
- **Shared opening ramp:** `botEarlyEconomyType` alternates Command Posts and War Academies until the bot has `BOT_EARLY_ECONOMY_PER_TYPE` of each, or until `BOT_EARLY_ECONOMY_TICK_LIMIT`. The next economy structure receives a dominant utility score and a capped strategic reserve. `inBotEarlyEconomyRamp` also restricts attack targeting to neutral ground while possible, falling back to hostile borders only when neutral expansion is blocked.
- Each bot evaluates construction once per `BOT_BUILD_INTERVAL` (30 ticks), staggered by player id. `chooseBotEconomicAction` scores every build and upgrade candidate from affinity, novelty / repeated-copy penalty, threat response (diluted by existing defense stacks), income and cap pressure, and a small cost-efficiency term. It picks the highest-scoring placeable action. Threat is a utility input, not a forced Fortification→Barracks order.
- Strategic savings: after two buildables, `botAspiration` selects the highest-affinity missing type with a cap-overrun penalty. `botStrategicReserve` holds its cost (or War Academy cap-growth cost when the stock cap is the bottleneck) until affordable. Attacks are not fully blocked by that save: they keep `max(60, floor(supply × 0.5))` and cap the economic buffer at 40, using the max of the two instead of summing them. The full reserve still applies to economy spending. Up to two non-defensive actions execute per interval; a threatened bot executes at most one defensive action, and defensive candidates may use the defensive reserve.
- Expansion: when any missing type has no legal build cell, `botNeedsExpansion` makes expansion the priority; attack spending then ignores the economic/aspiration reserves.
- Each new/destroyed buildable refreshes districts only within its own range; aura rebuilds batch once after all bots act.
- `runBotDecisions` computes player strength (`territory/4 + structure levels*300 + supply*2`), samples border neighbours, and uses `scoreBotTarget`. Candidate contact cells subtract `BOT_ATTACK_DEFENSE_WEIGHT × pixel defense`, so the selected ground is the least-defended part of the best target. Attack chance is then derived from the unpenalized target score, aggression, supply pressure, and held reserves, replacing the old flat aggression roll. Threat biases retaliation: a grudge holder gains a large bonus, an active attacker a counter bonus, and unrelated neighbours a penalty.
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

Player matches are locked to organic growth; circular and smooth exist only for
internal tests/benchmarks. Internally, each `AttackState` still owns a
`GrowthLayer` created from its growth mode:

- **Circular** — integer min-heap keyed by squared distance from the border-contact anchor; approximates a disc.
- **Smooth** — squared-distance bands served nearest-first, preferring candidates with more attacker-owned neighbours inside the active band. This prevents a straight frontier's tangent direction from growing far ahead of the radial front.

The least-resistance sampler is deliberately outside the growth layers: layers nominate candidates, while the simulation compares defense costs. It samples only the top candidates, so the layer's overall shape remains dominant.

- **Organic** — uniformly random candidate selection via a per-attack deterministic PRNG.

The simulation validates every candidate identically. The layer never claims ownership or bypasses connectivity. See [SPEC.md](SPEC.md) section 4.12 for selection semantics.

### Territory integrity

`TerritoryIntegrity` labels every owned land component in scan order. Anchors are State structures plus same-owner Ports protected transitively through shared sea components. A component is **protected** if it contains an anchor. Every other component is unprotected. The scan builds a weighted component-adjacency graph and propagates protection outward: an unprotected component reachable through any chain of adjacent owned components is annexed to the protected root owner, choosing the largest shared border then the lower player id. Components with no path to protection are **abandoned to neutral land** rather than left as indefinite enclaves. The complete transfer/abandon plan is applied atomically through `claim(...)`; there is no cross-tick transfer queue. `claim(..., 0)` updates territory counts, borders, districts/auras, renderer changes, destroys structures on abandoned cells, and clears attack provenance.

`cleanupUnclaimedPockets` is a second labeling pass over neutral land. It fills components of at most `UNCLAIMED_POCKET_MAX_AREA` (96) that directly border an owner, assigning the pocket to the owner with the largest shared border (lowest id tie-break). Ocean contact is intentionally allowed so thin coastal slivers left by organic fronts are removed; ownerless islands and larger neutral regions are skipped. It runs every 100 ticks and immediately after a non-empty integrity scan; fills also go through `claim(...)`.

Capturing a structure's cell calls `structures.destroyAt(index)` inside `claim`. The structure disappears from the map, minimap, snapshot, and checksums, its aura is removed, and the owner loses protection for all remaining components. A dead state's territory is therefore not a valid annexation target, though it can still be attacked.

### Structure effects and State auras

`structures/` keeps each structure definition in its own file: `state.ts`, `artillery.ts`, `barracks.ts`, `fortification.ts`, `jammer.ts`, `command-post.ts`, and `war-academy.ts`. Shared effect/card types live in `types.ts`, the aggregate tables and helpers in `definitions.ts`, the registry in `registry.ts`, and the public API in `index.ts`. Effect descriptors per structure type:

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
- `MapCamera` owns center, zoom, fit scale, screen-to-map and map-to-screen. There is no edge pan clamp: edge states can be dragged toward the viewport center to escape HUD occlusion, showing ocean/void beyond the map.
- `generateMap(seed, options)` supports runtime state count and arbitrary map dimensions up to 8192 px per side / 2^26 cells; the default is 4096×2048 with 51 states. `TerritorySimulation` stores `playerCount`; per-player arrays and grievance/attacker matrices are sized from it.
- `ai/options.ts` defines the committed strategic-option layer above tactical utility scoring.
- `ai/markov.ts` defines the genome-v2 semi-Markov strategic controller: state graph, option labels, per-state biases/dwell, observation-conditioned transitions, validity repair, structural mutation, and labeled crossover.
- `ai/evolution.worker.ts` owns the Evolution Lab sandbox and simulation loop off the UI thread. It posts compact visual deltas plus a read-only snapshot; `worker/view.ts` mirrors the current match on the main thread for the renderer, camera, hover readout, and selection. `worker/protocol.ts` owns the shared init/visual payloads, while `ai/evolution-worker-protocol.ts` owns the evolution command/message boundary.
- `ledger/` is the standardized match-ledger boundary. `types.ts` mirrors the Spacetime `ledger_transactions` row and defines `LedgerSource`; `remote.ts` adapts Spacetime submissions/subscriptions; `local.ts` exposes the offline writer; `codec.ts` owns compact intent payloads. Both local and remote paths converge on accepted `OnlineIntent`s, not transport-specific envelopes.
- `view/` owns the match view layer: `match-view.ts` runs the main-thread match lifecycle (worker creation, commands, replay, seat/viewer configuration), and `worker-host.ts` owns accepted-intent application, fixed-tick stepping, snapshot saving, and pause/resume. `worker/` keeps transport and mirrors: `protocol.ts` (shared init/visual payloads), `view.ts` (read-only render/query mirror), `local-client.ts` (transport), `local-simulation.ts` (main-thread mirror/command facade), and `local-simulation.worker.ts` (10 Hz loop, hosted by `MatchViewHost`). `simulation-view.ts` is the readonly contract consumed by `GameCanvas`/`Minimap`; both `TerritorySimulation` and the worker mirror satisfy it.
- `ai/genome.ts` defines evolvable bot genomes; `FitnessWeights` in `ai/evolution.ts` is the single source for reward scaling used by the Evolution Lab and headless runs.
- `ai/genome.ts` defines evolvable bot genomes: traits, per-type affinities, and six behaviour-module weights, with deterministic creation/mutation/crossover.
- `ai/evolution.ts` runs deterministic all-bot selection rounds, 64-seat gauntlet survival with global lives and top-16 recovery, fitness scoring, 1v1 mirrored lineage duels, QD descriptor archives, pruning/reproduction, poor/good/top buckets, and generation/run-boundary session capture/restore for the worker's IndexedDB checkpoint. `ai/evolution-csv.ts` round-trips genomes through the spreadsheet format; `ai/buckets.ts` persists selected buckets for match difficulty.
- `naval.ts` labels static 4-connected sea components once and provides deterministic 4-neighbour A* for boat routes. `TerritorySimulation` queues naval commands, spends launch supply, advances boats by arrival tick, claims the beachhead, auto-builds a Port, and opens a normal inward front. Port protection adds `IntegrityAnchor`s for Ports whose friendly land reaches the State, plus same-owner Ports reachable through any chain of shared sea components.
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

The main route is intentionally thin: `+page.svelte` imports components, creates the page controller facade, and renders markup. `createGamePage()` composes four feature controllers over a shared reactive state:

- `game-page-state.svelte.ts` owns `$state` fields and selector getters.
- `match-controller.svelte.ts` owns match settings, seeds, world rebuild/deploy/pause, `GameSession`, tick dispatch, and worker visual ingestion.
- `interaction-controller.svelte.ts` owns hover, card drag/drop and placement, context-menu construction/actions, and pointer handlers.
- `overlay-controller.svelte.ts` owns onboarding transitions, diplomacy toast timing, and result/defeat transitions.

The facade returns a proxy exposing the historical `game.foo` API; `bind:game.seedInput` and similar bindings keep working through accessor descriptors. Selectors are split under `game-page-state/selectors/` and remain live rune derived values.

`GameCanvas.svelte` is a thin host for:

- `game/canvas/frame-loop.ts` — renderer/camera setup, rAF loop, local stepping, worker delta queue/ack, throttled snapshots;
- `game/canvas/input.ts` — pointer capture, tap-vs-drag, pinch/wheel zoom, panning, hover throttle;
- `game/canvas/structure-overlay.ts` — structure markers, artillery rings/shells, naval landings, alliance rings, rival supply banners.

It reports upward through `onTick`, `onHover`, `onAttack`, `onSelectOwner`, `onReady`, `onError`, `onPerf`, and `onRemoteVisualsApplied`. `GameCameraBridge` lets HUD buttons drive camera actions without component instance APIs.

The HUD reads throttled snapshots and derived selectors. The hand and supply panel render from snapshots; drag/drop maps screen coordinates through the camera and queues worker commands. The leaderboard is virtualized, the renderer mutates its own GPU/texture state outside Svelte reactivity, and no large typed array is wrapped in Svelte state.

### Reactivity boundary

- Svelte state receives immutable snapshots at a throttled 5 Hz; the actual map updates at 10 Hz.
- The leaderboard is virtualized to the visible row window (~19 rows).
- The simulation object is not deeply reactive; the main thread mirror is updated outside Svelte state.
- The renderer mutates its own control texture/GPU resources outside Svelte reactivity.

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
3. Add a focused test in `simulation.combat.test.ts`.
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

- Local matches run the authoritative simulation in a Web Worker; the main thread only mirrors visuals.
- No WebGL fallback; WebGPU is required.
- Online transport is an in-memory MVP (HTTP intents + SSE); no accounts, persistence, matchmaking, chat, or WebSocket transport.
- Online rooms are started by the host and reject late join; same-token reconnect is supported.
- No fog of war or spectator mode.
- One map style; dimensions are configurable within atlas limits.
- The minimap samples independently and can lag the main renderer slightly.
- Bot behavior is deterministic utility/profile driven, with one-pair alliances; multi-party diplomacy is deferred.
- The virtualized leaderboard mounts only the visible window plus overscan; rank numbers remain absolute.
- Upload volume in a fully active large map is intentionally higher in exchange for smooth input under saturation.
