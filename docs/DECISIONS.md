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

---

## ADR-044 — Territory income: +1 supply/s per 1,000 owned pixels

**Status:** accepted and implemented in 0.40.0  
**Date:** 2026-11-21

### Context

Territory contributed only +1 supply/s per 10,000 pixels, while structure economies were stronger. That pushed play toward safe structure stacking and made aggressive expansion economically unattractive.

### Decision

- Change `SUPPLY_INCOME_TERRITORY_DIVISOR` from 10,000 to **1,000**.
- Supply income is now `3 + floor(territory / 1000) + 2 × Command Post stacks` per second.
- Add a regression test covering 999, 2,000, and 12,500 owned pixels.
- App 0.40.0; protocol unchanged at 36.

### Consequences

- Every 1,000 owned pixels grants +1/s, roughly matching the supply-cap growth rate from territory.
- Wide aggressive play gains income directly; structure-only play still gains from Command Posts.
- Expansion snowball is stronger; front pressure and attrition remain the counterweight.

### Alternatives considered

- **Keep 10,000 and add a separate occupation term:** would double-count territory and complicate telemetry.
- **Use a non-linear territory curve:** requires explicit diminishing-return design and more tuning data.

---

## ADR-045 — Utility-driven bot economy and target-aware attacks

**Status:** accepted and implemented in 0.41.0  
**Date:** 2026-11-21

### Context

Bots followed a fixed sorted `buildPlan`, then upgraded the lowest plan structure. A threatened bot was forced through Fortification → Barracks → cheaper defensive upgrade before anything else. Attacks fired when a flat aggression roll passed. Once a bot built its first three or four types, cheap affordable upgrades consumed every build interval, so it appeared to stop developing and only expand. This was hard-coded behavior, not emergent strategy.

### Decision

- Keep deterministic personality traits and derive a per-type `structureBias`; keep the sorted build plan only as a readable preference/display artifact.
- Score economic actions every build interval:
  - type affinity,
  - first-copy novelty and repeat-count penalty,
  - threat response, diluted by existing defensive stacks,
  - income and supply-cap pressure,
  - cost efficiency.
- Apply strategic behavior:
  - **Strategic reserve:** after two buildables, hold supply for the highest-affinity missing type.
  - **Cap bottleneck:** if that type costs more than the current cap, save for/prioritize the next War Academy level instead.
  - **Attack buffer:** attacks cannot consume the next economic purchase, except when expansion is required.
  - **Expansion pressure:** if no missing type has a legal site, attacks may draw on the economic reserve to unlock land.
  - Up to two non-defensive actions per interval; a threatened bot takes one emergency defensive action, which may use the defensive reserve.
- Replace attack attempt probability's flat aggression roll with a target-aware probability from target score, aggression, supply pressure, and reserves.
- Add a regression test that bots develop at least three structure types by tick 600.
- App 0.41.0; protocol unchanged at 36.

### Consequences

- Bot behavior is no longer a fixed sequence; the same bot can defend in one phase, save for a cap, expand when boxed in, and later build artillery.
- 3,000-tick telemetry shows all six buildable types, including artillery, with active fronts and eliminations.
- Early-game economy still favors cheap early structures because expensive types need cap growth; 600-tick runs may not show the full mix.
- Utility decisions use only integer state; profiles and utilities remain deterministic.

### Alternatives considered

- **Fully random action selection weighted by traits:** less legible and harder to balance than explicit utilities.
- **Keep the fixed build plan but add random interruptions:** still hard-coded and does not respond to cap/site/threat bottlenecks.
- **Give bots free supply/cap:** hides the structural problem and breaks the shared-rules model.

---

## ADR-046 — Upgrade step 15, Barracks cost +40, War Academy +80 cap, Command Post +1/s

**Status:** accepted and implemented in 0.42.0  
**Date:** 2026-11-21

### Context

Upgrades and Barracks levels were underpriced relative to their scaling, while Command Posts gave too much passive income and War Academies too little cap relief. The economy needed steeper level investment and a stronger cap-growth payoff.

### Decision

- `UPGRADE_LEVEL_COST_STEP` 5 → **15**. Upgrade cost is `base + 15 × projected current level`; shifted five-level quotes use the same step.
- `ATTACK_SUPPLY_COST_BONUS` 15 → **40**. Launch cost is `30 + 40 × effective Barracks levels`.
- War Academy supply cap per stack 40 → **80**. The current model has no separate attack cap; this is the supply cap that gates attacks.
- Command Post income 2 → **1 supply/s** per stack.
- App 0.42.0; protocol unchanged at 36.

### Consequences

- Leveling is a much steeper supply commitment; Tall builds need deliberate savings.
- Barracks now trade much more supply for attack strength, making them a real strategic cost.
- War Academy is a stronger answer to the expensive Barracks/Artillery cap bottleneck.
- Command Posts are supplementary rather than a dominant passive-income engine.

### Alternatives considered

- **Change only upgrade step:** would leave Barracks scaling too cheap.
- **Add a separate attack cap:** there is no such mechanic in the current model and it would be new scope.

---

## ADR-047 — Sharp district outlines and placement-type highlighting

**Status:** accepted and implemented in 0.43.0  
**Date:** 2026-11-21

### Context

Several structure-type district fills were close to terrain colors, and their boundaries were a subtle darker seam, so districts could disappear visually. During card placement there was also no indication of where the player's existing districts of that type were, making merges and upgrades hard to anticipate.

### Decision

- Replace the subtle district seam with a sharp high-contrast cream outline, using amber for highlighted matching districts. The outline uses the same shader control texture and adds no uploads.
- Add `highlightDistrict` (base district palette code) and `highlightOwner` uniforms. While a card is in placement mode, the active player's districts matching that structure type pulse with a warm fill wash and amber outline.
- The 2D canvas reports `draggingCard.type` to `GameCanvas`, which writes the uniform each frame.
- App 0.43.0; protocol unchanged at 36.

### Consequences

- Districts stay legible over similar terrain without changing fill strength.
- Placement mode clearly previews which existing same-type districts may be merged/upgraded.
- Ctrl merge-disabling and the merged-district outline behavior are unchanged.
- Uniform struct grows from 52 to 60 occupied bytes inside the existing 64-byte buffer.

### Alternatives considered

- **Post-process edge detection:** more expensive and would outline terrain/owner edges too.
- **2D overlay polygon outlines:** requires per-cell boundary tracing and misses screen-space zoom behavior.
- **Always highlight all types:** noisy; only the selected card's type is relevant.

---

## ADR-048 — Lower base attack strength and weaker Barracks strength scaling

**Status:** accepted and implemented in 0.44.0  
**Date:** 2026-11-21

### Context

A base front entered with 1,500 durable strength, and each Barracks level added another 450. This made fronts very long-lived and made Barracks the dominant way to buy combat endurance rather than a more measured offensive upgrade.

### Decision

- `ATTACK_STRENGTH_BASE` 1500 → **1000**.
- `ATTACK_STRENGTH_BONUS` 450 → **200** per effective Barracks level.
- Strength is now `1000 + 200 × effective levels`; launch cost remains `30 + 40 × levels`. Power, piercing, and all other formulas are unchanged.
- App 0.44.0; protocol unchanged at 36.

### Consequences

- Base fronts cover less ground and die faster in mirror contact.
- Barracks still adds strength, but at less than half the previous rate per level, so higher attack tiers are more about cost, power/piercing, and commitment than raw durability.
- Defensive terrain and Fortifications become comparatively stronger; cancellation refunds track the smaller strength pool.
- Existing direct fixture values in tests are unchanged where they represent arbitrary injected fronts; generated attack stats and economy assertions use the new values.

### Alternatives considered

- **Only lower the base:** would leave Barracks as the dominant durability purchase.
- **Only lower the bonus:** would preserve excessive unupgraded front endurance.

---

## ADR-049 — Rival supply banners scaled by state size

**Status:** accepted and implemented in 0.45.0  
**Date:** 2026-11-21

### Context

The only live supply readout was the human's hand bar. Rival savings were hidden, making it hard to judge which states could afford a launch, a Barracks push, or artillery. A flat label for all 50 rivals would be unreadable and would not communicate relative power.

### Decision

- Expose current `supply` on every `PublicPlayer` snapshot record (protocol 37).
- Draw a map-anchored banner at each living rival capital on the 2D overlay:
  - owner-colored border and name,
  - compact supply value using the existing formatter,
  - scale derived from `sqrt(territory / largestLivingRivalTerritory)` so larger states get larger banners,
  - smallest banners drawn first so larger ones win overlap,
  - viewport clamping with a stem back to the capital,
  - human and dead/zero-territory states excluded.
- Refresh from the existing 5 Hz HUD snapshot; no extra simulation work or per-tick DOM updates.
- App 0.45.0; protocol 37.

### Consequences

- Players can read rival economic pressure at a glance, and large states are visually dominant.
- 50 banners remain off the 10 Hz per-tick path and are culled by the camera.
- Banners can overlap in dense clusters; the largest are painted on top and labels stay attached to their capitals.
- No simulation or checksum behavior changes, but the wire snapshot shape changed.

### Alternatives considered

- **DOM banners:** 51 live elements and layout thrash; the canvas overlay is cheaper.
- **Flat-size labels:** does not satisfy the size-as-power requirement and becomes noisy.
- **Leaderboard-only supply column:** hides spatial context; the leaderboard stays territory/rank-focused.

---

## ADR-050 — Banner de-emphasis and removal of the last-action toast

**Status:** accepted and implemented in 0.46.0  
**Date:** 2026-11-21

### Context

The rival supply banners were opaque plaques with colored borders and minimum font sizes. At overview zoom a state's territory is only a few pixels wide, so those plaques were much larger than the state itself and obscured the map. The floating last-action toast also opened a box over the play area after every command.

### Decision

- Make supply banners transparent text with a text shadow and a faint owner-colored stem.
- Remove the plaque fill, border, and accent cap.
- Cap banner dimensions by an estimate of the state's on-screen footprint:
  - equivalent screen radius = `sqrt(territory / π) × camera.scale`,
  - width ≤ 1.05 × radius, height ≤ 0.75 × radius,
  - shrink to fit; hide when the resulting text would be illegible.
- Remove the floating last-action toast markup and styles. Existing `showToast` call sites are retained as a no-op feedback sink until inline HUD feedback replaces them.
- App 0.46.0; protocol unchanged at 37.

