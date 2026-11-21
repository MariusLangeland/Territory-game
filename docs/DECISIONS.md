# Architecture decision records

Short records of decisions that are expensive to reverse. Status values: **accepted**, **proposed**, **superseded**, **rejected**.

---

## ADR-001 — SvelteKit + Svelte 5 runes + TypeScript

**Status:** accepted  
**Date:** 2026-11-19

### Context

The project needs a fast UI iteration loop, a browser-first application, and a path to a Node backend without maintaining two language ecosystems.

### Decision

Use SvelteKit 3 with Svelte 5 runes and TypeScript. Use `adapter-node` so the same app can be deployed as a Node server later. Keep the game route client-only (`ssr = false`).

### Consequences

- Small JS bundles and fast dev HMR for the HUD experiments.
- Svelte 5 runes require current syntax; older Svelte tutorials may not apply.
- SvelteKit 3 changed some APIs from v2 (e.g. generated tsconfig location, navigation options); pin versions and update deliberately.
- Node adapter is not a multiplayer server by itself; the authoritative game server will be a separate process or route.

### Alternatives considered

- React/Vite: viable, larger baseline bundle, no SvelteKit conventions.
- Plain TypeScript + Vite: lightweight, but no framework for overlays and routes.
- Unity/WebGL: wrong rendering strategy for a 2D pixel map and a much heavier runtime.

---

## ADR-002 — WebGPU-only rendering for the prototype

**Status:** accepted for v0.1  
**Date:** 2026-11-19

### Context

The core visual is a huge pixel ownership texture that changes every tick. The renderer must upload changes efficiently, run a full-screen shader, and keep the CPU free.

### Decision

Use WebGPU as the only map renderer. Do not ship a WebGL2/Canvas2D fallback in v0.1. Detect unavailable WebGPU and show a clear error screen.

### Consequences

- Modern GPU API, explicit resource management, compute potential later.
- Native `writeTexture` partial uploads and predictable pipelines.
- Browser support narrower than WebGL2 (notably Firefox/Safari versions).
- Users without WebGPU cannot play; the UI must explain why.
- A fallback is future work if support data justifies the maintenance cost.

### Alternatives considered

- Canvas2D `putImageData` at 2048 × 1024: simple but slower per update and no shader effects.
- WebGL2 texture uploads: broader support, older API, more state management.
- CPU rasterization: not viable at this map size and frame rate.

---

## ADR-003 — Pixel ownership is the simulation grid

**Status:** accepted  
**Date:** 2026-11-19

### Context

The reference genre uses visible pixel-level territory. Abstract regions would simplify simulation but lose the product's defining visual.

### Decision

Use one 2048 × 1024 ownership grid as the authoritative territory representation. Land is a separate static mask. Player frontier sets are derived caches.

### Consequences

- Capturing territory is a per-cell ownership mutation.
- Rendering is a direct consequence of simulation state.
- Border maintenance needs a careful incremental algorithm and tests.
- Attack capture is throttled per tick to avoid map-wide scans.
- Future territory features must consider per-cell costs.

### Alternatives considered

- Polygon territory: smooth visuals, complex geometry growth and border detection.
- Coarse regions: cheap, but not the intended game.
- Hybrid (polygons rendered as pixels): adds a second source of truth and sync problems.

---

## ADR-004 — 10 Hz fixed tick with integer simulation

**Status:** accepted  
**Date:** 2026-11-19

### Context

Online play and replays require reproducible outcomes. Rendering frames are variable and hardware-dependent.

### Decision

Simulate at exactly 10 ticks per second, driven by a fixed-step accumulator. Use integer arithmetic for all gameplay values. Use a seeded integer PRNG. Do not read time in the simulation.

### Consequences

- Deterministic outcomes are testable and network-friendly.
- Input is quantized to 100 ms ticks; predicted local UI hides this for clicks.
- Frame rate cannot affect the game.
- Simulation changes require versioning and replay tests.
- 10 Hz is sufficient for visible territory growth in this genre.

### Alternatives considered

- Variable delta simulation: nondeterministic and hard to reproduce.
- 20/30 Hz ticks: more CPU/network/UI churn with little gameplay benefit.
- Turn-based ticks: wrong feel for real-time territory war.

---

## ADR-005 — Dirty-tile texture uploads, not a dirty rectangle

**Status:** accepted  
**Date:** 2026-11-19

### Context

A single dirty bounding box across bot attacks spanning different continents uploads nearly the full 8 MiB texture each tick (~21M pixels/s measured). With 51 attacking states the problem is worse and changes are scattered across hundreds of fronts.

### Decision

Divide the control texture into 32 × 32 tiles. Mark dirty tiles with a generation-stamped buffer, merge adjacent dirty tiles into horizontal strips, and upload each strip. When dirty tiles exceed a threshold, switch to a full-texture resync split across frames, because hundreds of tiny writes stall the input path.

### Consequences

- Under ~209 fronts, tile-only uploads produced ~2,169 `writeTexture` calls/s and panning frames up to ~28 ms.
- Above a 96-dirty-tile threshold, the renderer now queues an adaptive full-texture resync in eight horizontal chunks, max two chunks per frame. Upload traffic rises to ~21M pixels/s and ~80 calls/s, but panning reached 144 fps with zero frames >10 ms in the verification run.
- HUD snapshots are throttled to 5 Hz and the 51-row leaderboard is virtualized; otherwise DOM updates still produced ~14 ms tick-boundary frames.
- Tile bookkeeping memory is negligible (2,048 marks + 32 row flags).
- Tile size is a tuning knob; 32 favors precision for dispersed fronts. Larger tiles reduce API calls for compact normal-play changes.
- Renderer needs a chunked full-resync path for dense changes, overflow, and device recovery.

### Alternatives considered

- Single dirty rectangle: simple, pathological with distributed attacks.
- Per-pixel uploads: far too many API calls.
- Persistent mapping/readback: not supported by WebGPU.
- Compute shader ownership updates: possible future, but hurts determinism/portability and move complexity to GPU.

---

## ADR-006 — Single-player-first, network-ready core

**Status:** accepted  
**Date:** 2026-11-19

### Context

Online multiplayer is the product goal, but implementing transport, lobbies, and persistence before the simulation is fun would slow validation of the core loop.

### Decision

Ship a complete local slice first while keeping the simulation pure, deterministic, tick-based, and server-importable. Write the protocol and network design now, but do not pretend online is implemented.

### Consequences

- Faster iteration on map/combat feel.
- Determinism tests and change batches are designed for future network use.
- Some networking assumptions are documented rather than verified in code.
- The next milestone must prioritize authoritative server work before social/live features.

### Alternatives considered

- Build the server first: slower feedback on the core game.
- Client-authoritative multiplayer: unacceptable for fairness and determinism.
- Third-party realtime backend: limits control and doesn't solve simulation authority.

---

## ADR-007 — Procedural, versioned seed-based map instead of shipped map art

**Status:** accepted  
**Date:** 2026-11-19

### Context

The game needs very large maps and seed sharing/replays. Shipping prebuilt pixel assets is possible but adds asset pipeline and distribution concerns.

### Decision

Generate the map on the client/server from a 32-bit seed with deterministic hash noise, and version the generator with `MAP_VERSION`. Surface the seed in the UI and URL.

### Consequences

- Tiny initial payload; instant new worlds.
- Seed-based sharing is natural.
- Generation costs ~200 ms and uses float interpolation; generator changes require map-version bumps.
- Cross-engine map equality relies on normal conforming IEEE behavior; pre-baked maps remain an option if this becomes a concern.
- Server and client must ship the same generator version.

### Alternatives considered

- Pre-baked map images/assets: guaranteed bytes, larger payload, slower new-world creation.
- Server-generated and streamed maps: authoritative bytes, adds latency and bandwidth.
- Hand-authored maps: limited replayability and content pipeline.

---

## ADR-008 — Keep the simulation on the main thread for v0.1

**Status:** accepted for v0.1; revisit in Phase 2/3  
**Date:** 2026-11-19

### Context

A 10 Hz simulation measured at ~1.4 ms/tick under the 51-state stress load (and far less in the earlier 8-state build) is cheap on the main thread. A worker adds serialization and rendering synchronization complexity.

### Decision

Run simulation and rendering on the main thread in v0.1. Revisit when online prediction, more players, larger maps, or UI work makes tick cost visible.

### Consequences

- Simplest possible data sharing (typed arrays).
- Renderer consumes change arrays without transfer.
- A long frame could delay a tick, but the fixed-step driver catches up.
- Future move to a worker will require transferable change buffers and snapshot messaging.

### Alternatives considered

- Worker immediately: ahead of measured need.
- Server-only simulation for local play: unnecessary network dependency.

---

