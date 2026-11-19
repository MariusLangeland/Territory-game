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
- smooth: eight sector buckets with round-robin and attacker-neighbour scoring;
- organic: deterministic random candidate selection with a per-attack seeded PRNG.

The simulation remains responsible for ownership, edge connectivity, capture limits, lifetime, and checksums. A HUD switch changes the mode used for new attacks; existing attacks keep their original mode. The mode is applied at the next tick.

### Consequences

- Attack shapes can be compared live under the same 108-state load.
- Validation, connectivity, and order termination are shared and cannot silently diverge by mode.
- Per-attack growth state and RNG are included in checksums.
- Smooth costs more CPU (~2.6 ms/tick vs ~1.7 ms for circular/organic).
- Growth mode is currently a local test control; online play must make it server-authoritative.
- A final growth design still must be chosen before economy/balance work.

### Alternatives considered

- Hard-code one shape: faster to ship, but loses the requested comparison harness.
- Custom code path per mode in `processAttacks`: risks inconsistent connectivity/budget behavior.
- Randomize candidates without per-attack seeds: non-deterministic and untestable.