### Consequences

- Banners no longer cover the overview map; they appear only when zoomed enough for the state boundary to carry legible text.
- Larger states still get larger text when it fits.
- Runtime feedback is now carried by the map, HUD, and event feed without a center-screen box.
- No simulation, snapshot, or wire changes.

### Alternatives considered

- **Keep opaque plaques and just shrink them:** still occludes small states and retains the border the user rejected.
- **Remove banners entirely:** loses the rival-supply awareness feature.
- **Move toasts to a corner:** still a persistent last-action box; the request was to remove it.

---

## ADR-051 — War Academy base cost reduced to 60

**Status:** accepted and implemented in 0.47.0  
**Date:** 2026-11-21

### Context

War Academy cost 120 supply while providing +80 cap. The cap structure was meant to be an accessible economy choice, but its cost kept early bots and players from raising the cap before expensive Barracks/Artillery aspirations.

### Decision

- War Academy base cost 120 → **60**.
- Reorder `BUILDABLE_STRUCTURE_TYPES` by ascending cost: Fortification 40, War Academy 60, Command Post 80, Jammer 160, Barracks 240, Artillery 1000. The permanent hand and number-key shortcuts follow this sorted order.
- App 0.47.0; protocol unchanged at 37.

### Consequences

- Cap growth is available at half the previous price, making War Academy a realistic early economic pick.
- Bot strategic reserves and cap-bottleneck priorities automatically use the new definition cost.
- Hand ordering changes: `2` is War Academy and `3` is Command Post.
- No wire or simulation-format changes; existing saved matches recompute from structure definitions.

### Alternatives considered

- **Lower cap bonus instead:** would weaken the intended payoff rather than improving access.
- **Keep display order fixed:** would break the established ascending-cost hand; reordering is cheaper and keeps shortcuts predictable.

---

## ADR-052 — Remove the edge pan clamp

**Status:** accepted and implemented in 0.48.0  
**Date:** 2026-11-21

### Context

`MapCamera.clamp()` forced the viewport to stay inside the map. States near a map edge could therefore not be moved away from fixed HUD panels, especially the leaderboard and hand, even when the player wanted to interact with them.

### Decision

- Remove camera bounds clamping from `setViewport`, `centerOn`, `panBy`, `zoomAt`, and `setZoom`.
- The camera may overscroll beyond the map; outside-map space renders through the existing ocean/void shader path.
- Keep zoom clamped to the existing 0.82×–18× range.
- Add camera unit tests for centering an edge point and panning past the edge.
- App 0.48.0; protocol unchanged at 37.

### Consequences

- Edge states can be dragged into the viewport center, clear of HUD occlusion.
- Players can pan the map partly or fully out of view; this is intentional, not a bug.
- Fit/resize no longer snaps the map back to center; the current center is preserved.
- No simulation or wire changes.

### Alternatives considered

- **Overscroll only half a viewport:** still limits how far an edge state can escape wide HUD panels.
- **UI-aware camera padding:** helps some panels but does not let the player choose a comfortable composition and adds coupling.

---

## ADR-053 — Common early supply ramp and least-defense attack ground

**Status:** accepted and implemented in 0.49.0  
**Date:** 2026-11-21

### Context

Bots branched immediately into personality-driven structures, so many skipped the supply economy and could not afford later Barracks/Artillery pushes. Attack target choice scored the defender but not the contact cell, so bots could repeatedly open fronts into fortified or elevated ground.

### Decision

- Add a shared opening strategy for every bot:
  - alternate Command Posts and War Academies until each has `BOT_EARLY_ECONOMY_PER_TYPE` (2) stacks, or until `BOT_EARLY_ECONOMY_TICK_LIMIT`,
  - give the next early economy structure a dominant utility score (`BOT_EARLY_ECONOMY_UTILITY`),
  - keep a capped early reserve (`BOT_EARLY_ECONOMY_RESERVE_MAX`) so attacks do not drain the next economy purchase,
  - restrict attack targeting to neutral expansion during the ramp, falling back to hostile borders only when neutral ground is blocked.
- Add `BOT_ATTACK_DEFENSE_WEIGHT`: candidate contact cells are scored as target utility minus `weight × pixel defense`. The unpenalized target score still drives attack chance.
- Add assertions that midgame bots build both Command Posts and War Academies and retain ≥3 structure types.
- App 0.49.0; protocol unchanged at 37.

### Consequences

- Bot openings are more consistent and economy-focused; personality still controls the post-opening build mix.
- Early state wars are delayed while neutral expansion exists, reducing pointless opening attrition.
- Bots prefer cheap contact ground on valuable targets instead of fortifications/high ground.
- Early forts still appear when utility or active threat warrants them; this is not a hard build order.
- No wire changes; deterministic behavior remains hash-based.

### Alternatives considered

- **Forced fixed CP/WA build order:** too rigid and ignores threat/site constraints.
- **No early reserve:** attack spending overwhelms the ramp.
- **Defense-only target scoring:** would make bots ignore valuable grudge targets.

---

## ADR-054 — Match setup, configurable worlds, balance sweep, and soak test

**Status:** accepted and implemented in 0.50.0  
**Date:** 2026-11-21

### Context

The 51-state, 2048×1024 configuration was a stress-test setting, not a selectable match format. Balance checks relied on a small telemetry sample, and there was no long-run resource/invariant soak test.

### Decision

- Add a match-setup panel to the intro:
  - state count 8/16/24/32/51,
  - map presets standard/compact/clash,
  - bot difficulty relaxed/standard/ruthless,
  - growth layer,
  - optional 10/20/30-minute timer,
  - saved defaults in localStorage.
- Generalize `generateMap` and `TerritorySimulation` with `playerCount`, `width`, `height`, `botDifficulty`, and `matchDurationTicks`. Defaults preserve the original 51-state 2048×1024 behavior.
- Bot difficulty adjusts economy action count and attack frequency; it does not change rules or income.
- At timer expiry, the largest living state wins (lowest id breaks ties).
- Add `scripts/balance-sweep.ts` (`pnpm balance`) for personality win rates, early-ramp completion, structure mix, front/elimination pace, and match-length distribution across seeds.
- Add `scripts/soak.ts` (`pnpm soak`) for a 10k-tick deterministic long run with invariant validation and RSS/checksum sampling, plus a short determinism replay check.
- Keep replay/post-match analysis, accessibility/mobile validation, and diplomacy/team AI as explicit TODO items.
- App 0.50.0; protocol unchanged at 37.

### Consequences

- The game has selectable match formats without changing default deterministic output.
- Configurable maps increase memory proportional to width×height; the renderer already allocates from simulation dimensions.
- Match setup persists locally; URL seed remains shareable and independent.
- Balance and soak checks are repeatable developer commands.
- No wire changes yet; an online lobby will need to carry the same match configuration.

### Alternatives considered

- **Keep only the 51-state stress format:** simplest, but leaves no usable shipping match flow.
- **Select states by hiding players on a fixed 51-start map:** changes map density and wastes unused starts.
- **Global difficulty tuning in constants:** a setup option is explicit and replayable per match.

---

## ADR-055 — Territory supply income reduced to +1 per 3,000 pixels

**Status:** accepted and implemented in 0.51.0  
**Date:** 2026-11-21

### Context

Land-based supply income at +1/s per 1,000 owned pixels made territory growth too rewarding by itself, letting large states outscale structure-based economy and flattening build choices.

### Decision

- `SUPPLY_INCOME_TERRITORY_DIVISOR` 1,000 → **3,000**.
- Income becomes `3 + floor(territory/3000) + Command Post stacks` per second. Cap growth remains `120 + territory/1000 + 80 × War Academy stacks`.
- Update the income test boundaries to 2,999/6,000/12,500 pixels.
- App 0.51.0; protocol unchanged at 37.

### Consequences

- Territory still raises income without a hard cap, but three times more land is needed per +1/s.
- Command Posts and early economy structures matter more relative to passive land income.
- Large empires grow more slowly without supply infrastructure.
- Bot economy balance and balance-sweep results should be re-checked; no wire or snapshot shape changes.

### Alternatives considered

- **Lower base income instead:** reduces everyone equally and does not address the land-scaling problem.
- **Cap land income:** violates the uncapped-growth design.

---

## ADR-056 — Attacks keep half of aspiration savings

**Status:** accepted and implemented in 0.52.0  
**Date:** 2026-11-21

### Context

Bots reserved the full cost of their next aspiration plus the full next-purchase buffer before attacking. At tick 6,000 in seed 1234, 23 of 50 living bots had a valid target but were blocked by these reserves, and only 2 were attack-ready. With land income reduced to +1 per 3,000 pixels, filling a 1,000-supply Artillery aspiration took even longer, so territory and front growth froze.

### Decision

- Before an attack, keep at most `max(60, floor(currentSupply × 0.5))` for the aspiration.
- Cap the next-purchase buffer at 40 for the attack gate.
- Use `max(strategicReserve, economicBuffer)` instead of summing both.
- Economy spending still uses the full aspiration reserve, so builds are not weakened.
- Add a 3,000-tick regression test requiring active expansion and at least one elimination.
- App 0.52.0; protocol unchanged at 37.

### Consequences

- Seed 1234 at tick 6,000 after the fix: 16 fronts vs 6, average territory 20,076 vs 9,099, 30 alive vs 46. Bots expand and eliminate each other instead of hoarding.
- Bots can delay an expensive aspiration under pressure but cannot freeze permanently.
- Attack spending may slow aspiration progress; that is the intended trade-off for steady map growth.

### Alternatives considered

- **Remove reserves entirely:** expensive structures would never be reached.
- **Only cap the absolute reserve:** still blocks low-income bots for long periods.
- **Force attacks on a timer:** less adaptive than a supply-share rule.

---

## ADR-057 — Generated rules reference and narrowed documentation policy

**Status:** accepted and implemented in 0.52.0  
**Date:** 2026-11-21

### Context

Value and formula changes required manual edits across README, SPEC, ARCHITECTURE, COMBAT_DESIGN, DETERMINISM, AGENTS, and generated-looking tables. The duplication caused drift and made minor balance changes expensive.

### Decision