## ADR-009 — Temporarily remove the economy and stress 51 states

**Status:** superseded by ADR-013 through ADR-016  
**Date:** 2026-11-19

### Context

Attack correctness and performance were entangled with troops, income, caps, attack costs, and a low player count. The next feature focus is attacking itself: many fronts, free clicks, dense territory collision, and 100+ AI opponents.

### Decision

Temporarily remove all economy and resource gating, add 50 AI states (51 total), make attacks free, keep only technical active-front caps, and use 32 × 32 dirty uploads plus packed attack queues to survive the load. Track the deviation explicitly in [EXPERIMENTS.md](EXPERIMENTS.md).

### Consequences

- The attack flood-fill and renderer are exercised far beyond normal intended load.
- AI states saturate the map quickly; balance and match pacing are not meaningful in this build.
- The UI must handle 51 logical leaderboard states (virtualized to the visible window) and generated colors/names.
- Attack limits are a technical safety valve, not a design rule.
- The economy must be redesigned/restored after the final attack model is chosen.
- Do not build progression or balance on this build.

### Alternatives considered

- Keep the economy and test only limited attacks: slower to expose attack/queue/rendering limits.
- Simulate bots without rendering: misses GPU upload and HUD costs.
- Lower the player count: fails the explicit stress-test request.

### Exit plan

Documented in [EXPERIMENTS.md](EXPERIMENTS.md): decide the real attack semantics, restore/replace the economy, remove stress-only guards and UI, and update tests/specs/benchmarks.

---

## ADR-010 — Pluggable growth layers for attack frontiers

**Status:** accepted for EXP-001; growth-layer choice provisional  
**Date:** 2026-11-19

### Context

The FIFO 4-neighbour frontier produced very uniform Manhattan-diamond shapes. We need to compare a circular heuristic, a smoothing strategy, and an organic strategy without duplicating attack validation/budget/connectivity logic or locking in an unproven shape.

### Decision

Introduce a `GrowthLayer` interface that only selects the next candidate from a frontier. Each attack captures its layer at creation. Implement three modules:

- circular: Euclidean-distance priority heap;
- smooth: squared-distance radial bands, nearest-first, with attacker-neighbour scoring inside the active band;
- organic: deterministic random candidate selection with a per-attack seeded PRNG.

The simulation remains responsible for ownership, edge connectivity, capture limits, lifetime, and checksums. A HUD switch changes the mode used for new attacks; existing attacks keep their original mode. The mode is applied at the next tick.

### Consequences

- Attack shapes can be compared live under the same 51-state load.
- Validation, connectivity, and order termination are shared and cannot silently diverge by mode.
- Per-attack growth state and RNG are included in checksums.
- Smooth costs more CPU (~4.5 ms/tick vs ~3.1 ms for circular/organic after cleanup passes were added).
- Growth mode is currently a local test control; online play must make it server-authoritative.
- An earlier eight-sector round-robin smooth implementation produced long axis-aligned wings because initial seeds on a straight border all fell into two opposite sectors. Radial bands replaced it so tangent candidates cannot outrun the nearest radial band.
- Distance-based layers originally used the clicked cell as their anchor. Clicking deep inside a target produced a narrow tendril racing inland before the front bloomed. The anchor is now the rounded centroid of the border-contact seeds, so growth always starts at the border; the click only selects the target and search region.
- A final growth design still must be chosen before economy/balance work.

### Alternatives considered

- Hard-code one shape: faster to ship, but loses the requested comparison harness.
- Custom code path per mode in `processAttacks`: risks inconsistent connectivity/budget behavior.
- Randomize candidates without per-attack seeds: non-deterministic and untestable.

---

## ADR-011 — Cancel mutual fronts and annex detached territory

**Status:** clash-cancellation rules superseded by ADR-024 (order-stripping attrition). Annexation remains current.

**Status:** accepted for EXP-001; largest-component mainland superseded by ADR-012  
**Date:** 2026-11-19

### Context

Organic fronts can interpenetrate when two states attack each other, producing meandering borders and disconnected pixels. Those leftovers are visually noisy and undermine the idea of a stable front line. A pure lifetime timeout does not stop two mutually attacking fronts from chewing around each other, and it leaves detached territory owned by a state with no land route to its mainland.

### Decision

1. Track the id of the attack that most recently captured every cell in `claimedBy`.
2. Before an attack captures a cell, inspect its four neighbours. If a neighbour was captured by an active attack that targets the current attacker while the current attack targets that attack's owner, the pair is in direct conflict. Mark every order between the two states done and leave the candidate uncaptured.
3. Throttle a deterministic territory-integrity pass to once per second, plus once after a cancellation subject to a cooldown. The largest connected land component per owner is the mainland. Smaller components touching a foreign mainland are annexed to the owner with the largest shared border; lower player id wins ties. Components with no foreign-mainland contact are left alone.

### Consequences

- Mutual offensives freeze at contact, so the border can settle and both sides' orders disappear.
- Third-party attacks, common-target attacks, and attacks elsewhere continue.
- Dead pixels and severed pockets are reattached without deleting legitimate islands.
- `claimedBy` adds 8 MiB per simulation and doubles the owner portion of the checksum.
- Integrity preallocates ~16 MiB of scratch typed arrays and costs ~8.5 ms per scan. Frequency and cooldown are deliberate to avoid a 10 Hz hitch.
- At introduction, annexation never removed a player's largest component. ADR-012 replaces that rule with State-structure anchoring, so a state that loses its structure can lose any component.
- A server must reproduce the same claim provenance and cleanup ordering.

### Alternatives considered

- Cancel mutual attacks immediately on declaration: simple, but prevents any front from developing.
- Cancel only the two colliding attacks: leaves other orders between the pair running, so the border still moves.
- Global component scan every tick: cleaner but adds a ~8.5 ms scan to every tick.
- Annexe every detached component to its largest adjacent owner regardless of mainland: risks ownership churn between detached chains.
- Delete detached territory to neutral: removes legitimate islands and creates unclaimed holes.

---

## ADR-012 — State structures anchor protected territory

**Status:** accepted for EXP-001; first structure type  
**Date:** 2026-11-19

### Context

Annexation previously treated each player's largest connected component as their mainland. That is an implicit rule with no world object behind it. Structures are the next feature area, and the State structure is the natural permanent anchor for a state's core territory.

### Decision

- Add a `StructureRegistry` with structure identity, type, owner, map cell, and map coordinates.
- Create one `state` structure at each player's start cell when the world is built.
- A connected territory component is protected from annexation when it contains a live State structure owned by that player. Components without a structure are eligible for annexation to a foreign protected component.
- Capturing the structure's cell destroys it. The owner keeps remaining territory but loses annexation protection.
- Render live structures as large owner-colored circles with a cream capital star on a transparent 2D canvas above WebGPU territory, and as ringed dots on the minimap. Include the human anchored state in the commander readout and emit a war-feed event on destruction.
- Include structure identity/cell in snapshots, protocol state, and checksums.

### Consequences

- Annexation protection now has a visible, capturable world object instead of an implicit largest-component rule.
- Losing a State structure is strategically significant; the state can be carved up by protected neighbors.
- A structureless state's territory is not a valid annexation recipient, so some pockets may remain until a protected neighbor can take them.
- The renderer gains a lightweight 2D overlay; it does not alter the WebGPU territory path.
- A future construction/build system can reuse the registry, but placement, ownership transfer, and multiple structures need design.

### Alternatives considered

- Keep largest-component mainland and add structures cosmetically: fails the requested anchor behavior.
- Make structures invulnerable: prevents conquest of the anchor and creates unkillable territory.
- Destroy the entire state when the structure falls: stronger than requested; current rule leaves surviving territory but removes protection.
- Render structures in the WebGPU shader: more invasive for the first structure pass; a 2D overlay is cheaper and can evolve into icons/labels.

---

## ADR-013 — Elevation-based defense and attack points

**Status:** accepted for EXP-001  
**Date:** 2026-11-19

### Context

Attacks were a flat 30 pixels per tick regardless of terrain or whether the target was occupied. We want a minimal attack economy where terrain and ownership matter, while keeping the simulation integer and deterministic and preserving the fast WebGPU map path.

### Decision

- Quantise land height into six discrete elevation tiers using fixed land quantiles (45/65/80/92/98%).
- Store elevation in a `Uint8Array`; derive **base defense = 1 + elevation**. Add **+1** when the pixel has a nonzero owner.
- Give each attack **30 attack points per tick**. A capture subtracts the target's defense. If the next candidate costs more than the remaining budget, requeue it and end the tick.
- Render elevation by storing the normalized tier in the control texture's previously unused alpha channel. The shader maps tiers to lowland/plains/hills/highlands/mountains/peaks colors, tints owner colors, brightens snow, and draws tier-boundary contours.
- Expose elevation, base defense, and total defense in the compact hover readout.
- Bump `MAP_VERSION` to 3 and protocol version to 10.

