# TERRITORY

**A deterministic, WebGPU-rendered pixel territory war.** Every pixel of the 2048 × 1024 atlas is land, ocean, or somebody's country.

![Territory attack stress test](docs/media/gameplay.png)

<details>
<summary>More screens</summary>

![Territory intro](docs/media/intro.png)

![Territory field manual](docs/media/field-manual.png)

</details>

> **Status: attack stress experiment (v0.3.2).** The economy, troops, income, caps, and attack costs are intentionally removed so the attack pipeline can be developed in isolation. **This is not the intended final combat model.** See [docs/EXPERIMENTS.md](docs/EXPERIMENTS.md).
>
> The current build runs **108 states** (1 human + 107 AI) to stress-test free attacks, territory flood fill, frontier bookkeeping, dirty-tile rendering, and the HUD. It includes three switchable growth layers: **circular**, **smooth**, and **organic**. Online multiplayer remains specified but **not wired up**.

---

## What this build demonstrates

| Area            | Implementation                                                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Attack stress   | 108 states, three switchable growth layers, 3 active fronts (human) / 2 (bots), 30 px/front/tick, connectivity-checked flood fill           |
| Large pixel map | 2,097,152 ownership cells rendered from a single GPU control texture, nearest-neighbour sampled, with pixel-grid and terrain shader detail  |
| Determinism     | Fixed 10 Hz tick, seeded integer PRNG, stable command order, FNV-1a checksums, deterministic tests                                          |
| Rendering speed | Full-screen WebGPU pass; changed 32 × 32 tiles are merged into strips, with heavy-load full resyncs split across frames to protect input    |
| UI scale        | Virtualized 108-state leaderboard (only visible rows in DOM), 5 Hz HUD snapshots, generated palette, minimap, attack counters, perf readout |
| Tooling         | SvelteKit 3 + Svelte 5 + TypeScript, Vitest determinism/stress tests, benchmark script, CI workflow                                         |

## Quick start

**Requirements:** Node.js ≥ 24, pnpm ≥ 11, and a WebGPU-enabled browser (current Chrome or Edge on desktop).

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
pnpm test       # deterministic + 108-state stress tests
pnpm bench      # map/tick/checksum benchmark
pnpm build      # production build via adapter-node
pnpm preview    # preview the production build
pnpm lint       # Prettier check
pnpm format     # Prettier write
```

## Controls

| Input                       | Action                                                       |
| --------------------------- | ------------------------------------------------------------ |
| Click / tap a shared border | Open a free attack front into neutral land or a rival state  |
| Drag                        | Pan the map                                                  |
| Scroll                      | Zoom at the pointer                                          |
| `Space`                     | Pause / resume the simulation                                |
| `F`                         | Fit the whole atlas                                          |
| `C`                         | Return to your beachhead                                     |
| `+` / `−`                   | Zoom                                                         |
| `H`                         | Open the field manual                                        |
| Minimap click               | Jump the camera                                              |
| Growth switcher             | Select circular / smooth / organic for **new** attack orders |

A click must be on land near a shared border. The simulation reports ocean, own territory, no-shared-border, and active attack-limit failures. No resources are consumed.

## How the attack works right now

1. Click a target cell near your frontier.
2. The simulation finds up to 96 target-owned cells within 34 px that touch your territory.
3. A free attack front opens, with a technical cap of 3 active fronts (2 for bots).
4. Each tick, a front captures up to 30 connected target-owned pixels, traversing through the target's territory.
5. Every captured pixel must still touch the attacker's territory at capture time. If another front cuts the connection, queued pixels are discarded.
6. A front with no legal captures in a tick peters out immediately, so fronts cannot phase through each other and leave enclaves.
7. **Orders are finite:** every front expires after 5 seconds (50 ticks), even if it still has reachable frontier.

### Growth layers

The HUD selector switches the frontier-selection strategy used by attacks created from the next tick onward. Existing orders keep the layer they started with, so you can compare layers in the same match.

Every attack grows outward from its **border-contact centroid**, not from the clicked cell. The click selects the target owner and the border region to search; it cannot pull a narrow corridor inland.

| Layer        | Behavior                                                                              |
| ------------ | ------------------------------------------------------------------------------------- |
| **Circular** | Euclidean-priority frontier; expands as a digital disc instead of a Manhattan diamond |
| **Smooth**   | Radial bands with concavity filling; suppresses tangent wings and thin spikes         |
| **Organic**  | Deterministic random frontier selection; irregular, organic lobes                     |

Circular and smooth both grow radially from the border and can look similar by design; smooth trades exact circularity for banded concavity filling. Organic is the visually distinct mode.

This is deliberately provisional. See [docs/EXPERIMENTS.md](docs/EXPERIMENTS.md) for the stress rules and the exit plan.

## Architecture at a glance

```text
Svelte UI (+page.svelte)
  └── GameCanvas.svelte ......... fixed-step driver, pointer input, camera bridge
        ├── TerritorySimulation .. pure deterministic game core
        │     ├── generateMap .... seeded, versioned 2048 × 1024 atlas + 108 starts
        │     ├── TerritoryRng ... mulberry32
        │     ├── growth/ ........ circular / smooth / organic frontier layers
        │     └── attacks ........ contiguous flood fronts with finite orders
        ├── TerritoryRenderer .... WebGPU device, shader, adaptive chunked uploads
        └── MapCamera ............ CSS-pixel camera, zoom, clamping
  └── Minimap.svelte ............ 2D overview, throttled independent redraw