- Code and tests are the source of truth for constants, structure definitions, formulas, and match presets.
- Add `scripts/docs-reference.ts` and `docs/REFERENCE.md` with six `AUTOGEN` sections: version, constants, economy, structures, formulas, match.
- Add `pnpm docs:reference` (write) and `pnpm docs:check` (CI drift check).
- Documentation policy:
  - SPEC owns intent and player-facing semantics.
  - ARCHITECTURE owns boundaries.
  - DECISIONS is append-only.
  - README/AGENTS link to REFERENCE instead of copying numeric tables.
  - Historical ADRs are never retro-edited.
- App 0.52.0.

### Consequences

- Most value changes require only a source change and `pnpm docs:reference`.
- CI fails when generated docs drift.
- Human prose still changes for genuinely new behavior, but no longer for every number.

---

## ADR-058 — Shore Ports and naval landings

**Status:** accepted and implemented in 0.53.0  
**Date:** 2026-11-21

### Context

The map is mostly ocean, but all attacks were land-frontier attacks. Coastal states had no way to project power across water or establish sea-linked territory.

### Decision

- Add a seventh card, **Port**, cost 200, no district, buildable only on owned shoreline.
- Static sea components and deterministic 4-neighbour A* live in `naval.ts`.
- With a friendly Port, clicking a non-friendly, unoccupied shore with a sea route queues a naval landing:
  - launch cost = normal front launch + 60 supply,
  - route follows shortest ocean path at 80 map px/s,
  - on arrival, claim the beachhead, auto-build a Port there, and open a normal front inward,
  - invalid targets cancel the landing at arrival.
- Snapshot adds `navalLandings` with route and progress; checksums include landing state.
- Port annexation protection: a Port anchors its friendly land component if it reaches the owner's State, or shares a sea component with another same-owner Port that does.
- Protocol 38; generated REFERENCE includes Port/naval constants.

### Consequences

- Players can open a second front across water and persist it with a free landing Port.
- Sea components make "has sea path" cheap to test; A* only runs when a landing is requested.
- Bots may build Ports through normal utility scoring but do not yet plan naval campaigns.
- Port has no district, so no card-upgrade loop and no district UI conflict.

---

## ADR-059 — Naval landing pays the Port cost up front

**Status:** accepted and implemented in 0.54.0  
**Date:** 2026-11-21

### Context

The first naval implementation charged a fixed 60-supply surcharge and auto-built the landing Port for free on arrival. That made the automatic Port effectively free and decoupled the landing cost from the Port's actual 200-supply card cost.

### Decision

- Remove `NAVAL_LANDING_SURCHARGE`.
- A naval landing costs **normal front launch cost + Port cost (200)** at launch.
- The auto-built landing Port remains free at arrival because its cost was paid up front.
- Add a regression assertion that the private naval cost equals `attackStats.cost + STRUCTURE_DEFINITIONS.port.cost`.
- App 0.54.0; protocol unchanged at 38.

### Consequences

- Naval attacks are a materially larger supply commitment.
- The upfront cost covers the Port that will exist after landing.
- No wire or snapshot shape change.

---

## ADR-060 — Bots value income, deter stronger neighbours, and exploit low supply

**Status:** accepted and implemented in 0.54.0  
**Date:** 2026-11-21

### Context

Bots defended reactively, under-invested in supply, and evaluated stronger opponents only through caution/conciliation penalties. A stronger neighbour with no supply was still treated like any other threat, and a bot behind on income kept attacking instead of repairing its economy.

### Decision

- Add per-bot neighbour comparisons at every decision tick:
  - income gap = strongest bordering neighbour income minus own income;
  - deterrence = strength advantage of the strongest bordering neighbour, in strength/100 units.
- Income gap raises Command Post and War Academy utility, raises their copy/level limits, and reduces attack chance.
- Deterrence raises Fortification utility, desired copies/levels, and adds up to 10 threat, so a stronger neighbour can trigger defensive posture before an attack.
- Threatened bots reserve up to 60 supply, place Fortifications on the border cell with the most hostile contact, and prioritize Fortification upgrades over unrelated plan steps.
- A stronger neighbour below 25% supply, or below its counterattack cost, is a supply opportunity: reduce caution/conciliation, add target-score and attack-chance bonuses.
- Add regression tests for neighbour gaps, income/deterrence economic choices, and low-supply opportunity scoring.

### Consequences

- Bots build more Fortifications, Command Posts, and War Academies and fewer fronts.
- Deterministic telemetry and checksum coverage include the new income-gap and deterrence fields.
- No wire-shape change; protocol remains 38.

---

## ADR-061 — Evolutionary AI sandbox and genome buckets

**Status:** accepted and implemented in 0.54.0  
**Date:** 2026-11-21

### Context

Bot behavior was hand-tuned through constants and personality hashes. Improving the AI required guessing which parameter combinations were better, and there was no repeatable way to compare many AI policies or feed successful ones back into matches.

### Decision

- Represent bot policy as a **genome**: eight personality traits, per-type structure affinities, and six modular behavior weights (income, defense, deterrence, opportunity, expansion, retaliation).
- Module weights are neutral at 50. Default bots use 50 everywhere, so existing behavior is unchanged; evolved genomes scale the relevant bonus up or down.
- Run deterministic all-bot matches. Fitness averages land share, final income, live attack strength, wins, and survival. Prune the bottom half, retain elites, and reproduce with seeded crossover + mutation.
- Sort final genomes into poor/good/top buckets. Difficulty maps relaxed→poor, standard→good, ruthless→top. Buckets persist in localStorage and are passed into normal matches.
- Provide a CSV spreadsheet as the interchange format: export includes traits, modules, affinities, bucket, and performance; import validates and reconstructs genomes.
- Provide both a headless CLI (`pnpm evolution`) and an in-client WebGPU spectator at `/evolution` with 1×/4×/16×/48× fast-forward. Both use the same `EvolutionSandbox`.

### Consequences

- AI tuning becomes empirical and reproducible; successful genomes can directly populate difficulty buckets.
- All-bot simulations add an option that makes the human seat a bot; normal matches are unaffected when no genomes are supplied.
- Evolution behavior is deterministic and covered by tests for genome mutation/crossover, selection, buckets, CSV round-trip, and genome-derived profiles.
- The spreadsheet is not a binary .xlsx workbook; CSV is used so the client can import it with no extra dependency.

---

## ADR-062 — AI behavior telemetry, naval strategy, teams, and release hygiene

**Status:** accepted and implemented in 0.55.0  
**Date:** 2026-11-21

### Context

The new economy/deterrence/opportunity AI needed measurement before tuning, bots still ignored Ports for offense, documentation duplicated card costs, version strings were manually copied, and several product-backlog items were still deferred.

### Decision

- Add non-gameplay `BotBehaviorTelemetry` counters for threatened Fortifications, deterrence postures, income-gap economy, supply opportunities, bot Ports, and landings. Expose them through telemetry, post-match analysis, and the result modal.
- Add `pnpm ai:balance` for an 8-seed × 6,000-tick matrix across standard/ruthless and organic/circular, including elimination variance, average match length, front activity, Fortification coverage, economy investment, and behavior counters.
- Add deterministic bot naval planning: coastal opportunity scoring, Port builds, sea-connected target validation, low-supply/low-defense preference, and a minimum-score/supply gate.
- Add optional coordinated teams. Teammates never target each other and gain a coordination bonus when joining an ally's target. The Evolution Lab exposes team count.
- Add post-match analysis/seed replay and copy-seed controls.
- Remove duplicated card-cost tables from README/AGENTS/COMBAT/SPEC; generated REFERENCE owns costs.
- Inject the app version into the UI footer from `package.json`; remove manual app-version prose.
- Batch the AI, naval, evolution, replay, accessibility, and team work into 0.55.0.

### Consequences

- AI tuning is measurable and repeatable; failed thresholds can be tuned against saved matrix reports.
- Bots can project power over water without wasting Port-cost-inclusive landings on poor targets.
- Team games are available in the Evolution Lab without changing free-for-all defaults.
- Future card-cost changes require code, tests, and generated REFERENCE only.

---

## ADR-063 — Strategic options, blackboard, and quality-diversity evolution

**Status:** accepted and implemented in 0.56.0 (follow-up to ADR-062)  
**Date:** 2026-11-21

### Context

The tactical utility layer produced context-sensitive decisions, but bots had no explicit committed intent, no lasting opponent memory, and evolution selected mainly on aggregate fitness. The game-AI literature points to hierarchical/temporal abstraction, blackboards/opponent models, and quality-diversity archives for more expressive strategy.

### Decision

- Add a committed **strategic option layer**: supply ramp, fortify front, expand, naval opportunity, exploit weakness, coalition strike, conserve. Options are selected on decision ticks, last 50–90 ticks, and require a utility margin to switch.
- Options bias the existing tactical utility layer (economy, reserve, target score, attack chance, naval behavior) rather than replacing it.
- Add blackboard memory for the last attacker, option target, neighbour income/strength signals, and ally targets.
- Add per-player behavior metrics for evolution: attacks, supported attacks, Fortifications, economy buildings, Ports, and landings.
- Expand fitness with economy/defense/naval/aggression/cooperation components.
- Add a MAP-Elites-style archive keyed by `E/D/N/A` strategy descriptors; one elite per descriptor survives alongside top-fitness genomes.
- Update CSV, spectator table, post-match analysis, and telemetry to expose descriptors, option usage, and per-player behavior.

### Consequences

- Bots pursue coherent short-horizon plans while remaining reactive; options are checksummed deterministic state.
- Evolution optimizes both outcome and behavioral diversity, reducing collapse to one dominant strategy.
- Reward metrics now favor multiple viable archetypes, not just land grabbing.
- The option set is intentionally small and symbolic; richer HTN/GOAP planning and dynamic diplomacy remain future work.

---

## ADR-064 — Mirrored lineage duels for 1v1 evolution

**Status:** accepted and implemented in 0.57.0  
**Date:** 2026-11-21

### Context

The lab originally scored each generation in mixed schedules and then kept the top half by aggregate fitness. That is a valid population-selection scheme, but in 1v1 it does not directly test the mutation hypothesis: a child can be carried by a favourable opponent draw instead of proving it beats its ancestor, and an ancestor can persist only because it is in a different descriptor niche.

### Decision