### Consequences

- Terrain and occupation affect attack speed without new per-attack resources.
- Defense is derived from static elevation plus live ownership, so no extra mutable defense array is needed.
- Capturing a defended pixel changes defense for future captures at that cell but not the map.
- Bots do not yet evaluate defense when choosing targets; they simply take longer on high ground.
- Attack capture volume drops, which reduces tick cost; the renderer texture layout is unchanged in size.
- Elevation is part of map version and must match across clients. The shader's elevation palette is presentation-only and versioned with the app.

### Alternatives considered

- Continuous elevation defense: more granular, but harder to read in the HUD and to balance.
- A per-cell mutable defense array: more state and checksum cost; current defense is fully derived.
- Pixel-level attack progress: more realistic but adds per-front state and partial-capture UI with little first-pass value.
- Encode elevation in the B channel: would lose continuous relief shading; alpha was unused.

---

## ADR-014 — Structure effects and the State defense aura

**Status:** aura radius and ownership rules superseded by ADR-021 (radius 16, friendly-only). The derived-overlay approach remains current.

**Status:** accepted for EXP-001  
**Date:** 2026-11-19

### Context

Structures were static anchors with no gameplay effect. The next step is effects, starting with the State projecting a defensive aura. Effects must integrate with the existing defense/attack-point economy, remain deterministic, and be readable on the map.

### Decision

- Add an effect descriptor list to each structure type. The State carries one `defense-aura` effect: radius 12 map pixels, +20 defense.
- Apply the aura to all land pixels in radius, including the structure cell, regardless of owner. Overlapping auras take the maximum rather than summing.
- Derive a `Uint8Array` aura-defense overlay by stamping live structures. Rebuild the overlay when a structure is destroyed. Defense becomes `1 + elevation + occupied + aura`.
- Include effect descriptors in public structure snapshots/protocol so clients can draw and predict auras.
- Render auras as faint owner-colored fields with dashed boundaries at tactical zoom; hide them when their screen radius is smaller than the capital marker. Keep capital markers on top. **Superseded by ADR-018:** aura circles were removed in favor of district tinting.
- Show the aura bonus in the hover defense readout.

### Consequences

- Capitals strongly protect their immediate surroundings: max defense rises from 7 to 27, so one aura pixel costs at least 21 points and usually captures one pixel per tick.
- The aura is a zone effect, so captured ground inside it remains defensively strong for either side.
- Rebuild cost is ~48k writes for all 51 capitals and only occurs at creation or destruction.
- Effects are derived from type definitions; if effect numbers change, protocol/version and docs must change.
- Future structures can reuse the effect list for healing, production, or other area effects.

### Alternatives considered

- Aura only on friendly territory: more intuitive ownership-wise, but requires ownership-dependent recomputation and lets attackers bypass the structure's protective field.
- Stacking overlapping auras: can push defense above the 30-point attack budget and stall fronts permanently.
- Per-cell mutable defense: unnecessary; aura defense is already derived from live structures.
- A separate aura map texture: unnecessary; the overlay is small and only 51 circles.

---

## ADR-015 — Human gold economy and drag-and-drop build cards

**Status:** superseded by ADR-020 (card hand/reroll)  
**Date:** 2026-11-19

### Context

State structures are anchors, but the player needs buildable structures and a reason to choose between them. The requested loop is a small gold income, a three-card hand, and dragging a card into controlled territory to buy/build it. Captured structures are razed.

### Decision

- Give the human commander **3 starting gold** and **3 random cards** from a pool of Mine, Barracks, and Defense Post. Every draw is independent (with replacement); there is no deck.
- Pay **1 gold per 10 seconds** plus 1 per live Mine. Income is paid at tick boundaries.
- Cards cost Mine 3, Barracks 2, Defense Post 2 (later balance), Command Post 4, War Academy 6. **Refresh** costs 1 and replaces the hand with three new draws.
- Build/refresh are queued commands applied at the next tick. A build validates card, gold, own land, and empty structure slot, then removes the card and creates the structure.
- Drag-and-drop is the only placement gesture. The drop point is converted through the camera to a map cell; invalid drops produce a toast and no cost.
- Card draws use a dedicated deterministic RNG seeded from the world seed. Gold, hand, card RNG, and income tick are checksummed.
- Mine adds income; Defense Post adds a stacking +5 friendly-defense aura in a 16 px radius; Barracks adds stacking attack strength in a large radius. Defensive auras only protect land owned by the structure owner. Barracks strength reduces target defense cost, floor 1, for that owner's attacks.
- Any structure whose cell is captured is razed, including buildables; effects disappear immediately.

### Consequences

- The human has a meaningful build/economy loop while bots remain attack-only stress actors.
- Starting at 3 gold is a provisional choice so the first hand can be played immediately.
- Refresh replaces rather than refills the hand; this is the chosen interpretation of “draw three back into hand.”
- Pending commands can race: the first build removes a card, later duplicates fail validation.
- The card hand is a bottom overlay; drag/drop must work at any camera zoom and must only succeed inside controlled territory.
- Card economy is human-only until bot production/build AI exists.

### Alternatives considered

- Start at 0 gold: delays the first build and makes the opening hand inert for 10 seconds.
- Draw from a shuffled deck: contrary to the requested independent pool draws.
- Click-to-select then click-to-place: rejected in favor of direct drag-and-drop.
- Global Barracks attack bonus: ignores the requested radius.
- Additive State auras: can push defense above the attack budget permanently; keep max for State, additive for Defense Posts.

---

## ADR-016 — Attack orders gain +1 every 10 seconds; Command Post and War Academy cards

**Status:** Command Post lump grants superseded by ADR-022 (continuous accrual). Base order grants and War Academy remain current.

**Status:** accepted for EXP-001; revised after playtest feedback  
**Date:** 2026-11-19

### Context

The previous system capped active fronts (3 human / 2 bots) and effectively refunded a slot when an attack ended. The first order-timer implementation refilled all orders every 10 seconds. That made spending feel free after each timer and made War Academies less meaningful. The revised rule is a stock of orders where the timer grants a single order.

### Decision

- Give each player integer **attack orders**: base cap **3 human / 2 bots**, starting full.
- Launching an attack spends one order. Active attacks no longer block new launches; only available orders do.
- Every **100 ticks (10 seconds)**, each living player gains **+1 order, clamped to the cap**. This is not a full refill.
- Add **Command Post** (4g): every 60-second global boundary, add +1 attack order per live Command Post, clamped to the cap.
- Add **War Academy** (6g): add +1 to the owner's live attack-order cap per academy. Losing an academy clamps current orders to the new cap.
- Show available orders / cap in the HUD. Snapshot and checksum include orders and both timer values.
- Bots use the same order rules but have no cards.

### Consequences

- Refilling from empty now takes multiple 10-second grants instead of one; spending orders has a sustained opportunity cost.
- The cap is a hard maximum. Command Post pulses can be partially or fully wasted at cap; that is accepted because the card also provides burst recovery after spending.
- War Academies raise both the stock ceiling and the number of grants needed to refill, making them a longer-term investment.
- Bot pressure is lower than the old free-active-front model: bots start with 2 orders, gain 1 per 10 seconds, and spend one per attack.
- The card pool grows to five types; starting gold (3) cannot immediately buy either new card.

### Alternatives considered

- **Full refill to cap every 10 seconds:** the previous behavior; rejected because it removes scarcity between timers.
- **Refill one random/selected order:** unnecessary complexity; a flat +1 is clearer.
- **Allow Command Post to exceed the cap:** rejected once the timer became +1; the cap should be a real ceiling.
- **Keep active-front caps in addition to orders:** double-limiting and contrary to the request.
- **Human-only orders:** would leave bot behavior on a different attack economy; the shared rule is simpler.
- **Generic “Order Post” / “War College” names:** Command Post and War Academy are clearer while remaining provisional.

---

## ADR-018 — Bounded Voronoi districts and same-type stacking

**Status:** accepted for EXP-001  
**Date:** 2026-11-19

### Context

Structures need territorial identity beyond their auras. The requested model gives each structure a district that fills nearby owned land, stops at borders and a maximum range, splits against other districts by nearest-pixel distance, and prevents incompatible structures from sharing the area. Larger districts should reduce clutter, and players should be able to create more districts of the same type.

### Decision

