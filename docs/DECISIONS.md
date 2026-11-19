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

A single dirty bounding box across bot attacks spanning different continents uploads nearly the full 8 MiB texture each tick (~21M pixels/s measured). With 108 attacking states the problem is worse and changes are scattered across hundreds of fronts.

### Decision

Divide the control texture into 32 × 32 tiles. Mark dirty tiles with a generation-stamped buffer, merge adjacent dirty tiles into horizontal strips, and upload each strip. When dirty tiles exceed a threshold, switch to a full-texture resync split across frames, because hundreds of tiny writes stall the input path.

### Consequences

- Under ~209 fronts, tile-only uploads produced ~2,169 `writeTexture` calls/s and panning frames up to ~28 ms.
- Above a 96-dirty-tile threshold, the renderer now queues an adaptive full-texture resync in eight horizontal chunks, max two chunks per frame. Upload traffic rises to ~21M pixels/s and ~80 calls/s, but panning reached 144 fps with zero frames >10 ms in the verification run.
- HUD snapshots are throttled to 5 Hz and the 108-row leaderboard is virtualized; otherwise DOM updates still produced ~14 ms tick-boundary frames.
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

A 10 Hz simulation measured at ~1.4 ms/tick under the 108-state stress load (and far less in the earlier 8-state build) is cheap on the main thread. A worker adds serialization and rendering synchronization complexity.

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

## ADR-009 — Temporarily remove the economy and stress 108 states

**Status:** accepted for EXP-001; provisional  
**Date:** 2026-11-19

### Context

Attack correctness and performance were entangled with troops, income, caps, attack costs, and a low player count. The next feature focus is attacking itself: many fronts, free clicks, dense territory collision, and 100+ AI opponents.

### Decision

Temporarily remove all economy and resource gating, add 100 AI states (108 total), make attacks free, keep only technical active-front caps, and use 32 × 32 dirty uploads plus packed attack queues to survive the load. Track the deviation explicitly in [EXPERIMENTS.md](EXPERIMENTS.md).

### Consequences

- The attack flood-fill and renderer are exercised far beyond normal intended load.
- AI states saturate the map quickly; balance and match pacing are not meaningful in this build.
- The UI must handle 108 logical leaderboard states (virtualized to the visible window) and generated colors/names.
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

- Attack shapes can be compared live under the same 108-state load.
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
- Expose elevation, base defense, and total defense in the hover status console.
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