- In 1v1 with lineage duels enabled, every current genome plays one parent in same-seed, seat-swapped matches.
- The summed fitness margin across same-seed, seat-swapped fights is the lineage result: positive promotes the genome, negative prevents it from entering the survivor pool and from creating a new QD archive slot.
- Each unordered ancestor/descendant pair is scheduled once per pass; the parent may still be in the live population as a QD elite, but the pair is not duplicated in both directions.
- The generation still keeps the top half of eligible genomes plus QD elites; a zero margin is neutral and falls back to ordinary fitness.
- `matchesPerRound` controls the number of mirrored passes (two matches per pass); lineage results are shown as `LIN W-L` and included in CSV.
- Initial/imported genomes without a known ancestor use a deterministic mirror pairing until the first mutation generation.

### Consequences

- Beneficial mutations are tested against their immediate ancestor, not only against the population average.
- Direct losers are culled even if their absolute fitness looks acceptable; QD diversity is not allowed to rescue a genome that loses its lineage duel.
- Same-seed mirroring removes map variance but not seat asymmetry, so a single split is treated as a draw.
- This is still short-horizon incremental selection, not full coevolution or open-ended search; multi-parent crossover records one parent as the duel ancestor.

---

## ADR-065 — Explicit two-character Duel Lab

**Status:** accepted and implemented in 0.58.0  
**Date:** 2026-11-21

### Context

The population lab's 1v1 lineage mode was still a population algorithm with genome lists and culling. It was not a clear two-character experiment, and farthest-point starts often let two bots expand in isolation without contact.

### Decision

- Add a separate `/duel` mode built around exactly two persistent named characters. Both remain for the entire run; there is no culling.
- Characters alternate seats every round to split any seat/spawn advantage.
- Both starts are chosen within the central ~32% of the map, at a bounded separation, and on the same land component so interaction is possible.
- Every configurable block of rounds, the character with the lower block fitness must mutate. Ties fall back to block wins, then lifetime average fitness.
- Represent versions as a mutation graph with parent edges, a round log, and a mutation strip. The graph is the primary output instead of a genome table.
- Population evolution remains at `/evolution`; its removed 1v1 preset links to the explicit Duel Lab.

### Consequences

- The mode answers a clean question: does a mutation of one named character improve against the other?
- No benefit is extracted from culling; both lineages stay available and only the weaker side changes after each block.
- Close centre spawns make contact likely, but do not force an artificial attack before the bots' normal economy/opening rules would allow one.
- The lab is still local and deterministic; it does not introduce online play or full coevolution.

---

## ADR-066 — User-tunable evolution fitness weights

**Status:** accepted and implemented in 0.59.0  
**Date:** 2026-11-21

### Context

Evolution fitness had all reward scales hardcoded, with land at 120,000. That made territorial score dominate the other terms and gave users no way to test whether the aggressive phenotype was caused by the weighting or by the simulation/AI.

### Decision

- Define a shared `FitnessWeights` object for land, income, attack, win, survival, economy, defense, naval, aggression, and cooperation.
- Use it as the single source for population evolution, Duel Lab block fitness, and headless evolution.
- Lower the default land weight from 120,000 to **60,000**; leave other defaults unchanged.
- Expose editable inputs in both labs, a reset control, and `--weight-<name>` flags for `pnpm evolution`.
- Clamp weights to finite non-negative values and cap them at 10,000,000.

### Consequences

- The reward function is an explicit experimental surface rather than a hidden constant.
- Users can test whether a strategy is selected because of the simulation or because land/win scale swamped the rest.
- Changing weights changes ranking and mutation choice but remains deterministic for a fixed configuration.
- The default shift alone did not remove the aggressive-phenotype concentration in the audit; further reward design is still a balance task.

---

## ADR-067 — Attack and defense reward terms

**Status:** accepted and implemented in 0.60.0  
**Date:** 2026-11-21

### Context

Fitness rewarded land, income, raw attack strength, wins, and strategic activity, but it did not distinguish successful aggression (erasing a state, attacking a materially weaker one) from unsuccessful aggression, nor successful defense (repelling a front, making an attack expensive). That made a defensive phenotype invisible unless it won the map, and rewarded raw attack launches regardless of outcome.

### Decision

- Track per-player `statesEliminated`, `attacksVsWeakerStates`, `attacksRepelled`, and `defenseDamage`.
- Credit elimination to the last player who captured the eliminated state's land.
- Count a launch as a weak-state attack when the defender is at least 15% weaker in estimated strength or 40% lower in supply than the attacker.
- Credit a repel when an attacking front stalls out or dies against the defender, and count durable strength spent against defended cells as defense damage.
- Add four explicit fitness weights: eliminations (20,000), weak-state attacks (25), repelled attacks (1,000), and defense damage (0.1).
- Zero all four combat/defense terms if the scored state is dead at snapshot time, so a zero-land corpse cannot outrank survivors by absorbing damage.
- Expose the new terms in both lab weight editors and through `--weight-eliminations`, `--weight-weakAttacks`, `--weight-defenseStops`, and `--weight-defenseDamage`.

### Consequences

- Successful aggression and successful defense now have direct fitness value independent of a match win.
- Defense can score without requiring capture, but the weights are deliberately conservative and live is required.
- A defeated state still earns no combat/defense bonus, preserving survival as a gate.
- The weights remain user-tunable; defaults are initial, not final balance values.

---

## ADR-068 — Semi-Markov controllers as qualitative genome v2

**Status:** accepted and implemented in 0.61.0  
**Date:** 2026-11-21

### Context

Genome v1 was a fixed 21-scalar vector. Threshold effects could produce different archetypes, but evolution could not add, remove, or rewire a behavior. A pure Markov chain would also be too weak: with no observation input it degenerates into a random mode oscillator, and without dwell time it can flip-flop every decision tick.

### Decision

- Add an optional **observation-conditioned semi-Markov controller** to genome v2.
- The controller has 2–6 states. Each state selects one strategic option, carries per-state economy/attack/defense/naval/conserve biases, and has a minimum dwell time.
- Transitions are conditioned on existing observations (threat, income gap, supply ratio, weak neighbour, ally pressure) with a deterministic chance roll.
- Structural mutation can add/remove states, add/remove transitions, retarget states, and mutate constraints. Crossover aligns states by option label rather than raw index.
- `normalizeMarkov` repairs invalid graphs: bounded state count, valid options, reachable states, and at least one outgoing edge per state.
- Controllers drive the strategic-option layer directly; genomes without a controller keep the existing utility-argmax layer.
- Controller runtime state, dwell entry, and biases are checksummed. Transition rolls use `hash32`, not shared mutable RNG.
- The CSV stores the controller as a JSON column; the Evolution Lab shows state count.

### Consequences

- Evolution can now add/remove/rewire strategic structure, not only tune numbers.
- Behavior remains deterministic and inspectable, though probabilistic transitions add match variance.
- Initial genomes contain random controllers, so the first generations explore genuinely different state graphs.
- Pure utility-argmax behavior remains fully supported for legacy/v1 genomes.

---

## ADR-069 — Resumable Evolution Lab with linked genome inspection

**Status:** accepted and implemented in 0.62.0  
**Date:** 2026-11-21

### Context

The Evolution Lab only started fresh runs, placed controls in the scrolling page flow, and showed results below the canvas. That made the lab awkward as an inspection tool: the canvas did not own the screen, a finished run could not be extended, and a genome could not be linked to its occupation on the map.

### Decision

- Add `EvolutionSandbox.continueEvolution()`: a finished run extends its generation budget and breeds the next generation from its final rows plus the existing QD archive.
- Rename the primary action to `NEW EVOLUTION`; add `CONTINUE EVOLUTION` to resume a paused match, advance a completed generation, or extend a finished run.
- Pin both actions at the top of a scrollable right-side context window.
- Make the canvas fill the remaining left area and move setup, weights, spreadsheet, and bucket panels into collapsible `<details>` panels.
- Put the compact genome spreadsheet in the context window.
- Add bidirectional selection: spreadsheet rows select a genome and highlight its current-match occupation; clicking an occupied canvas cell selects that genome.
- Draw the selected genome's Markov state graph, with the live state highlighted when it is in the active match.
- Expose selected owner id and selection callbacks from `GameCanvas`.

### Consequences

- The lab is usable as a persistent experiment workspace instead of a single-shot setup page.
- Continue is in-memory for the current session; a page reload still starts with no resumable run.
- Canvas selection is only meaningful for genomes in the current match; selecting a retired genome still shows its graph in the spreadsheet.

---

## ADR-070 — Evolution Lab simulation worker

**Status:** accepted and implemented in 0.63.0  
**Date:** 2026-11-22

### Context

The Evolution Lab drove `EvolutionSandbox` and `TerritorySimulation` directly from the Svelte page. Fast-forward therefore blocked the main thread, delaying pan, zoom, speed changes, setup edits, and selection. Reducing renderer work was not enough because simulation stepping itself was the blocker.

### Decision

- Move the Evolution Lab sandbox, match scheduling, scoring, mutation, and simulation stepping into a dedicated Web Worker (`evolution.worker.ts`).
- The worker steps under an 8 ms per-turn budget and posts:
  - compact packed owner changes and district palette tiles,
  - full owner/district arrays only after an overflow,
  - a plain snapshot for overlays and HUD,
  - generation/report state at match and generation boundaries.
- The main thread keeps a read-only `RemoteEvolutionSimulation` mirror for the WebGPU renderer, camera, hover readout, structure overlay, and selection.
- `GameCanvas` gains a remote mode that does not step the simulation; it applies posted deltas and renders.
- Speed, pause/resume, start, continue, CSV import, and bucket populations are worker commands.
- Visual cadence is roughly 60 Hz below 1000× and every 1000 ticks at 1000×.

### Consequences

- Pan, zoom, speed switching, and setup edits stay responsive while simulation runs.
- Determinism is preserved because the same simulation code runs with the same seeds and ordered worker messages; wall-clock timing only controls how many steps happen per turn, not their sequence.
- The main thread no longer has direct access to the live simulation; any new renderer-visible state must be added to the worker payload/mirror.
- Worker startup and message ordering become part of the lab boundary and must be verified in a browser.

---

## ADR-071 — Cached build sites, spatial structure queries, ownership-gated integrity

**Status:** accepted and implemented in 0.65.0  
**Date:** 2026-11-22

### Context