- Every **buildable** structure seeds a district. Ranges are Mine 32, Defense Post 40, Barracks 44, Command Post 32, War Academy 32. State capitals have `districtRange: 0`; a 32 px capital district would cover the entire starting territory and make cards unplayable.
- Recompute districts as a constrained Voronoi map over current ownership: each owned cell chooses the nearest eligible structure of its owner within that structure's range. Ties break on type code, then structure id.
- Multiple structures and districts per owner/type are allowed. A same-type drop inside a district increments that district structure's `stacks`; the same type dropped outside all districts creates another structure/district. A different type inside any district is rejected.
- `districtStructureIds` records the winning structure per cell, so stacking and auras can distinguish same-type districts. State auras remain radius-based.
- `stacks` multiply the structure's effect magnitude (income, defense, attack strength, order gain, order cap). Geometry/range stays fixed.
- Defense auras apply to every cell whose district id matches the structure and whose owner matches; buildable defense auras are not clipped to the old effect radius. State auras use radius 16. Barracks later becomes a global embedded-order bonus in ADR-024.
- Full district recomputation runs on structure creation/destruction; ordinary ownership changes reassign one cell. Stacking does not change geometry.
- Render district palettes by packing a 5-bit code (four variants per structure type) into control-texture alpha above 3 elevation bits; tint by type, vary brightness per district, and darken shared boundaries. Aura circles are removed.

### Consequences

- Same-type districts remain visually distinct despite sharing a type color family.
- State capitals no longer block construction, and the first build is possible in the starting territory.
- Large districts deliberately reduce building density: a district can cover most of a small territory, so further different-type construction waits for expansion.
- District recomputation is occasional and bounded; per-capture updates are local, and district color needs no extra texture binding. Per-cell structure ids add 8 MiB.
- Defense auras fill buildable district geometry; State auras remain a radius field. Barracks is reworked into embedded attack orders in ADR-024.
- Existing 8 px spacing remains a secondary placement guard, though district ranges usually dominate.

### Alternatives considered

- **One structure per owner/type:** rejected because players should be able to create more same-type districts.
- **Capital districts:** rejected because a 32 px district covers the start and disables the card loop.
- **Unbounded Voronoi over the whole map:** districts would ignore ownership borders and ranges.
- **BFS flood fill instead of Euclidean Voronoi:** would follow terrain connectivity but not the requested nearest-pixel split.
- **Extra district texture:** more bindings and uploads; packing into alpha is sufficient for five palette groups with four variants.
- **Stack increases district radius:** would make geometry churn and make placement rules unstable; stack effects scale instead.

---

## ADR-019 — Defense-aware least-resistance sampling

**Status:** accepted for EXP-001  
**Date:** 2026-11-19

### Context

Attack movement is chosen by geometry-only growth layers. A high-defense cell can consume the front's 30-point budget while cheaper adjacent frontier cells wait, making the attack appear stuck on a mountain or aura even when a weak lane exists.

### Decision

- Each capture samples up to `LEAST_RESISTANCE_SAMPLE_SIZE` (10) candidates in growth priority order.
- Valid candidates are compared by integer effective cost (`defenseAt - barracksStrength`, floor 1). The cheapest is captured; ties keep sample order.
- Unchosen sampled candidates are pushed back in reverse sample order. Stale/disconnected candidates are discarded.
- If even the cheapest sampled candidate is unaffordable, all are requeued and the tick ends.
- Connectivity, ownership, mutual-contact cancellation, and budget checks are unchanged and happen before selection.
- The sample is simulation-side; growth layers still own geometry and checksum state.

### Consequences

- Attacks naturally flow around strongpoints while preserving their overall circular/smooth/organic shape.
- A costly candidate can still be chosen when it is the cheapest nearby option; defense slows rather than blocks.
- Cost is paid after selection, so the full 30-point budget is used more efficiently.
- Up to 10 extra frontier operations per capture; bounded and allocation-light.
- Sampling only the top candidates is intentionally local. A very cheap cell buried deep in the frontier is not found until it reaches the sample window.

### Alternatives considered

- **Global cheapest frontier scan:** ignores growth shape and costs O(frontier) per capture.
- **Defense in the growth-layer priority key:** couples rendering-style layers to combat and can overwhelm distance with aura values.
- **Only fallback when the top candidate is unaffordable:** misses proactive flow around expensive but affordable strongpoints.
- **Randomized cost sampling:** harms determinism and replay clarity.

---

## ADR-020 — Permanent card catalog and auto-hiding hand

**Status:** accepted for EXP-001  
**Date:** 2026-11-19

### Context

The random three-card hand and paid reroll created unnecessary downtime and card-economy RNG. The player asked to see every available card at once, buy any of them whenever affordable, and reclaim bottom-screen space when the hand is not in use.

### Decision

- Remove card draws, hand size, and Refresh entirely.
- The hand is a fixed catalog of all five buildable types with stable ids `1..5`.
- Purchases deduct gold and build/stack, but never remove the card. The same card is immediately buyable again if gold and placement rules allow.
- Hand membership remains a command validation guard, but there is no card RNG or consumption.
- Hand gold/income/order economy is otherwise unchanged.
- UI: the hand starts raised. A window pointer tracker raises it when the pointer is within the hand bounds and sinks it otherwise; during card drag it stays raised. The collapsed state translates the cards down to a ~30 px peeking strip.
- Drag gestures and placement validation are unchanged.

### Consequences

- Every build option is always visible; gold becomes the only availability gate.
- No reroll button, refresh command, card RNG, hand checksum, or dead-hand downtime.
- Repeat purchases are the normal way to stack or create another same-type district.
- The collapsed hand preserves map space while keeping a discoverable peeking strip.
- Touch users raise the hand by pressing a visible card; there is no hover on touch devices.

### Alternatives considered

- **Keep a reroll but make it free:** still adds a redundant action and UI.
- **Consume cards but draw replacements:** retains hand RNG and downtime.
- **Five cards with cooldown per card:** adds hidden state without user request.
- **Fully hide the hand:** would make card access undiscoverable; the peeking strip keeps affordance.

---

## ADR-021 — District geometry, not effect radius, defines buildable defense auras

**Status:** accepted for EXP-001  
**Date:** 2026-11-19

### Context

The initial district implementation still clipped Defense Post auras to the old effect radius. That made a district visibly larger than the defense area it provided. The requested rule is that the effect covers exactly the pixels colored as its district, with no radius fallback.

### Decision

- A buildable defensive aura applies to every owned cell whose `districtStructureIds` equals that structure's id.
- The effect radius is ignored for buildable defense auras; Defense Post's effect radius is stored as 0 to prevent accidental radius use.
- State has no district and keeps its 16 px capital aura.
- Barracks remains outside the district aura model; ADR-024 later converts it to a global embedded-order bonus.
- `updateAuraAt` and the full aura rebuild share the same district-id rule.

### Consequences

- Defense Post strength exactly matches its colored district, including stacked defense.
- Expanding or losing district cells immediately changes aura coverage through capture updates.
- Multiple same-type Defense Posts each buff only their own district.
- State defense remains a special capital-radius field, separate from districts.
- Barracks is not an aura; ADR-024 converts it to a global embedded-order bonus.

### Alternatives considered

- **Keep radius but enlarge it to district range:** still clipped on Voronoi boundaries and by district shape.
- **Use rectangular district bounds:** includes cells outside the district.
- **Apply to all owner districts of the same type:** would let unrelated same-type posts share auras.
- **Give State a district:** would blanket the starting territory and disable early builds.

---

## ADR-023 — Noisy district extents and borders

**Status:** accepted for EXP-001  
**Date:** 2026-11-19

### Context

Districts were exact circles/Voronoi cells. The requested look is organic: districts should subtly grow and shrink, and borders should not be mathematically smooth.

### Decision

- Add an integer noise offset to the squared-distance comparison used by district selection.
- Noise combines bilinear 8 px value noise with a faint per-pixel hash jitter; no simulation RNG draw is involved.
- The offset is scaled by structure range so the outer boundary moves by roughly two pixels in either direction.
- Expand district and aura scan boxes by `DISTRICT_NOISE_MARGIN` (4 px) so outward noise is not clipped by the nominal radius.
- The resulting district map remains the single source of truth for tint, auras, stacking, and placement.

### Consequences

- Outer edges and same-owner split lines are irregular but stable for a given seed and structure.
- Aura coverage follows the noisy geometry exactly.
- District rebuild does a few extra hashes per candidate cell; this is infrequent, not per-tick.
- Nominal district range remains the design value; displayed tint may extend a couple of pixels beyond it.

### Alternatives considered

- **Per-pixel white noise only:** too jagged and speckled.
- **Animated noise:** changes simulation geometry every tick and would make districts unstable.
- **Noise only in rendering:** would desynchronize tint/borders from actual aura and placement coverage.
- **Randomize range once per structure:** produces blobs but not wavy borders.

---

## ADR-024 — Barracks issue embedded attack orders; mutual fronts attrit

