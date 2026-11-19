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

A single dirty bounding box across eight bot attacks spanning different continents uploads nearly the full 8 MiB texture each tick (~21M pixels/s measured).

### Decision

Divide the control texture into 64 × 64 tiles. Mark dirty tiles with a generation-stamped buffer, merge adjacent dirty tiles into horizontal strips, and upload each strip. Keep full uploads for initialization and resync only.

### Consequences

- Typical upload drops to ~0.55–1.0M pixels/s in observed bot combat.
- More `writeTexture` calls than one rectangle, but far fewer pixels.
- Tile bookkeeping memory is negligible (512 marks + 16 row flags).
- Tile size is a tuning knob; 64 balances overhead and upload precision.
- Renderer needs a full-resync path for overflow/device issues.

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

A 10 Hz simulation measured at ~0.06–0.08 ms/tick is trivial on the main thread. A worker adds serialization and rendering synchronization complexity.

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