CPU profiles of the Evolution Lab worker showed `findBotBuildCell`,
`TerritoryIntegrity.labelComponents`, and `cleanupUnclaimedPockets` dominating
simulation time. Build-site availability was recomputed repeatedly within one
tick, structure-spacing checks scanned every structure per candidate, and both
full-map integrity passes ran on fixed timers even when ownership had not
changed.

### Decision

- Cache build-site results per player/type for the current tick. Invalidate the
  cache whenever the structure registry version or layout version changes.
- Cache `botNeedsExpansion` per player for the same validity window.
- Index structure spacing queries in 32 px buckets inside `StructureRegistry`.
  `hasWithinRadius` examines only overlapping buckets, preserving the exact
  distance predicate.
- Run annex component labeling only when ownership changed since the previous
  scan or a State/Port destruction requested it.
- Run full-map pocket cleanup only when ownership changed since the previous
  cleanup.
- Keep initial one-shot scans so startup behavior is preserved.

### Consequences

- Active-match profile time improved by roughly 12–13% in A/B runs with
  identical behavior.
- Idle/no-ownership-change tick time dropped by roughly 91% because the
  full-map scans are skipped.
- The build-site cache and spatial index are derived state; they are excluded
  from checksums. Ownership-change flags are deterministic and included in the
  checksum.
- Future changes to structure placement or protected-anchor rules must remember
  to invalidate or schedule these caches/scans.

---

## ADR-072 — Locality-banded least-resistance selection

**Status:** accepted and implemented in 0.66.0  
**Date:** 2026-11-22

### Context

The least-resistance sampler compared the cheapest defense among the ten
highest-priority frontier cells. With organic and large frontiers, that could
pull a front sideways onto a weak pixel far from the attack's original contact
area. The result was structurally aggressive, snake-like fronts that chased
defense gradients instead of growing around the clicked area.

### Decision

- Keep sampling the fixed top ten frontier candidates in growth order.
- For each valid sample, compute Manhattan distance from the attack's border
  anchor.
- Only candidates within `LEAST_RESISTANCE_LOCALITY_BAND` (8 px) of the
  nearest sampled cell remain eligible.
- Within that band, choose the cheapest integer effective defense; ties keep
  sample order.
- Requeue semantics and affordability checks are unchanged.

### Consequences

- Defense still chooses the cheaper lane around nearby strongpoints.
- Distant weak pixels no longer divert a front away from its start area.
- A front can stall against a large strongpoint rather than flowing far around
  it; that is intentional locality.
- Behavior is deterministic and uses no new RNG. The new constant is part of
  simulation behavior and should be included in future balance reviews.

---

## ADR-073 — Remove the 1000× render decimation rule

**Status:** accepted and implemented in 0.66.1  
**Date:** 2026-11-22

### Context

ADR-069/0.62.1 throttled local fast-forward rendering to one control-texture
resync per 1000 simulation ticks at `1000×`, because applying every tick's
renderer delta blocked the main thread. The Evolution Lab later moved its
simulation loop to a worker, so that local path is no longer the lab's
bottleneck. The worker still carried an analogous visual cadence that only
posted once per 1000 ticks at `1000×`, making the map visibly choppy.

### Decision

- Remove the `renderStride` / `lastSyncedTick` special case from
  `GameCanvas`; local simulation applies every tick's renderer delta again.
- Remove the worker's `1000×` visual stride. The worker posts visual updates
  at the normal ~60 Hz cadence at every speed.
- Keep the renderer's `syncFromSimulation()` full-resync path for overflow
  recovery and remote initialisation.

### Consequences

- Duel Lab and any other local fast-forward path render every simulation tick
  again; this is the pre-0.62.1 behavior.
- The Evolution Lab continues to benefit from worker separation and 60 Hz
  visual updates at 1000×; worker transfer volume rises, which is acceptable
  for the lab.

---

## ADR-074 — Revert locality-banded least resistance

**Status:** accepted and implemented in 0.66.2  
**Date:** 2026-11-22

### Context

ADR-072 restricted least-resistance choices to an 8-pixel Manhattan band around
the nearest sampled cell. The intent was to stop organic fronts drifting away
from their start area, but the hard Manhattan gate made organic growth break
into diamond-shaped lobes and lose its irregular character.

### Decision

- Remove `LEAST_RESISTANCE_LOCALITY_BAND` and the selector helper.
- Restore the previous behavior: sample the top ten candidates in growth order
  and capture the integer-cheapest effective defense, with sample-order ties.
- Keep all other attack rules unchanged, including requeueing, affordability,
  clash handling, and anchor-based growth.

### Consequences

- Organic growth returns to its irregular, non-diamond shape.
- Least resistance can again choose a weakly defended lane anywhere inside the
  sampled growth window.
- ADR-072 is superseded; the locality experiment should not be reintroduced
  without a non-Manhattan-friendly approach and fresh visual/balance evidence.

---

## ADR-075 — Remove the Duel Lab

**Status:** accepted and implemented in 0.67.0  
**Date:** 2026-11-22

### Context

The Duel Lab duplicated the Evolution Lab's simulation, rendering, mutation
graph, and fitness machinery to support a two-character 1v1 mode. Population
evolution already supports 2-player ancestry duels, and maintaining a second
execution path increased UI, determinism, and performance surface area.

### Decision

- Remove the `/duel` route, `ai/duel.ts`, its tests, and the main-thread Duel
  simulation loop.
- Remove the Duel-specific `duelStarts` simulation option and mirrored-map/start
  preparation.
- Keep lineage duels inside Evolution Lab as a 1v1 selection mechanism.
- Historical ADRs mentioning the removed lab remain as design history.

### Consequences

- One simulation/render/evolution path remains.
- The Duel Lab mutation graph, character naming, and block-mutation UI are gone.
- 1v1 experimentation continues through Evolution Lab lineage mode and CSV
  imports.

---

## ADR-076 — IndexedDB session checkpoints for the Evolution Lab

**Status:** accepted and implemented in 0.67.0  
**Date:** 2026-11-22

### Context

Continue Evolution only worked while the page remained open. Reloading lost the
population, archive, reports, and generation budget.

### Decision

- Capture a serializable checkpoint when a generation reaches
  `generation-complete` or `finished`.
- Store it in the worker's IndexedDB database, not localStorage.
- Restore it paused on worker startup and publish the saved configuration and
  state to the UI.
- Save only generation boundaries; a partially simulated match is not resumed.
- Clear the checkpoint when NEW EVOLUTION or an imported/bucket population
  starts.

### Consequences

- Reloading `/evolution` restores the last completed generation with Continue
  available.
- Checkpoints contain genomes and reports and may be a few megabytes; IndexedDB
  avoids the localStorage quota.
- Persistence is best-effort: an unavailable IndexedDB does not block a run.

---

## ADR-077 — Cross-tick bot expansion-site cache

**Status:** accepted and implemented in 0.67.0  
**Date:** 2026-11-22

### Context

`botNeedsExpansion` was recomputed on every query and its per-player cache was
reset every tick, even when ownership and structures had not changed.

### Decision

- Keep the boolean needs-expansion cache valid across ticks while the ownership
  version and structure/layout versions remain unchanged.
- Invalidate all entries when ownership changes or structures appear, disappear,
  reinforce, or change district layout.
- Keep the per-tick build-site cache separate because site selection can depend
  on the tick hash.

### Consequences

- Stable periods avoid repeated build-site searches.
- Active wars still invalidate the cache on captures.
- A/B: 8-player 1,000-tick run improved from 829 ms to 781 ms (−5.8%) with
  identical owned-pixel counts.

---

## ADR-078 — Tick-independent build-site and map caches

**Status:** accepted and implemented in 0.68.0  
**Date:** 2026-11-22

### Context

Bot build-site lookups dominated the worker profile. Port sites and the first
legal inner-ring site for Command Posts, War Academies, and Artillery are
deterministic functions of ownership and structure layout, not of the tick hash.
They were still recomputed on every tick. `generateMap` also regenerated a map
for lineage match pairs that share a seed.

### Decision

- Cache Port and inner-ring sites across ticks, keyed by ownership version and
  structure/layout versions.
- Keep the per-tick border-candidate fallback separate because it uses the tick
  hash.
- Reset only labels written by the previous integrity pass instead of clearing
  the full component array.
- Keep a small LRU of generated maps keyed by seed/width/height/player count.
  Maps are treated as immutable after generation.

### Consequences

- Stable periods avoid repeated ring scans; active wars invalidate the cache on
  captures as intended.
- Repeated lineage seeds reuse maps and skip map generation.
- Unique seeds still pay map setup.
- Measured 51-state, 500-tick improvement: 1,276 ms to 1,251 ms (−2.0%).
  Active 8-player timing was unchanged because the cache is invalidated every
  capture.

---

## ADR-079 — Gauntlet survival mode

**Status:** accepted and implemented in 0.69.0  
**Date:** 2026-11-22

### Context

Evolution Lab needed a second natural-selection format that keeps one persistent
population and removes genomes through repeated free-for-all runs rather than
generational breeding.

### Decision

- Add a `gauntlet` Evolution mode with up to 64 genomes in one free-for-all.
- Each genome starts with three global lives; a state that dies in a run loses
  one life and is removed permanently at zero.
- After each run, the top 16 genomes by deterministic fitness that survived the
  run recover one life, capped at the starting maximum. A genome eliminated in
  the run cannot recover that same run.
- Continue runs automatically until the remaining-bot target, a safety run cap,
  or fewer than two genomes remain. A run itself ends on the normal win
  condition or tick target.
- Do not mutate or cross genomes in gauntlet mode.
- Persist lives in the same generation/run-boundary IndexedDB checkpoint.
- Increase the simulation player ceiling to 64 while keeping the default game at
  51 states.

### Consequences

- Gauntlet is exploitation/pressure testing of a fixed genome pool, not a
  mutation search.
- Life recovery can offset one elimination for top performers, so elimination
  pressure is strongest on low-fitness genomes.
- Large 64-seat maps cost more setup and per-tick work; the lab reports measured
  ticks/s.

---

## ADR-080 — Uncapped gauntlet runs and seat refill

**Status:** accepted and implemented in 0.69.1  
**Date:** 2026-11-22

### Context

The first gauntlet implementation stopped after a fixed run cap. That made the
survival tournament terminate for an artificial reason rather than the state of
the population. The population also only shrank, with no way to replenish empty
seats.

### Decision

- Remove the gauntlet run cap. Runs continue until the player pauses/discards or
  the survivor target is reached.