**Status:** accepted for EXP-001  
**Date:** 2026-11-19

### Context

Barracks previously granted a local defense-piercing aura. The requested model makes Barracks raise the number of orders embedded in each attack, and lets attack strength determine speed, defense piercing, and durability. Mutual fronts also need to trade strength instead of cancelling outright.

### Decision

- Barracks effect becomes `attack-order-bonus`, +1 embedded order per stack. **Scaling later superseded by ADR-026:** one order per two levels, capped at +5.
- A launch still costs one inventory attack order. The created attack embeds `1 + attacker Barracks scaling` orders; clicking again creates another attack and never adds to an existing one.
- Attack points per tick = `30 + 15 × (orders − 1)`.
- Capture cost = `max(1, defense − (orders − 1))`.
- Lifetime = `50 + 10 × (initial orders − 1)` ticks.
- At a mutual claim contact, the defender spends `min(its issued attack strength, remaining inventory orders, incoming orders)` from inventory. Each spent order removes one incoming embedded order. Zero halts the attack; otherwise the clash pauses the front for the tick. No spendable orders means the attack breaks through.
- Issued attack strength is `1 + live Barracks scaling` for both launching and defensive clash strength. **Superseded by ADR-026:** one order per two levels, max +5.
- Remove the old attack-aura radius and defense-piercing field.

### Consequences

- Barracks scales both offense and defensive staying power without granting inventory.
- Repeated clicks are intentionally separate attacks; there is no click-to-reinforce path.
- A defender without Barracks or spare orders can only chip a strong attack and eventually loses the front.
- Strong attacks consume more points per tick but also pierce more and live longer; high defense still matters, especially against base attacks.
- The 30-point and 5-second base values remain the baseline; embedded orders are the scaling axis.

### Alternatives considered

- **Merge repeated clicks into one attack:** contradicts the requested no-upgrade-by-click behavior.
- **Spend embedded orders from inventory at launch:** would make Barracks a cap increase rather than an attack multiplier.
- **Cancel both attacks on contact:** does not allow 2-order attacks to require two defenses.
- **Use only the opposing front's current orders for defense:** would ignore the defender's remaining inventory, which the requested rule explicitly caps.

---

## ADR-025 — District upgrades cost base card cost plus current level

**Status:** accepted for EXP-001  
**Date:** 2026-11-20

### Context

Click-to-upgrade was priced at the structure's flat card cost, so every level cost the same. The requested economy adds a level-dependent surcharge. The follow-up requirement extends the same rule to matching cards dropped on an already-built district.

### Decision

- Any upgrade to an existing district costs `structure card cost + current structure level`.
- This applies both to clicking a district and to dropping a matching card inside it. A card that creates a new structure still pays the base card cost.
- Click upgrades project the level through already-queued upgrades for the same district, so rapid clicks quote and reserve increasing costs. The quoted cost is stored in the queued `UpgradeCommand`.
- Card stacking recomputes the current level at execution and pays the same surcharge.
- The card is never consumed.

### Consequences

- High-level districts become progressively expensive to upgrade through either gesture.
- The upgrade toast shows the exact level and cost.
- Pending click upgrades reserve their quoted costs and cannot overspend.
- A matching card costs more than its printed base when dropped on an existing district; the landing validation shows the dynamic gold requirement.

### Alternatives considered

- **Apply the surcharge only to clicks:** rejected by the follow-up requirement.
- **Compute cost only at execution for clicks:** would allow rapid clicks to overspend or fail late.
- **Exponential cost:** steeper than requested; the rule explicitly says additional gold equal to current level.

---

## ADR-026 — Barracks diminishing returns and higher base cost

**Status:** accepted for EXP-001  
**Date:** 2026-11-20

### Context

Barracks gave +1 embedded order per level with no cap. At high levels this produced enormous attack speed, defense piercing, lifetime, and clash strength, so a single structure type dominated scaling.

### Decision

- Barracks base cost increases from 2 to **12** gold.
- Attack-order bonus becomes **one embedded order per two Barracks levels**, rounded up, capped at **+5** (six embedded orders total).
- The same capped strength is used for defensive clash spending.
- `BARRACKS_LEVELS_PER_ORDER` and `BARRACKS_MAX_BONUS_ORDERS` own the tuning values.

### Consequences

- Level 1 still grants +1 order, preserving the core card promise.
- Level 2 does not increase strength; level 3 reaches +2.
- Level 10 and above cap at +5, preventing runaway speed, piercing, and lifetime.
- The 12-gold entry price makes early Barracks a real commitment.

### Alternatives considered

- **Keep linear growth and reduce point/pierce constants:** still allows unbounded clash strength and lifetime.
- **Cap levels only:** level-ups would give no benefit without warning and would not address early exponential effect.
- **Quadratic/square-root scaling:** harder to communicate; two-level steps plus a hard cap are transparent.

---

## ADR-027 — 50 bots with deterministic strategy profiles and a build economy

**Status:** accepted for EXP-001  
**Date:** 2026-11-20

### Context

The stress build had 107 bots, all following the same neutral-first attack policy with no economy or structures. That made the field uniform and prevented testing bot construction, district contention, or varied pressure.

### Decision

- Reduce the field to **50 bots + 1 human = 51 states**; `MAP_VERSION` becomes 4.
- Give every bot a deterministic profile derived from `hash32(player id, seed)`: aggression, economy, fortification, command, and one focus structure type. Profiles are not drawn from the shared PRNG.
- Bots start with 12 gold and accrue `1 + Mine levels` per 10 seconds continuously.
- Every 3 seconds a bot saves toward or upgrades its focus structure. Mines/Command Posts/War Academies prefer capital-adjacent placement; Defense Posts/Barracks prefer border placement.
- Every second, aggression modulates attack frequency and target choice. Passive bots skip more attacks and prefer neutral land; aggressive bots attack more and can choose rival territory even when neutral land is adjacent.
- Defer district/aura rebuilds until all bot builds in a decision batch finish, preventing up to 50 full rebuilds in one tick. **Later refined by ADR-028:** district changes refresh locally; only aura rebuilds batch.

### Consequences

- Each bot has a visibly different investment pattern and attack tempo.
- Bot gold, accrual, profiles, and focus types are simulation state; gold and accrual are checksummed, while profiles are derived deterministically from seed/id.
- Bots do not use the human card hand and do not coordinate with each other.
- The smaller field lowers benchmark tick cost and memory while increasing per-bot strategic variety.

### Alternatives considered

- **Random profiles from the shared PRNG:** would perturb all attack draws and obscure determinism reasoning; hashing is isolated and replayable.
- **Let bots use cards:** the hand is a human UI concept; a direct gold/build decision is simpler and testable.
- **Rebuild districts after every bot build:** causes a large periodic spike; batching is safe because each bot's first district is owner-local.

---

## ADR-028 — Bot personalities, grievances, and five-type build plans

**Status:** accepted for EXP-001  
**Date:** 2026-11-20

### Context

The first bot economy gave each bot one focus structure and a single aggression score. All bots expanded into neutral land until none was adjacent, so diplomatic/emotional behavior, retaliation, and multi-structure build paths were absent.

### Decision

- Add hash-derived traits: vengeance, caution, conciliation, opportunism.
- Replace the single focus with a five-type build plan sorted by profile preferences; the first entry remains the opening focus.
- Bots build the next unbuilt plan type when affordable and placeable, otherwise upgrade the lowest-level existing plan structure.
- Record a capped grievance for each captured pixel: `defender × attacker` matrix.
- Target selection samples border neighbours and scores them using:
  - neutral expansion baseline,
  - aggression,
  - stored grievance × vengeance,
  - active attacks on the target × opportunism,
  - caution/conciliation penalties when the target is stronger,
  - caution penalty when the target still has attack orders.
- Compute target pressure and player strength once per bot decision tick. Strength is `territory/4 + structure levels × 300 + attack orders × 150`.
- Checkpoints can now show grudges leading to retaliation and bots joining existing wars.
- New/destroyed buildables refresh districts only within their own radius. A full-map district rebuild under 50 bot builds cost ~200 ms; local refresh keeps sustained ticks at ~2 ms.

### Consequences

- Bots fight earlier and more selectively; high-aggression/vengeful/opportunistic bots start and join wars while cautious/conciliatory bots prefer neutral expansion.
- Build diversity grows over time: a 90-second sample produced all five structure types and up to four structures per bot.
- Grievance counts persist, so emotional bots hold grudges; no diplomacy/alliance system exists.
- Grievances alter behavior and are checksummed, so replay and determinism include them.

### Alternatives considered

- **One archetype label per bot:** simpler, but a single label cannot express mixed traits like cautious-opportunist or friendly-vengeful.
- **Decaying grudges:** more realistic but adds timers and tuning; persistent capped counts are simpler and visibly retaliatory.
- **Global strategic target selection:** bots only know adjacent owners; a global planner is outside this stress experiment.

