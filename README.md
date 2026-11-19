# TERRITORY

**A deterministic, WebGPU-rendered pixel territory war.** Every pixel of the 2048 × 1024 atlas is land, ocean, or somebody's country. Expand from your beachhead, break seven rival states, and paint the map.

![Territory gameplay](docs/media/gameplay.png)

<details>
<summary>More screens</summary>

![Territory intro](docs/media/intro.png)

![Territory field manual](docs/media/field-manual.png)

</details>

> **Status: playable local vertical slice (v0.1).** The deterministic simulation, procedural map, combat, bots, WebGPU renderer, HUD, minimap, and replayable seed flow are implemented. Online multiplayer is fully specified but **not wired up yet** — see [docs/NETWORKING.md](docs/NETWORKING.md).

---

## Why this architecture

| Requirement            | Implementation                                                                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Large pixel map        | 2,097,152 ownership cells rendered from a single GPU control texture, nearest-neighbour sampled, with a shader-side pixel grid at combat zoom |
| Deterministic          | Fixed 10 Hz tick, integer troop economy, seeded integer PRNG, stable command ordering, FNV-1a state checksums, deterministic tests            |
| Fast rendering         | Full-screen WebGPU pass; only changed 64 × 64 tiles are uploaded, with adjacent tiles merged into strips. No per-frame full-map uploads       |
| Fast territory changes | Simulation emits a packed `Uint32Array` of changed pixels. A typical combat tick touches ≤ 1,200 cells across a handful of local fronts       |
| Ease of development    | SvelteKit 3 + Svelte 5 runes + TypeScript, with a strict separation between pure simulation, GPU rendering, and UI                            |

## Quick start

**Requirements:** Node.js ≥ 24, pnpm ≥ 11, and a browser with WebGPU enabled (current Chrome or Edge on desktop). Safari/Firefox support varies; unsupported browsers get an explicit error screen rather than a broken canvas.

```sh
pnpm install
pnpm dev
```