```

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for module responsibilities and data flow.

## Measured baseline

Ballpark figures from the included benchmark on the development machine (Windows, Node 24, headless Chrome with hardware acceleration). Treat them as regression baselines, not universal claims.

| Measurement                                   | Result                                               |
| --------------------------------------------- | ---------------------------------------------------- |
| Map generation + 108 starts                   | ~225 ms, one-time on world creation                  |
| Default (circular) all-bot attack tick        | ~1.8–2.0 ms                                          |
| Smooth-layer all-bot attack tick              | ~3.0–3.3 ms                                          |
| Organic-layer all-bot attack tick             | ~1.7–1.8 ms                                          |
| Full-state checksum                           | ~9 ms (on-demand only)                               |
| Browser render loop while panning, 209 fronts | 144 fps; p99 frame 7.1 ms; zero frames >10 ms        |
| Upload strategy under stress                  | adaptive full-texture chunks: ~21M px/s, ~80 calls/s |
| Full control texture                          | 8 MiB VRAM + 8 MiB CPU shadow                        |
| Node benchmark RSS (all benchmark worlds)     | ~230–340 MiB                                         |

At 10 Hz, the attack-heavy simulation uses roughly 1.8–3.3% of a 100 ms tick budget depending on growth layer. Panning smoothness is protected by spreading heavy texture uploads across frames and by keeping the 108-row leaderboard virtualized to the visible window. See [docs/PERFORMANCE.md](docs/PERFORMANCE.md).

## Determinism guarantees

1. Every client and server runs the same simulation code at the same fixed 10 Hz tick.
2. The map is generated deterministically from a 32-bit seed and a **map version**. Changing map or start generation requires bumping `MAP_VERSION`.
3. Attack outcomes depend on integer positions, ownership, queue order, and command order — never on frame rate, camera, or rendering.
4. Bots draw from one seeded PRNG in a fixed player order.
5. Commands are applied at tick boundaries in a stable order.
6. State checksums can be compared across clients and servers; a mismatch forces a resync rather than silently diverging.

The attack experiment is still subject to the full determinism contract in [docs/DETERMINISM.md](docs/DETERMINISM.md).

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
      constants.ts               attack stress rules, 108-state palette/names
      rng.ts                     deterministic PRNG
      map.ts                     map generation and 108 start placement
      simulation.ts              world state, free attacks, bots, checksums
      simulation.test.ts         determinism, ownership, frontier, stress tests
      growth/                    switchable circular/smooth/organic frontier layers
      net/protocol.ts            multiplayer wire protocol draft
      render/
        camera.ts                pan / zoom / clamp logic
        camera-bridge.ts         imperative bridge for Svelte controls
        territory.wgsl.ts        full-screen WGSL map shader
        territory-renderer.ts    WebGPU setup, control texture, dirty uploads
docs/
  SPEC.md                        canonical product + technical specification
  EXPERIMENTS.md                 active attack stress experiment and exit plan
  ARCHITECTURE.md                module responsibilities and data flow
  DETERMINISM.md                 invariants, replay, multiplayer rules
  RENDERING.md                   WebGPU pipeline and upload strategy
  NETWORKING.md                  authoritative online architecture
  PERFORMANCE.md                 budgets, benchmarks, profiling
  ROADMAP.md                     phased delivery plan
  DECISIONS.md                   architecture decision records
  README.md                      documentation index
scripts/
  benchmark.ts                   attack tick/map/checksum benchmark
AGENTS.md                        orientation for future coding agents
```

## Current limitations

- The economy and final attack semantics are intentionally missing; this build is not game-balanced.
- The 108-state leaderboard and AI load are a stress mode, not the shipping match format.
- Online play, accounts, matchmaking, and persistence are specified but not implemented.
- No audio, fog of war, diplomacy, or spectator camera UI.
- Touch pan/tap works; pinch-to-zoom is not implemented yet.
- WebGPU is required. There is no WebGL/Canvas2D fallback.
- The simulation runs on the main thread.

## Documentation index

| Document                                     | Read it for                                            |
| -------------------------------------------- | ------------------------------------------------------ |
| [docs/SPEC.md](docs/SPEC.md)                 | The canonical game and technical specification         |
| [docs/EXPERIMENTS.md](docs/EXPERIMENTS.md)   | Temporary attack stress rules, findings, and exit plan |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Code map, data flow, extension points                  |
| [docs/DETERMINISM.md](docs/DETERMINISM.md)   | Rules that keep every client in lockstep               |
| [docs/RENDERING.md](docs/RENDERING.md)       | WebGPU pipeline, texture layout, upload batching       |
| [docs/NETWORKING.md](docs/NETWORKING.md)     | Authoritative server, protocol, latency, anti-cheat    |
| [docs/PERFORMANCE.md](docs/PERFORMANCE.md)   | Budgets, measured baseline, profiling playbook         |
| [docs/ROADMAP.md](docs/ROADMAP.md)           | Phased plan and acceptance criteria                    |
| [docs/DECISIONS.md](docs/DECISIONS.md)       | Why the stack and engine work this way                 |