---

## ADR-029 — Periodically fill small neutral pockets

**Status:** accepted for EXP-001  
**Date:** 2026-11-20

### Context

Organic growth leaves many one-pixel and small coastal neutral gaps. The annexation pass intentionally handles only owned components, so these neutral specks persist inside or along claimed territory and dominate the visual read.

### Decision

- Add a separate neutral-component cleanup to `TerritoryIntegrity`.
- Label neutral land components in row-major seed/BFS order.
- Eligible pockets are at most **96 cells** and border at least one owner.
- Fill into the owner with the largest shared border, lowest id on ties.
- Allow ocean contact: many distracting organic gaps are thin coastal slivers rather than landlocked holes.
- Leave ownerless islands and larger neutral regions untouched.
- Run every **100 ticks (10 seconds)**, after annexation.
- Apply fills through `claim(..., 0)` so territory counts, borders, districts, auras, and renderer changes stay consistent.

### Consequences

- A 90-second organic sample left 155 small owner-bordered neutral components (661 cells); cleanup removes them in a single pass.
- The main neutral landmass remains open for expansion because it is far above the area threshold.
- Cleanup costs one additional labeling pass every 10 seconds; benchmark sustained ticks remain ~2.2 ms.
- Legitimate neutral islands with no adjacent owner are preserved.

### Alternatives considered

- **Fill all neutral components touching owners:** would erase large expansion regions.
- **Only landlocked holes:** missed most visible organic coastal slivers.
- **Run every annexation tick:** unnecessary cost and removes specks before they are visually noticed.
- **Merge cleanup into owned-component annexation:** different labels, thresholds, and ocean policy would complicate the annexation invariants.

---

## ADR-030 — Threat-aware bot defense and gold reserves

**Status:** accepted for EXP-001  
**Date:** 2026-11-20

### Context

Bots could build and attack but ignored attacks against them. They spent every affordable tick on their offensive build plan and never reserved gold for fortification or rebuilt a destroyed defense.

### Decision

- Compute an integer threat score per bot once per decision tick:
  - 25 per active hostile front (cap 50),
  - 1 per hostile border pixel (cap 8),
  - 2 per grievance added since the previous refresh (cap 20).
- Use hysteresis: enter defensive posture at 20, leave at 10.
- Reserve up to 12 gold for the next missing Defense Post, missing Barracks, or cheaper defensive upgrade.
- While threatened, build/upgrade defense before the plan. Prefer a border cell touching an enemy. Rebuild destroyed defenses first.
- Release the reserve after 3 build intervals without an affordable defensive action.
- Bias target scoring toward an active attacker or grudge holder while threatened; penalize unrelated aggression and raise the value of quiet neutral expansion.
- Include threat, posture, reserve, stall counters, and grievance marks in checksums.

### Consequences

- Bots now react to wars instead of ignoring them.
- Contact alone cannot hold the reserve forever, and the stall valve prevents deadlock.
- Macro telemetry over 2 × 900 ticks preserved attack volume and alive counts while adding defensive spending.
- Sustained tick cost remained ~1.8 ms.

### Alternatives considered

- **Global threat from total enemy territory:** too coarse; bots need local war pressure.
- **Uncapped reserve:** would freeze the economy during long wars.
- **Immediate reserve release on peace:** caused flapping; hysteresis and the stall valve are more stable.

---

## ADR-031 — Requeue unaffordable least-resistance candidates

**Status:** accepted for EXP-001  
**Date:** 2026-11-20

### Context

`processAttacks` sampled candidates, requeued all but the chosen one, then broke when the chosen candidate exceeded the remaining point budget. The cheapest candidate was therefore dropped and a zero-capture tick could kill the front, contradicting the documented requeue rule.

### Decision

- When the chosen candidate is unaffordable, requeue **all** sampled candidates, mark the tick cost-blocked, and keep the front alive.
- Keep the existing requeue for the unchosen candidates only after an affordable capture.
- Do not kill a front on a zero-capture tick when a clash or affordability check paused it.

### Consequences

- Fronts no longer lose their cheapest frontier cell at the end of a tick.
- The code matches SPEC/DETERMINISM and preserves determinism.
- This is a behavior fix; protocol remains 31 with the same wire shape.

### Alternatives considered

- **Increase the point budget:** hides the bug and changes balance.
- **Drop the chosen candidate intentionally:** creates needless front churn and contradicts the documented least-resistance contract.

---

## ADR-032 — Dirty district tiles and staggered bot construction

**Status:** accepted for EXP-001  
**Date:** 2026-11-20

### Context

`refreshDistrictsAround` avoided a full simulation district rebuild, but it still set `districtsChanged`, which made the renderer rebuild the entire 2.1M-pixel control texture and queue a full upload. All 50 bots also built on the same 3-second tick, which produced up to 549 dirty district tiles at once (above the 96-tile full-upload threshold).

### Decision

- `StepResult` reports `districtTiles`, the 32 × 32 tiles whose district palette can change.
- `TerritoryRenderer.applyChanges` rewrites only the packed alpha channel for those tiles and uses the normal dirty-tile upload path. Full rebuild remains the fallback for overflow/reconnect.
- `RENDER_TILE_SIZE = 32` is shared by simulation and renderer.
- Stagger bot build ticks by player id: each bot still evaluates once per `BOT_BUILD_INTERVAL`, but only about two bots act per tick.
- Before a staggered build, refresh that bot's threat/posture so it does not spend using a stale reserve.

### Consequences

- A structure build no longer triggers a full control-texture CPU rebuild.
- In a 300-tick sample, the worst district batch fell from 549 tiles to 32, below the full-upload threshold.
- Bot behavior changes slightly because budgets are spread across the interval; protocol is bumped to 32.
- Threat can be computed on build ticks between decision ticks, at the cost of one border scan for that bot.

### Alternatives considered

- **Keep all bots on one tick:** simple but causes periodic rendering and simulation spikes.
- **Full resync for district changes:** correct but expensive and unnecessary; only alpha bytes change.
- **Increase the full-upload threshold:** hides the batch problem and turns it into hundreds of tiny uploads.

---

## ADR-022 — Click-to-upgrade districts and continuous resource accrual

**Status:** accepted for EXP-001  
**Date:** 2026-11-19

### Context

Players could upgrade a district only by dragging another matching card onto it. Resource structures paid in lumps at interval boundaries, so a level-30 Mine produced nothing for ten seconds and then paid 30 gold. The requested behavior is a direct district upgrade gesture and a smooth resource stream.

### Decision

- Clicking any owned buildable district queues an `upgrade` command for that district's structure.
- Upgrades cost the structure's card cost, add one `stacks` level, rebuild auras, and do not consume a hand card. Multiple pending upgrade costs are reserved so rapid clicks cannot overspend. **Cost superseded by ADR-025:** add the projected current level.
- Mine income is accrued every tick: `goldAccrual += income`; whole 100-point chunks become gold. A level-30 Mine therefore contributes 30 gold across 100 ticks.
- Command Post orders use the same model: `commandPostAccrual += orderRate`; whole 600-point chunks become orders, clamped to the cap.
- Base +1 order per 100 ticks remains a boundary grant.
- Integer remainders are authoritative checksum state; no floating point is introduced.

### Consequences

- Resource income feels continuous and scales smoothly with levels.
- Clicking a district is now a deliberate economy action; clicking other territory still attacks.
- Upgrade costs are the same as buying the structure again; level growth is unbounded by data structures but limited by gold and district ownership.
- Mine/Command Post effects stop immediately when the structure is captured because rates are read from live structures.
- Command Post orders at cap are lost, matching the prior clamped pulse semantics.

### Alternatives considered

- **Keep lump payments but pay at construction time:** front-loads resources and complicates build/destroy timing.
- **Store fractional gold as floats:** harms deterministic exactness.
- **Charge an escalating upgrade cost:** adopted by ADR-025 as `base card cost + current level`.
- **Upgrade only by clicking the structure icon:** the request explicitly targets districts, and the whole colored area is larger and easier to hit.

---

## ADR-033 — Frontage v1: supply, durable strength, refunds, 70% victory

**Status:** accepted and implemented in 0.30.0  
**Date:** 2026-11-20

### Context

The approved product decisions replaced EXP-001's attack-order inventory and fixed front lifetime: Frontage v1, 51 states, one resource, instant victory at 70% land, cancellation with refunds, and arbitrary match length. The existing gold card economy, order grants, embedded-order clashes, and Command Post/War Academy order effects could not coexist with a single supply resource.

### Decision