- Add a FILL EMPTY SEATS command between runs that creates deterministic fresh
  random genomes up to 64 seats, each with the configured starting lives.
- Refilling a finished tournament reopens it; refilling between runs leaves the
  next run ready to start.

### Consequences

- A gauntlet can run indefinitely; PAUSE, DISCARD, or the remaining target are
  the only stops.
- New genomes enter with full lives and are distinguishable by their new ids.
- Refilling is only valid between runs; an active simulation is not mutated.

---

## ADR-081 — Acknowledged, ordered worker visuals

**Status:** accepted and implemented in 0.69.2  
**Date:** 2026-11-22

### Context

At fast-forward the worker could produce multiple visual deltas between animation
frames. The renderer only consumed the newest visual, skipping intermediate
deltas and permanently desynchronising the control texture. Speed changes also
left accumulated step credit in the worker, so returning to `1×` replayed a
fast-forward backlog.

### Decision

- Allow only one visual in flight. The worker sends a visual, then waits for a
  `visual-ack` from the renderer before sending the next.
- Queue and apply every delta in order in the renderer; acknowledge only after
  the whole batch is applied.
- If the UI falls behind, the worker keeps accumulating changes and falls back to
  a full owner snapshot when the delta buffer overflows.
- Reset the worker accumulator and time base whenever the speed changes.

### Consequences

- Fast-forward cannot silently skip deltas; the viewport converges to current
  simulation state.
- Visual frequency is bounded by renderer throughput rather than postMessage
  queue growth.
- Returning to `1×` is immediate and does not replay a backlog.

---

## ADR-082 — Stop controls and removed-genome cleanup

**Status:** accepted and implemented in 0.69.3  
**Date:** 2026-11-22

### Context

An active Evolution/Gauntlet simulation had no stop control, and NEW was still
available during a run, allowing an accidental replacement of live data. Bots at
zero gauntlet lives were removed from the next schedule but their genome objects
remained in the live genome bank and their rows stayed visible in the roster.

### Decision

- Hide NEW while a simulation is active; only DISCARD deletes the current run.
- Add STOP: finish the current run/generation, process its result, then stop.
- Add STOP IMMEDIATE: abort the active simulation without processing remaining
  ticks and preserve the existing reports/population.
- CONTINUE resumes a stopped gauntlet while at least two genomes remain.
- When a gauntlet genome reaches zero lives, remove it from the population, the
  global lives map, and the genome bank. Its historical report row is retained
  for audit, but the live roster filters it out.

### Consequences

- Users can stop without discarding data.
- New runs cannot replace an active run by accident.
- Zero-life genomes are no longer referenced by live selection state.

---

## ADR-083 — Apply edited run setup on CONTINUE

**Status:** accepted and implemented in 0.69.4  
**Date:** 2026-11-22

### Context

The Evolution Lab's CONTINUE command carried no configuration. Edits to ticks,
fitness weights, seed, dimensions, gauntlet lives/recovery/target, or generation
settings were ignored until a new run was started.

### Decision

- Send the current setup with the CONTINUE command.
- Apply it to the sandbox before resuming or starting the next match.
- Keep the sandbox mode immutable for the life of a session; mode changes take
  effect only on NEW.
- Gauntlet life edits clamp existing lives to the new maximum. Other settings
  affect the next match/generation.

### Consequences

- Setup edits are honored by CONTINUE without discarding results.
- A current in-flight simulation is not mutated mid-tick; changes apply on the
  next match/generation.

---

## ADR-084 — Export/import gauntlet state as JSON

**Status:** accepted and implemented in 0.69.5  
**Date:** 2026-11-22

### Context

Evolution Lab CSV only carries genome rows. Gauntlet sessions also need the
survivor pool, per-genome lives, run history, and setup; there was no way to
back up or move that state.

### Decision

- Add EXPORT STATE / IMPORT STATE in gauntlet mode.
- Export a JSON `EvolutionSessionSnapshot` containing setup, surviving
  population, gauntlet lives, reports, archive, run index, and terminal phase.
- Only export at a run boundary; exporting an active simulation would omit the
  in-flight run.
- Import creates a restored sandbox, clears the current canvas, restores the
  state paused, updates the IndexedDB checkpoint, and leaves the user to
  CONTINUE.
- Reject files that are not version-1 gauntlet snapshots.

### Consequences

- Gauntlet state can be backed up, inspected, and moved between browsers.
- Imports preserve prior report history and lives.
- Active in-progress ticks are not part of the export; stop or finish the run
  first.

---

## ADR-085 — Seed the main-game bot roster from gauntlet survivors

**Status:** accepted and implemented in 0.70.0  
**Date:** 2026-11-22

### Context

A gauntlet export from seed 1236, run 24 retained 21 genomes after 64 starting
bots and 24 runs. Those genomes encode the strategic behaviour that survived the
survival tournament. The main game only used locally saved evolution buckets and
fell back to procedural bot profiles when none existed.

### Decision

- Extract the 21 survivor genomes from the gauntlet export into
  `static/gauntlet-survivors.json` with source metadata.
- Load that pool lazily on the main page and use it as the base roster for bot
  seats.
- Append locally saved Evolution Lab bucket genomes after the survivor pool so
  user-generated buckets still influence matches.
- Fill seats deterministically by cycling the combined pool with the match seed.
- Keep the full multi-megabyte gauntlet report out of the repository/client;
  only the genome payload is committed.

### Consequences

- Main-game bots now start from genomes that survived live free-for-all
  elimination pressure.
- The static asset is small enough to fetch on demand and is cached.
- If the asset is unavailable, the game falls back to saved buckets or
  procedural bots.

---

## ADR-086 — Port placement snapping and district overlap

**Status:** accepted and implemented in 0.71.0  
**Date:** 2026-11-22

### Context

Ports required a click on one exact owned shoreline pixel and could not be placed
inside any existing district, even though Ports do not claim districts. This made
coastal placement unnecessarily fiddly.

### Decision

- Resolve a Port drop to the nearest valid owned shoreline cell within
  `PORT_BUILD_SNAP_RADIUS` (24 px), including clicks on nearby water.
- Use the resolved cell for validation, placement preview feedback, and the
  actual structure creation.
- Exempt Ports from the “cannot build inside another district” rule, while still
  requiring owned shoreline, no structure occupancy, and 8 px spacing.
- Apply the same district exemption to bot Port placement.

### Consequences

- Players can click near a coast rather than hunting an exact shoreline pixel.
- Ports may sit visually inside unrelated districts without joining or upgrading
  them.
- A Port still cannot be placed inland or on top of another structure.

---

## ADR-087 — Smooth long-match frame pacing and naval request latency

**Status:** accepted and implemented  
**Date:** 2026-11-23

### Context

Long matches showed a periodic hitch every decision tick and a large freeze when
issuing a naval landing. Profiling found three compounding costs: the bot
decision pass re-ran expensive inner-ring build-site scans for every bot, the
full-map annexation scan landed on the same tick as bot decisions, and a single
naval request ran several full-ocean A* searches (validation, queue, and apply)
before spending supply.

### Decision

- Validate and retain known-good bot build sites across ticks; re-scan negative
  inner-ring results only on a slower cadence or when ownership changes near
  that State.
- Run annexation every 3 seconds instead of every second, offset from the bot
  decision tick, while keeping the immediate post-cancellation request.
- Reuse a positive bot expansion result for one build interval.
- Order naval validation so supply is checked before routing.
- Stop naval route selection at the nearest-Port/first successful sea path and
  cache deterministic sea routes.

### Consequences

- The combined 20–30 ms annexation-plus-decision tick spike is removed; annex
  scans no longer coincide with bot decision work.
- Detached territory can remain for up to 3 seconds before annexation.
- A long naval landing request dropped from roughly 150 ms to under 10 ms.
- Routes may be marginally longer than the previous exhaustive shortest-path
  selection but stay deterministic and sea-connected.

---

## ADR-088 — Structure context menu and demolition

**Status:** accepted and implemented  
**Date:** 2026-11-23

### Context

Once a structure was built there was no way to remove it. Players could not
recover a crowded district, replace a structure, or undo an accidental placement.
The shell already suppresses the native browser context menu for card placement,
so it had no structure-level actions.

### Decision

- Right-clicking an on-screen structure opens a structure context menu.
- The first item is **DEMOLISH STRUCTURE**, followed by Cancel.
- Demolition is queued as a command and applied on the next simulation tick.
- The whole structure is removed; its district/aura effects, artillery cooldown,
  supply-cap contribution, and Port annexation anchor are cleaned up.
- Demolition pays no supply refund.
- Only the player's own non-State structures can be demolished. Rival and State
  structures show the action disabled, so the capital cannot be removed
  accidentally.
- The menu is anchored at the pointer, clamped inside the viewport, and closes on
  outside pointer-down, Escape, or a new world.

### Consequences

- Players can clear structure space without waiting for capture or artillery.
- Mistakes are recoverable, at the cost of the original purchase.
- State protection remains stable by construction.
- Demolition is command-driven and deterministic, not a direct UI mutation.

---

## ADR-089 — Permanent elimination income reward

**Status:** accepted and implemented  
**Date:** 2026-11-23

### Context

Eliminating a rival removed a competitor but gave the finishing player no lasting
economic benefit. Late-game snowballing was driven only by captured territory and
structures, and the final capture of a weak state had little immediate payoff.

### Decision

- Credit the player recorded as the victim's last attacker with a permanent
  **+10 supply/s** when the victim reaches zero territory.
- The reward stacks once per eliminated state and is additive with territory
  income, Command Post income, and all other income sources.
- Only a living attacker receives the reward; an elimination with no valid living
  killer does not create income.
- Include the per-player elimination-income stack count in checksums and expose
  the resulting income through the existing snapshot/HUD income value.

### Consequences

- Eliminations create a durable economic advantage and reward finishing a
  weakened neighbor.
- The reward cannot be lost and remains after the eliminated state is gone.
- A player behind on land can catch up through targeted eliminations, while an
  already-large leader gains the same reward.

---

## ADR-090 — Stagger bot attack decisions across the decision interval

**Status:** accepted and implemented  
**Date:** 2026-11-23

### Context

All bots resolved attack, naval, and artillery decisions on the same decision
tick. With 50 bots this created a repeatable 10–15 ms simulation spike every
second. A naive full stagger previously changed outcomes because threat,
options, strengths, and attack rolls all moved together.