Open the URL printed by Vite (normally <http://localhost:5173>). Append a seed to replay a world:

```text
http://localhost:5173/?seed=1234
```

### Commands

```sh
pnpm dev        # Vite dev server (HMR)
pnpm check      # svelte-check + TypeScript
pnpm test       # deterministic simulation tests
pnpm bench      # map/tick/checksum benchmark (Node)
pnpm build      # production build via adapter-node
pnpm preview    # preview the production build
pnpm lint       # Prettier check
pnpm format     # Prettier write
```

## Controls

| Input                | Action                                                            |
| -------------------- | ----------------------------------------------------------------- |
| Click / tap a border | Expand into neutral land, or attack a rival's connected territory |
| Drag                 | Pan the map                                                       |
| Scroll               | Zoom at the pointer                                               |
| `Space`              | Pause / resume the simulation                                     |
| `F`                  | Fit the whole atlas                                               |
| `C`                  | Return to your beachhead                                          |
| `+` / `−`            | Zoom                                                              |
| `H`                  | Open the field manual                                             |
| Minimap click        | Jump the camera                                                   |

The camera stays independent of the simulation, so pausing, zooming, and panning never influence game state.

## How it works

```text
Svelte UI (+page.svelte)
  └── GameCanvas.svelte ......... fixed-step driver, pointer input, camera bridge
        ├── TerritorySimulation .. pure deterministic game core
        │     ├── generateMap .... seeded, versioned 2048 × 1024 atlas
        │     ├── TerritoryRng ... mulberry32
        │     └── border sets .... derived from owner + land arrays
        ├── TerritoryRenderer .... WebGPU device, textures, shader, dirty-tile uploads
        └── MapCamera ............ CSS-pixel camera, zoom, clamping
  └── Minimap.svelte ............ 2D overview, throttled independent redraw
```

- **Simulation** owns the authoritative arrays: land, terrain shade, owner IDs, player state, frontier sets, active attacks, and the PRNG. It uses no DOM, no wall clock, and no `Math.random`.
- **Renderer** owns the CPU-side RGBA control texture and GPU resources. It never mutates simulation state. After each tick it consumes the packed change buffer and uploads changed tiles.
- **UI** consumes immutable snapshots at tick boundaries. The render loop is intentionally separate from the fixed tick loop.

Read the full breakdown in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Measured baseline

These are ballpark figures from the included benchmark on the development machine (Windows, Node 24, headless Chrome with hardware acceleration). Treat them as regression baselines, not universal claims.

| Measurement                               | Result                                    |
| ----------------------------------------- | ----------------------------------------- |
| Map generation (2048 × 1024)              | ~200–210 ms, one-time on world creation   |
| Idle simulation tick                      | ~0.08 ms                                  |
| Mid-match simulation tick with bot combat | ~0.06–0.07 ms                             |
| Full-state checksum                       | ~8.9 ms (on-demand only)                  |
| Browser render loop                       | 144 fps at 1600 × 1000 in headless Chrome |
| Map upload rate under bot combat          | ~0.55–1.0M pixels/s (~55–100K per tick)   |
| Full control texture                      | 8 MiB VRAM + 8 MiB CPU shadow             |
| Node benchmark RSS (two worlds)           | ~142–147 MiB                              |

At 10 Hz, the simulation uses well under 1% of a 100 ms tick budget on this hardware. The renderer is the more interesting performance surface. See [docs/PERFORMANCE.md](docs/PERFORMANCE.md).

## Determinism guarantees

1. Every client and server runs the same simulation code at the same fixed 10 Hz tick.
2. The map is generated deterministically from a 32-bit seed and a **map version**. Changing map generation requires bumping `MAP_VERSION`.
3. Simulation arithmetic is integer-based. Rendering, frame rate, and camera state cannot affect outcomes.
4. Bots draw from one seeded PRNG in a fixed player order.
5. Commands are applied at tick boundaries in a stable order.
6. State checksums can be compared across clients and servers; a mismatch forces a resync rather than silently diverging.

The details and contributor rules live in [docs/DETERMINISM.md](docs/DETERMINISM.md).

## Project map

```text
src/
  app.css                        design tokens and resets
  routes/
    +page.svelte                 game shell, HUD, overlays, controls
    +page.ts                     client-only route (ssr = false)
  lib/
    components/
      GameCanvas.svelte          canvas lifecycle, fixed loop, pointer handling
      Minimap.svelte             throttled 2D overview
    game/
      constants.ts               rules, palette, protocol-visible constants
      rng.ts                     deterministic PRNG
      map.ts                     integer-hash + fBm map generation, starts
      simulation.ts              world state, economy, attacks, bots, checksum
      simulation.test.ts         determinism and invariant tests
      net/protocol.ts            multiplayer wire protocol sketch
      render/
        camera.ts                pan / zoom / clamp logic
        camera-bridge.ts         imperative bridge for Svelte controls
        territory.wgsl.ts        full-screen WGSL map shader
        territory-renderer.ts    WebGPU setup, control texture, dirty uploads
docs/
  SPEC.md                        canonical product + technical specification
  ARCHITECTURE.md                module responsibilities and data flow
  DETERMINISM.md                 invariants, replay, multiplayer rules
  RENDERING.md                   WebGPU pipeline and upload strategy
  NETWORKING.md                  authoritative online architecture
  PERFORMANCE.md                 budgets, benchmarks, profiling
  ROADMAP.md                     phased delivery plan
  DECISIONS.md                   architecture decision records
  README.md                      documentation index
scripts/
  benchmark.ts                   tick/map/checksum benchmark
AGENTS.md                        orientation for future coding agents
```

## Current limitations

- Online play, accounts, matchmaking, and persistence are specified but not implemented.
- One human against seven bots; no diplomacy or alliances.
- No audio, fog of war, or spectator camera UI.
- Touch pan/tap works; pinch-to-zoom is not implemented yet.
- WebGPU is required. There is no WebGL/Canvas2D fallback.
- The simulation runs on the main thread. At current tick costs this is fine, but a worker move is planned before large-scale online play.

## Documentation index

| Document                                     | Read it for                                         |
| -------------------------------------------- | --------------------------------------------------- |
| [docs/SPEC.md](docs/SPEC.md)                 | The canonical game and technical specification      |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Code map, data flow, extension points               |
| [docs/DETERMINISM.md](docs/DETERMINISM.md)   | Rules that keep every client in lockstep            |
| [docs/RENDERING.md](docs/RENDERING.md)       | WebGPU pipeline, texture layout, upload batching    |
| [docs/NETWORKING.md](docs/NETWORKING.md)     | Authoritative server, protocol, latency, anti-cheat |
| [docs/PERFORMANCE.md](docs/PERFORMANCE.md)   | Budgets, measured baseline, profiling playbook      |
| [docs/ROADMAP.md](docs/ROADMAP.md)           | Phased plan and acceptance criteria                 |
| [docs/DECISIONS.md](docs/DECISIONS.md)       | Why the stack and engine work this way              |