- Use **supply** as the only resource for cards, upgrades, and fronts. The internal `gold` field name is retained for save/snapshot compatibility in this build, but UI and rules call it supply.
- Supply income is `min(60, 3 + floor(territory/10000) + income effects)` per second; cap is `min(600, 120 + floor(territory/1000) + 40 × War Academy stacks)`. Gains clamp; losing a War Academy clamps supply.
- A front costs `30 + 15 × bonus steps` supply and gains strength `1500 + 450 × steps`, power `30 + 15 × steps`, and piercing `steps`.
- Captures spend power and strength. Idle fronts die after 20 captureless ticks; no fixed lifetime and no match clock.
- Mutual fronts lose `100 + 50 × opponent steps` strength once per pair per tick.
- Cancellation refunds `floor(launchCost × remainingStrength / initialStrength)`.
- Mine/Command Post become supply-income effects; War Academy becomes supply cap; Barracks keeps its bonus-step scaling.
- Holding 70% of land wins immediately. Last living state still wins when others are eliminated.
- Protocol 33 / app 0.30.0.

### Consequences

- Every card and front competes for the same resource.
- Supply cap makes War Academy a spending-headroom choice instead of an order cap.
- Cancellation gives players a way out of overcommitted fronts without erasing attrition.
- Long matches are possible; telemetry must treat timeout as unbounded rather than a 15-minute fallback.
- Supply/strength/idle state is checksummed and tests cover cancellation, 70% victory, income/cap, and strength attrition.

### Alternatives considered

- **Gold + supply:** rejected by the approved single-resource decision.
- **Fixed front lifetime:** rejected in favour of strength and idle expiry.
- **No refunds:** rejected by the approved cancellation decision.
- **60% held for 60s:** rejected in favour of instant 70% victory.

---

## ADR-034 — Replace Mine with active Artillery

**Status:** accepted and implemented in 0.31.0  
**Date:** 2026-11-20

### Context

Mine was redundant after supply became the only resource: base territory income and Command Posts already covered economy needs, so the Mine card had no distinct decision niche. The requested replacement is an active ability structure that bombards structures within a large radius, firing one shell per level and removing one level per structure hit.

### Decision

- Remove `mine`; add `artillery` in the same card slot at **6 supply**.
- Artillery has no passive effect. It has a **140 px** target range and a **6 s** per-battery cooldown.
- The human activates targeting with `A` or the HUD `FIRE` control, then clicks an aim point. Clicks snap to a hostile structure within 28 px; at least one ready battery must be within range.
- Every ready battery in range fires **one shell per structure level**. Shells fly for **2 s**, spread deterministically by up to ±7 px, and remove one level from the nearest hostile structure within a **12 px** blast.
- A level-1 structure is destroyed. Destroying a State removes annexation protection.
- Bots use the same ability, choosing the strongest hostile structure reachable by a ready battery.
- Protocol 34 / app 0.31.0. Frontage supply/front rules are otherwise unchanged.

### Consequences

- The five-card hand remains permanent, but the economy card becomes a siege tool.
- Artillery strongly rewards leveling but competes with Barracks and War Academy for supply.
- Active use needs a targeting mode; range rings and shells are rendered in the 2D overlay.
- Shells, cooldowns, and 70% victory remain checksummed and deterministic.

### Alternatives considered

- **Auto-fire artillery:** rejected because the request specifies an active ability.
- **Single-target click on battery then target:** more clicks and harder on touch than a FIRE mode.
- **Supply cost per volley:** rejected; cooldown alone bounds output and keeps the card affordable.
- **Damage structures with splash only:** would make aiming at empty ground meaningless; a 12 px blast still requires deliberate targeting.

---

## ADR-035 — Artillery build and fire costs

**Status:** accepted and implemented in 0.32.0  
**Date:** 2026-11-20

### Context

Artillery at 6 supply with free volleys was too efficient: it replaced the Mine slot, was easy to spam, and turned every structure into cheap siege fodder. The request was to make the structure much more expensive to build and to fire.

### Decision

- Raise the Artillery build cost from **6 to 30 supply**.
- Charge **12 supply per shell** fired, so a level-N battery spends `N × 12` supply per volley.
- Validate the full volley cost before the command is accepted and spend it when the volley resolves. If the player cannot pay, no cooldown starts and no shells are created.
- Show the current volley cost on the HUD `FIRE` control and disable it when unaffordable.
- Bots use the same build and fire costs.
- Protocol stays 34; app version becomes 0.32.0.

### Consequences

- Artillery is now a major economic commitment, comparable to a front launch just to build.
- High-level artillery has a real operating cost; sustained bombardment competes directly with cards and fronts.
- No partial volleys: the player pays for every ready shell or fires nothing.
- Upgrades are also much more expensive because upgrade cost is base cost plus current level.

### Alternatives considered

- **Flat cost per volley:** simpler, but ignored the one-shell-per-level scaling.
- **Supply per battery rather than per shell:** undercharged high-level batteries.
- **Keep build at 6 and only add fire cost:** still too easy to spam batteries.

---

## ADR-036 — Uncapped supply, infinite Barracks scaling, Fortifications, Jammers

**Status:** accepted and implemented in 0.33.0  
**Date:** 2026-11-20

### Context

Supply had a hard 600 maximum, Barracks scaling stopped at +5 steps, and Defense Posts were the only defensive structure. The requested direction is infinite scaling with controlled diminishing returns, compact supply readouts, and a global defensive aura that suppresses enemy Barracks effect without adding pixel defense.

### Decision

- Remove `SUPPLY_CAP_MAX`. Cap is `120 + floor(territory/1000) + 40 × War Academy stacks`, unbounded.
- HUD supply values use at most three significant digits with a comma decimal (`42 500 -> 42,5k`).
- Effective attack levels = `max(0, attacker Barracks stacks − defender Jammer stacks)`.
- Launch cost = `30 + 15 × effective levels`; durable strength = `1500 + 450 × effective levels`.
- `logTier = floor(log2(effective levels + 1))` via `Math.clz32`; power = `30 + 15 × logTier`; piercing = `logTier`; contact attrition uses opponent `logTier`.
- Rename Defense Post to **Fortification** (same +5 district defense, cost 2).
- Add **Jammer** (cost 8): global aura, −1 effective enemy Barracks level per stack, no pixel defense.
- Add a derived `structureStacksByType` cache keyed by `StructureRegistry.version`; income/cap/Barracks/Jammer lookups are O(types) and refresh only on registry mutation.
- Protocol 35 / app 0.33.0.

### Consequences

- Supply and attack scaling no longer have hard ceilings; HUD formatting handles large banks.
- Barracks strength/cost are linear, while speed/pierce grow logarithmically.
- Jammers make high-Barracks attacks cheaper but much weaker; they do not help against non-Barracks fronts.
- The permanent hand grows to six cards and bot build plans to six types.
- Cache invalidation is via registry mutation version; direct stack writes outside the registry must use `setStacks` (test helper) or effects go stale.

### Alternatives considered

- **Log strength too:** speed is the main per-tick leverage; strength should remain a linear investment.
- **Linear speed/pierce:** would make high Barracks overwhelming.
- **Flat Jammer effect not per stack:** would not support infinite scaling.
- **Keep cap at a larger fixed number:** still a ceiling; violates uncapped requirement.

---

## ADR-037 — Artillery siege rework

**Status:** accepted and implemented in 0.34.0  
**Date:** 2026-11-20

### Context

Artillery was still too cheap and too precise after the previous cost pass. A level-1 battery at 30 build/12 per shell could reliably delete structures, including State capitals, making it a dominant precision tool. The requested direction is a late-game, expensive, inaccurate siege weapon that cannot decapitate a State.

### Decision

- Build cost **300**; shot cost **150 supply per level**.
- Increase shell spread from ±7 px to **±36 px** and remove target snapping (radius 0). The clicked aim point is used raw.
- State structures are **immune** to artillery impact; other structures still lose one level per hit.
- Artillery district range increases from 32 px to **64 px**.
- Artillery cannot be built unless no district cell exists within **16 px** of its centre.
- Sort the permanent hand ascending by card cost: Fortification, Command Post, War Academy, Jammer, Barracks, Artillery.
- Protocol 36 / app 0.34.0.

### Consequences

- Artillery is a late-game saturation weapon and generally requires a raised supply cap.
- High-level batteries are expensive to fire and scatter many shells; overshooting can waste most of a volley.
- State capitals can only be removed by direct capture, not bombardment.
- Placement requires deliberate empty space away from existing districts.
- The hand order now communicates cost progression directly.

### Alternatives considered

- **Keep ±7 accuracy with high damage:** too reliable for the cost.
- **Allow State damage but not destruction:** a State has one level, so effectively immunity is the same rule.
- **Require 16 px only from the caster's own districts:** global clearance makes artillery placement a map-space decision and avoids enemy-district ambiguity.