### Decision

- Schedule attack, naval, and artillery decisions by player id across
  BOT_DECISION_INTERVAL, so roughly five bots decide per tick.
- Keep threat/posture and strategic options on the global decision tick so the
  shared strategic layer still refreshes coherently.
- Cache per-player strength estimates; each due player refreshes its own value
  and comparisons may use values up to one interval old.
- Replace the global-tick attack roll with a checksummed per-bot decision epoch,
  keeping each bot's roll sequence stable even though its decision tick moves.
- Leave build ticks on their existing player-id stagger.

### Consequences

- The periodic all-bot decision spike is removed; late-match ticks stay under
  the frame budget except for the separate annex scan.
- Bot decisions observe slightly different states within the one-second window.
- Attack pacing changes and requires balance/telemetry validation.
- The behavior suite passes unchanged after the epoch and strength-cache design.

---

## ADR-091 — Alliance requests remain a UI placeholder

**Status:** accepted; mechanic deferred  
**Date:** 2026-11-23

### Context

The right-click menu can show a REQUEST ALLIANCE action for rival territory, but
there is no alliance model (request lifecycle, acceptance, shared enemies,
betrayal, AI policy, checksums, or protocol). Shipping an incomplete mechanic
would create ambiguous gameplay and protocol commitments.

### Decision

- Keep **REQUEST ALLIANCE** as a labelled menu placeholder with no simulation
  command or state change.
- Do not add alliance state, bot acceptance logic, or a protocol shape yet.
- Define the lifecycle and AI policy before implementing the mechanic.

### Consequences

- The UI direction is visible for future work without changing gameplay.
- Players must not expect alliances to have an effect.
- Implementing alliances later will be a deliberate feature with its own ADR.
- Detailed proposal/acceptance/break/checksum design is in
  [ALLIANCES.md](ALLIANCES.md).

---

## ADR-092 — Bot military opening and cap-gated first Artillery

**Status:** accepted and implemented  
**Date:** 2026-11-23

### Context

Balance sweeps showed bots stuck in an economy/defense loop with **zero Barracks
and zero Artillery**, even after several minutes. Threats kept consuming the
treasury on cheap Fortifications, and Barracks' 240-supply cost often exceeded
the bot's supply cap, so the bot never saved enough to escape.

### Decision

- After a basic Command Post/War Academy economy exists, reserve for and build a
  first Barracks before further luxury economy.
- Treat the first Barracks as a military aspiration even while the opening
  economy ramp is still nominally active.
- If Barracks cost exceeds the supply cap, spend the reserve on War Academy
  cap-growth actions only; do not emit unrelated cheap actions while cap-blocked.
- Once a Barracks exists, aggressive high-territory bots enter a first Artillery
  aspiration and cap-grow until the 1,000-supply purchase is reachable.
- Allow the completed Artillery purchase to use the full treasury rather than
  being stranded one reserve short.
- Restore normal defensive spending outside the military reservation so early
  Fortification coverage and build diversity are preserved.

### Consequences

- A normal 6,000-tick seed now builds Barracks from the mid-game and reaches
  Artillery in the late game.
- Eliminations increase without changing combat constants.
- Early economy ramp completion and defensive diversity regressions were fixed
  by separating military/aspiration reserves from ordinary defense.
- Added a regression test that requires both Barracks by tick 1,800 and
  Artillery by tick 6,000 on seed 1234.

---

## ADR-093 — Queue and drain annex transfers across ticks

**Status:** accepted and implemented  
**Date:** 2026-11-23

### Context

Late-game annex scans could produce thousands of transfers. Applying all of
them synchronously in the scan tick created a 20–45 ms hitch every three seconds,
even after bot decisions were staggered.

### Decision

- Collect annex transfers into a deterministic queue instead of claiming every
  cell inside the component scan.
- Drain the queue at a fixed budget per tick (500 cells) in append order.
- Skip a queued transfer if its cell owner no longer matches the owner captured
  when the scan ran.
- Do not start a new scan while the queue is non-empty.
- Cache the Port land-component walk per scan so multiple Ports in the same
  component do not repeat a full BFS.
- Include the pending queue and its cursor in checksums.

### Consequences

- Large annex cleanups no longer block a single simulation tick.
- Annexation can finish a few ticks after the scan, and some stale cells are
  skipped safely.
- Direct unit-test annexation remains synchronous through the non-queued path.

---

## ADR-094 — Player-facing bot Command Post surge modifier

**Status:** accepted and implemented  
**Date:** 2026-11-23

### Context

The 500-stack Command Post stress scenario was useful for saturation testing, but
it was only reachable through a custom script. Expose it as a normal match-setup
modifier so players can deliberately create the same high-economy stress match.

### Decision

- Add a saved match setting otCommandPostStacks with supported values 0
  (standard) and 500.
- At world creation, every AI seat receives one starting Command Post on its
  owned territory with the selected stack count.
- The human commander is unaffected in a normal match; in all-bot/spectator
  matches every seat is a bot and receives one.
- The modifier is chosen on the intro alongside state count, map, difficulty,
  growth layer, and timer; it participates in dirty-settings detection and saved
  defaults.
- The initial structure is placed before district/aura rebuilds so its effects
  are active from tick 0.

### Consequences

- Players can launch the same heavily saturated economy used for stress testing.
- The modifier does not change normal defaults or match outcomes unless selected.
- As with any starting structure, captured/razed Command Posts stop providing
  income; the modifier is not a permanent income buff.

---

## ADR-095 — Lock organic growth for player matches

**Status:** accepted and implemented  
**Date:** 2026-11-23

### Context

Circular, smooth, and organic growth layers were introduced as an experiment and
remained selectable from the intro and HUD long after organic became the default.
The selector added a match-setting dimension, an in-match test control, and
documentation complexity for a choice that no longer served shipping play.

### Decision

- Lock **organic** growth for all player matches.
- Remove the growth-layer selector from the intro match setup and the in-game
  HUD.
- Remove growthMode from saved match settings; legacy saved values are ignored.
- Keep circular and smooth implementations in src/lib/game/growth/ for internal
  tests and benchmark comparisons only.
- Keep growthMode on the simulation API and per-attack state for deterministic
  tests and replay data, but the main game always passes organic.

### Consequences

- Players get one consistent irregular front model.
- Saved settings no longer carry a growth choice; old values normalize away.
- The benchmark can still compare all three layers without exposing them as
  product options.
- Future growth-model changes require a deliberate determinism/protocol ADR.

---

## ADR-096 — Implement one-pair player-requested alliances

**Status:** accepted and implemented  
**Date:** 2026-11-23

### Context

The right-click menu exposed an alliance placeholder while
[ALLIANCES.md](ALLIANCES.md) defined a bounded diplomacy model. The remaining work
was to make requests, acceptance, non-aggression, coordination, expiry, and
betrayal real without adding shared resources or server-only concepts.

### Decision

- Add command-driven lliance-request and lliance-break intents.
- Limit every player to one active alliance or pending proposal.
- Pending proposals expire after 30 seconds and resolve on the target AI's
  staggered decision phase using integer utility plus a deterministic seed
  tie-break.
- Active alliances last 3 minutes, block all hostile targeting between the pair,
  cancel existing mutual fronts with proportional refunds, remove in-flight
  allied shells/landings, and grant coordination credit against common enemies.
- Breaking sets a 60-second pair cooldown and adds a betrayal grievance.
- Include alliance/proposal ids, state, and cooldowns in checksums and snapshots;
  bump protocol to 39.
- Replace the context-menu placeholder with request/pending/active/busy states
  and a HUD alliance status.

### Consequences

- Players can make one meaningful diplomatic commitment at a time.
- Bots can decline; acceptance is deterministic and reproducible.
- Alliances can reduce elimination pace, so future balance sweeps must include
  them.
- Multi-party alliances, renewal, bot-initiated requests, shared vision/supply,
  and protocol delivery remain deferred.

---

## ADR-097 — Authoritative online rooms over HTTP/SSE

**Status:** accepted; MVP implemented  
**Date:** 2026-11-23

### Context

[NETWORKING.md](NETWORKING.md) defined a server-authoritative WebSocket target but
the game still had one human seat and no server surface. The first playable
online milestone needed to support several humans in one deterministic match
without disturbing local play.

### Decision

- Add humanPlayerIds to SimulationOptions. Human seats keep independent
  supply, income accrual, card hands, and viewer-specific snapshots; local mode
  still defaults to seat 1.
- Add an authoritative OnlineRoom core: seat assignment, host start,
  monotonic per-player intent sequences, per-tick rate limits, intent
  application, owner-baseline RLE, and per-viewer snapshots.
- Transport the MVP over HTTP command posts and Server-Sent Events tick streams
  rather than WebSocket. This keeps the browser/server implementation
  dependency-free and gives a clear upgrade path without changing authority.
- Rooms are in memory and support reconnect with the same session token. Late
  joins after start are rejected for the MVP.
- Bump the wire protocol to 40.

### Consequences

- A room can host up to four humans with server-side bots filling remaining
  seats.
- The server owns tick advancement, command validation, rates, and winner state.
- Room state is lost on process restart; persistence, matchmaking, chat, late
  join, and WebSocket/binary transport remain future work.
- Online clients render authoritative deltas; they do not predict or mutate
  simulation state.

---

## ADR-098 — 200-player single-process online capacity target

**Status:** accepted; measured and gated  
**Date:** 2026-11-23

### Context

The first online rooms used the full 2048×1024 arena in every room. A 200-player
load (25 rooms × 8 humans) consumed roughly 1.9 GiB and produced long GC tails;
a 50-room × 4-human packing consumed about 3.8 GiB. Neither is a credible
single-process support target.

### Decision

- Target **200 concurrent human players at 10 Hz on one server process**.
- Reference packing: **25 rooms × 8 humans × 8 states** on the compact
  **1280×720** online arena.
- Hard-cap admission at 25 rooms / 200 human seats.
- Expose live capacity through /api/online/metrics.
- Gate the target with pnpm bench:online:
  p95 tick ≤ 50 ms, p99 tick ≤ 300 ms, RSS ≤ 1.5 GiB.
- Coalesce SSE tick writes so slow clients cannot build unbounded queues.
- Keep local matches on their existing map dimensions; only online rooms default
  to the compact arena.