---

## ADR-038 — Five-level batch upgrades and cursor cost tooltip

**Status:** accepted and implemented in 0.35.0  
**Date:** 2026-11-20

### Context

Upgrading a district required one click per level, and the player had no advance view of the total supply cost. Artifact costs now scale to 300+ and multi-level upgrades can be expensive, so batch upgrading and a pre-click quote matter.

### Decision

- `getUpgradeQuote(player, x, y, levels)` returns the atomic total for 1-5 levels, including queued upgrades and their projected levels.
- Shift-click calls `upgradeDistrict(..., 5)`. The full total is validated before any command is queued; if unaffordable, nothing is queued.
- The HUD tracks pointer screen position and Shift state, and shows a pointer-anchored tooltip above the cursor with the quoted total (`+1 LV` normally, `+5 LV` while Shift is held), current level, and final level. Insufficient supply is highlighted.
- Keyboard Shift+Enter follows the same modifier state.
- App 0.35.0; protocol unchanged at 36.

### Consequences

- Players can plan large upgrades without five separate clicks.
- No partial five-level batches are queued.
- The tooltip reuses the same quote used by queueing, so displayed and charged totals cannot drift.

### Alternatives considered

- **Queue five separate calls from the UI:** could queue partial levels when supply runs out.
- **Show a fixed base cost:** wrong once level scaling and queued upgrades are included.
- **Tooltip only on click:** the request asks for a cursor tooltip before committing.

---

## ADR-039 — ×20 card economy, +5 upgrade steps, +1 Fortifications

**Status:** accepted and implemented in 0.36.0  
**Date:** 2026-11-20

### Context

The card economy had drifted down to single-digit costs while artillery carried a special 300 price. Upgrades increased by 1 per level, flattening the late-game curve, and Fortification stacks at +5 defense each made small defensive investments extremely efficient.

### Decision

- Multiply all non-Artillery card base costs by 20:
  - Fortification 40, Command Post 80, War Academy 120, Jammer 160, Barracks 240.
- Artillery costs **1000** to build and **300 per level** to fire.
- Upgrade cost is now `base cost + 5 × projected current level` instead of `base cost + current level`. Shift-click five-level quotes use the same stepped formula.
- **Fortification** adds **+1 defense per stack** to friendly pixels in its district instead of +5.
- App 0.36.0; protocol remains 36 because no payload shape changed.

### Consequences

- Early expansion is much slower and the supply cap and War Academy economy matter more.
- Leveling is a steeper investment; repeated upgrades become expensive quickly.
- Fortification stacking is still useful but no longer dominates pixel defense.
- Artillery remains a late-game structure requiring a raised cap.

### Alternatives considered

- **Keep Artillery at 300 while scaling other cards:** it would be comparatively cheap after the ×20 pass, so the explicit 1000/300 override was kept.
- **+2 or +3 Fortification defense:** +1 matches the request and keeps pixel defense primary.

---

## ADR-040 — Horizontal supply bar with cost preview

**Status:** accepted and implemented in 0.37.0  
**Date:** 2026-11-21

### Context

The bottom-left economy panel duplicated map information in a cramped column and made it hard to see how close supply was to the cap. Click costs were only communicated after the click, through toasts.

### Decision

- Replace the supply/front/defense panel with a horizontal supply bar above the card hand.
- The bar fill is `supply / cap`; current supply is labelled on the left and max supply on the right, inline with the track. Income sits in the meta row.
- The bar sits just above the collapsed hand's peeking strip and uses a z-index below the card tray, so interacting with/raising the cards covers the bar.
- On map hover, derive the supply cost the click would spend:
  - valid frontier launch → launch cost,
  - owned district upgrade → one-level or Shift five-level quote,
  - artillery targeting → current volley cost.
- Draw that cost as a striped red segment over the existing fill and a `-cost` chip; show `NEED` when supply is insufficient.
- Move FIRE and CANCEL FRONT into the bar's action area. Front count and the old DEF readout are removed.
- App 0.37.0; protocol unchanged at 36.

### Consequences

- Supply pressure is readable at a glance and cost previews appear before committing.
- The bar is responsive: it slides above shrinking card hands at each breakpoint.
- Defense inspection is no longer in the HUD; pixel defense remains visible through gameplay markers/attacks and the underlying simulation.

### Alternatives considered

- **Keep a numeric panel beside the bar:** defeats the requested single-line HUD.
- **Show cost only after clicking:** no planning benefit.
- **Draw cost as a shrinking fill before commit:** visually ambiguous with current supply; the overlay segment preserves the actual fill.

---

## ADR-041 — Visual merging of touching same-type districts

**Status:** accepted and implemented in 0.38.0  
**Date:** 2026-11-21

### Context

The economy now encourages several same-type structures, and their adjacent Voronoi districts drew separate seams and icons. Players had to remember which structure was cheaper to level.

### Decision

- Touching districts owned by the same player with the same structure type form a visual/upgrade group.
- The territory shader removes internal seams and per-district fill variants by comparing the structure-type base code while an `u.mergeDistricts` uniform is 1. Ctrl sets it to 0 for the previous per-district look.
- The 2D overlay draws one combined icon at the mean structure centre with the summed stack badge for multi-structure groups.
- Clicking a merged district upgrades the lowest projected level first; five-level batches distribute across the lowest structures. Merged upgrade commands carry a pinned `structureId` so noisy Voronoi centre assignment cannot redirect an upgrade.
- **Ctrl** disables merging: seams/icons return and the clicked structure is upgraded directly.
- Group membership is computed by a union scan of the district map, cached for at most 5 ticks; stack totals refresh on each read. It is visual/upgrade convenience only, not checksum state.
- App 0.38.0; protocol unchanged at 36.

### Consequences

- Repeated structures read as one coherent district with one combined level.
- Spending is steered toward the weakest member without removing per-structure choice under Ctrl.
- The shader change needs only one uniform float; no extra texture or upload.
- Group membership can lag captures by up to half a second, while levels remain current.

### Alternatives considered

- **Permanently bake a shared district color code:** would require a texture rebuild to restore Ctrl.
- **Merge districts in simulation state:** would change auras, placement, and gameplay semantics.
- **Draw seams in the 2D overlay under Ctrl:** would need per-cell boundary rendering at every zoom; the shader toggle is cheaper and exact.

---

## ADR-042 — Remove the supply-income hard cap

**Status:** accepted and implemented in 0.38.1  
**Date:** 2026-11-21

### Context

`supplyIncomeFor` still returned `min(60, ...)`, a leftover from the early frontage model. It silently flattened Command Post and territory scaling once a player reached 60 supply/s, contradicting the no-hard-caps direction.

### Decision

- Delete `SUPPLY_INCOME_MAX` and return the computed income directly.
- Income is `3 + floor(territory / 10000) + 2 × Command Post stacks` per second with **no cap**.
- Add a regression test that reaches >60/s with forty Command Posts.
- App 0.38.1; protocol unchanged at 36.

### Consequences

- Command Post stacking and large territory keep paying off indefinitely.
- The supply stock cap still exists as a derived, uncapped ceiling formula; only the stock is clamped, not the rate.
- Existing balance can snowball faster; telemetry/front pressure remains the tuning lever rather than a silent income ceiling.

### Alternatives considered

- **Keep 60/s but show it in the HUD:** still a hard cap and contrary to the requirement.
- **Diminishing income above a threshold:** softer than a hard cap but would require a new non-linear formula and explicit design review.

---

## ADR-043 — Number-key card placement and right-click cancel

**Status:** accepted and implemented in 0.39.0  
**Date:** 2026-11-21

### Context

Building required an HTML drag from the hand. That is awkward with a mouse, unavailable to keyboard-first players, and card costs now make repeated placement common.

### Decision

- Keys `1`–`6` select the corresponding hand card and enter the existing placement state without a native drag.
- The selected card lifts/ghosts as during a drag; the curved arrow and landing-radius circle follow the pointer.
- A left-click on the map queues `playCard` at the clicked cell. On success placement clears; on failure it stays active for retry.
- Right-click cancels placement; the main shell calls `preventDefault` on `contextmenu`, removing the browser menu. Escape also cancels.
- Each card banner shows its number hotkey.
- App 0.39.0; protocol unchanged at 36 because build commands are unchanged.

### Consequences

- Placement is faster and fully keyboard-initiated.
- No browser context menu appears over the game.
- The existing native drag path is preserved; starting a real drag clears keyboard placement mode.

### Alternatives considered

- **Build immediately when a number is pressed:** impossible without a target cell; placement mode is required.
- **Use Enter/arrow-key cursor only:** the request explicitly asks for left-click building.
- **Suppress context menu with CSS only:** context menu is a browser default handled by JS.