### Measured result

At 25 rooms × 8 humans, 300 measured ticks after warm-up: average 5.3 ms, p95
1.6 ms, p99 ~177 ms, RSS ~969 MiB, outbound ~5.8 MiB/s, ~189 ticks/s continuous
headroom. The target passes. The p99 tail is GC-driven; worker-sharded rooms are
the next scale step beyond this target.

### Consequences

- A single process can support the target with headroom on tick average.
- Memory is bounded enough for a modest host; room map choice is part of the
  support contract.
- 200 is a validated ceiling, not an invitation to unbounded room creation.

---

## ADR-099 — Arbitrary atlas dimensions with 26-bit change indices

**Status:** accepted; implemented  
**Date:** 2026-11-23

### Context

The original atlas was 2048×1024 and ownership-change packets reserved only 21
bits for the pixel index, which capped the simulation at 2²¹ cells. Increasing
the world size and supporting arbitrary rectangular atlases required a wire and
map-version change.

### Decision

- Raise the default local atlas to **4096×2048** (8,388,608 cells).
- Support arbitrary rectangular dimensions within **512–8192 px per side** and
  **2²⁶ total cells**.
- Expand packed ownership changes to **26 index bits + 6 owner bits** in a
  Uint32; decode with packed >>> 26 and packed & 0x3ffffff.
- Validate dimensions in generateMap; match settings normalize invalid sizes
  back to the selected preset.
- Expose custom width/height in match setup.
- Bump MAP_VERSION to 5 and wire protocol to 41.
- Keep online rooms on their compact arena for the 200-player capacity target;
  online room config already accepts explicit dimensions.

### Consequences

- Every simulation path, renderer delta, evolution mirror, and online payload
  uses the wider packing.
- Full-map checksum cost grows with atlas area (~64 ms at the default size);
  it remains an on-demand operation.
- The 8192-per-side and 2²⁶-cell ceilings are GPU/texture and packed-wire limits,
  not arbitrary constants; larger atlases would require a wider change packet
  format.

---

## ADR-100 — Worker-owned local simulation

**Status:** accepted and implemented  
**Date:** 2026-11-23

### Context

The 4096² client audit showed normal ticks at ~1.8 ms, but synchronous annex
scans at ~41 ms and neutral-pocket cleanup at ~81 ms on the main render thread.
Those scans caused repeatable frame hitches, and atlas area makes them worse.

### Decision

- Run TerritorySimulation.step(), bot decisions, and integrity scans inside a
  dedicated Web Worker for local matches.
- The main thread keeps a read-only RemoteEvolutionSimulation-style mirror and
  applies worker owner/district deltas; it never steps the simulation.
- Commands are forwarded to the worker as promises and validated there.
- The worker supports pause/resume and sends telemetry/events.
- HUD updates stay throttled to 5 Hz while territory visuals stream at 10 Hz.
- World rebuilds and page unmount terminate the previous worker.

### Consequences

- Integrity spikes no longer block rendering or input.
- UI validation/preview paths use mirror approximations; the worker result is
  authoritative for every command.
- Browser worker behavior still requires manual UI verification.

---

## ADR-101 — Worker module and SimulationView boundary

**Status:** accepted and implemented
**Date:** 2026-11-23

### Context

The worker migration left main-game code split between `game/` and `ai/`, reused
evolution-named classes, and required components to cast the worker mirror to
`TerritorySimulation`.

### Decision

- Own all worker simulation boundaries under `src/lib/game/worker/`.
- Keep only evolution-specific commands in `ai/evolution-worker-protocol.ts`;
  share init/visual payloads in `worker/protocol.ts`.
- Rename the render mirror to `RemoteSimulationView` in `worker/view.ts`.
- Define `SimulationView` in `simulation-view.ts` as the read-only contract used
  by `GameCanvas` and `Minimap`; both the authoritative simulation and worker
  mirror satisfy it.
- Run the built-worker smoke test in CI after the production build.

### Consequences

- The worker boundary is discoverable in one module.
- Components no longer depend on a concrete simulation class or casts.
- Future renderer/query consumers should target `SimulationView`.

---

## ADR-102 — Resolve every detached component atomically

**Status:** accepted and implemented
**Date:** 2026-11-23

### Context

Annexation only moved an unprotected component when it directly touched a
foreign protected mainland. Components with no protected contact were left
alone, so detached enclaves could survive indefinitely. The cross-tick transfer
queue also left a window in which a new attack could capture a cell that the
annexation plan was about to move, making the result depend on tick timing.

### Decision

- Build a component-adjacency graph during the integrity scan and propagate
  protection outward from State/Port anchors through any chain of adjacent owned
  components.
- Annex reachable components to the protected root owner; abandon components
  with no path to protection to neutral land.
- Apply the complete annex/abandon plan atomically in one scan. Remove the
  cross-tick transfer queue and its checksum fields.
- Protect same-owner Ports transitively across any chain of shared sea
  components, not only one hop.
- Run small-neutral-pocket cleanup immediately after a non-empty integrity scan
  so annexation cannot leave temporary holes.

### Consequences

- Every owned component either reaches protection or becomes neutral; no owned
  enclave survives indefinitely.
- Annexation is deterministic and cannot race a new capture.
- Large cleanups may do more work in one tick; benchmark before changing the
  cadence.

---

## ADR-103 — Snap naval targets and replace shift batch-upgrades

**Status:** accepted and implemented
**Date:** 2026-11-24

### Context

Naval landings required clicking an exact shoreline pixel even though Port placement already snapped nearby clicks. Shift-click was overloaded for five-level upgrades, leaving no quick way to place structures repeatedly at nearby legal cells.

### Decision

- Naval targeting resolves to the closest valid hostile/neutral, unoccupied shore within `NAVAL_TARGET_SNAP_RADIUS` (32 px); the click may be water, land, or shore.
- Add 1/5/10/25 upgrade-batch buttons above the supply bar. Normal district clicks use the selected batch.
- While a card is armed, Shift-click builds on the closest valid cell, never upgrades, and keeps placement armed after success.
- Keyboard Shift+Enter follows the same armed-card build behavior.

### Consequences

- Port and naval targeting now share the forgiving nearby-click interaction.
- The five-level Shift-click shortcut is retired; batch size is explicit in the HUD.
- Shift-build can issue several structures quickly, so it intentionally retains card/placement state.

---

## ADR-104 — Wide, tight-capable shift-build search

**Status:** accepted and implemented
**Date:** 2026-11-24

### Context

A 32 px shift-build search often missed the nearest usable site, especially when only a one-pixel gap remained next to a State or at a district edge. The authoritative 8 px spacing guard also rejected tight pockets even when no normal site was available.

### Decision

- Raise the shift-build search radius to 160 px.
- Search in expanding rings and accept the closest legal site, preferring normal-spacing sites at equal distance.
- If no normal site exists, retry with `allowTightSpacing`; the worker bypasses only the 8 px spacing guard, never ownership/district/occupancy checks.
- Carry `newStructureOnly` and `allowTightSpacing` through the worker build command.
- Keep normal drag/click placement on the 8 px rule.

### Consequences

- Shift-build can fill a one-pixel gap with a new structure.
- Worst-case UI scan is O(160²) but measured ~9–10 ms on the target machine.
- Structures may be placed closer than the normal 8 px guard when explicitly shift-built.

---

## ADR-105 — Accepted-move ledger before lockstep

**Status:** accepted and implemented as a foundational primitive
**Date:** 2026-11-24

### Context

A deterministic simulation makes input-based lockstep possible, but switching the online transport in one step would combine authority, reconciliation, late-join, and desync handling. A smaller first step is a replayable move ledger: record the accepted moves, reconstruct the match from seed/config, and verify checksums.

### Decision

- Add `MatchLedger` with seed/config options, ordered accepted intents, target tick, and checksum samples.
- Share `applyOnlineIntent` between `OnlineRoom` and the ledger replayer so command semantics cannot drift.
- Record only intents that the authoritative room accepted.
- Do not record bot commands; regenerate them deterministically from the same options and tick schedule.
- Keep server-authoritative state replication as the live online path for now.

### Consequences

- A match can be exported/replayed without storing owner snapshots.
- Ledger replay is a direct determinism test for the online path.
- Full lockstep still needs command scheduling, input delay, desync recovery, late-join snapshots, and anti-cheat policy.

---

## ADR-106 — Offline play uses a local ledger agent

**Status:** accepted and implemented on the Ledger branch
**Date:** 2026-11-24

### Context

The accepted-move ledger existed as an export/replay primitive but the offline
worker still let the UI call simulation command methods directly. That made the
simulation mutable state, not the ledger, the practical source of truth.

### Decision

- Add `LedgerAgent` as the sole writer for offline play.
- Player commands become transactions; the agent validates via the shared
  intent mapping, appends accepted entries, and returns the open block.
- `advance()` steps the derived simulation, seals the block with a checksum, and
  emits it with visual state.
- The local worker host no longer issues simulation command calls directly.
- The same agent contract can be hosted server-side for a future online lockstep
  mode; transport remains state replication for now.

### Consequences

- Offline commands have an auditable ledger chain and replayable checksums.
- Open blocks are valid for inclusion but only sealed blocks carry a final
  checksum.
- Bot behavior is still implicit in seed/config/tick and is not placed on the
  ledger.

---

## ADR-107 — Replay timeline and ledger navigation

**Status:** accepted and implemented on the Ledger branch
**Date:** 2026-11-24

### Context

The replay worker could reproduce a ledger but had no interactive playback. A
useful replay needs pause/play, speed, stepping, scrubbing, and direct ledger
navigation without giving replay mode write access to the authoritative ledger.

### Decision

- Add replay-control messages (play, pause, seek, step, speed) and replay-status
  messages to the local worker protocol.
- Seeking rebuilds the deterministic simulation from the ledger seed and replays
  accepted transactions to the target tick, emitting a full-owner resync visual.
- Expose a replay panel with timeline, speed controls, tick stepping, and a
  ledger-block viewer; clicking a block seeks to its tick.
- Keep live mode on the same ledger-backed worker but hide replay controls and
  use a separate live pause path.

### Consequences

- Replay is read-only and cannot append transactions.
- Scrubbing correctness is deterministic; seek latency grows with tick count
  until snapshot keyframes are added.
- Ledger blocks are navigation anchors; the timeline itself is tick-based.
