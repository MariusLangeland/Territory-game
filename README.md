# TERRITORY

**A deterministic, WebGPU-rendered pixel territory war.** Every pixel of the 2048 × 1024 atlas is land, ocean, or somebody's country.

![Territory Frontage v1](docs/media/gameplay.png)

<details>
<summary>More screens</summary>

![Territory intro](docs/media/intro.png)

![Territory field manual](docs/media/field-manual.png)

</details>

> **Status: Frontage v1 (v0.30.0).** One **supply** resource pays for cards, upgrades, and durable fronts. Fronts trade strength on contact, idle out after 20 captureless ticks, and can be cancelled for a proportional refund. Holding **70% of land wins instantly**. There is no match time limit.
>
> **AI commanders:** 50 bots receive deterministic personalities: aggression, vengeance, caution, conciliation, opportunism, and a five-structure build plan. They retaliate against attackers, avoid stronger or retaliation-capable targets when wary, seek friendly expansion against stronger neighbours when conciliatory, and pile onto already-contested opponents when opportunistic. Threatened bots reserve supply, fortify their border, and rebuild destroyed defenses.
>
> The current build runs **51 states** (1 human + 50 AI) with three switchable growth layers: **circular**, **smooth**, and **organic**. Online multiplayer remains specified but **not wired up**.
>
> **Combat replacement:** the next attack model is proposed in [docs/COMBAT_DESIGN.md](docs/COMBAT_DESIGN.md); it is not implemented. Headless balance data comes from `pnpm telemetry` ([docs/TELEMETRY.md](docs/TELEMETRY.md)).

---

## What this build demonstrates

| Area            | Implementation                                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Frontage v1     | 51 states, durable supply-bought fronts, mutual strength attrition, cancellation/refunds, instant 70% victory                              |
| Large pixel map | 2,097,152 ownership cells rendered from a single GPU control texture, nearest-neighbour sampled, with pixel-grid and terrain shader detail |
| Terrain defense | Six elevation tiers color the map; defense is `1 + elevation + occupied + aura`; Barracks bonus steps scale power and piercing             |
| State auras     | Live capitals project a 16 px field of +20 defense                                                                                         |
| Supply economy  | 90 starting supply, territory/structure income and cap, all five cards always available, repeatable level-scaled builds/upgrades           |
| Bot commanders  | 50 deterministic bots with personalities, build plans, threat detection, defensive reserves, rebuilding, retaliation, and opportunism      |
| Districts       | Bounded owner-local Voronoi districts with noisy extents/borders, type tint/boundaries, district-wide defense auras, same-type stacking    |
| Determinism     | Fixed 10 Hz tick, seeded integer PRNG, stable command order, FNV-1a checksums, deterministic tests                                         |
| Rendering speed | Full-screen WebGPU pass; changed 32 × 32 tiles are merged into strips, with heavy-load full resyncs split across frames to protect input   |
| UI scale        | Virtualized 51-state leaderboard (only visible rows in DOM), 5 Hz HUD snapshots, generated palette, minimap, attack counters, perf readout |
| Onboarding      | Three dismissible first-match hints: launch a front, build a card, upgrade a district; persisted locally                                   |
| Touch           | One-finger pan/tap, two-finger pinch zoom, compact hand/minimap/tool layout                                                                |
| Keyboard        | Arrow-key map cursor, Enter attacks/upgrades, Shift moves faster, Esc clears, live screen-reader status                                    |
| Tooling         | SvelteKit 3 + Svelte 5 + TypeScript, Vitest determinism/stress tests, benchmark + headless telemetry scripts, CI workflow                  |

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
pnpm test       # deterministic + 50-bot stress tests
pnpm bench      # map/tick/checksum benchmark
pnpm telemetry  # headless multi-seed match telemetry
pnpm build      # production build via adapter-node
pnpm preview    # preview the production build
pnpm lint       # Prettier check
pnpm format     # Prettier write
```

## Controls

| Input                       | Action                                                |
| --------------------------- | ----------------------------------------------------- |
| Click / tap a shared border | Buy a durable front with supply                       |
| Click / tap your district   | Upgrade that district's structure with supply         |
| Drag                        | Pan the map                                           |
| Scroll                      | Zoom at the pointer                                   |
| Two-finger pinch            | Zoom on touch                                         |
| Arrow keys / `Enter`        | Move keyboard cursor / attack or upgrade              |
| `X`                         | Cancel latest front                                   |
| `Space`                     | Pause / resume the simulation                         |
| `F` / `C`                   | Fit atlas / return to beachhead                       |
| `H`                         | Open the field manual                                 |
| Minimap click               | Jump the camera                                       |
| Growth switcher             | Select circular / smooth / organic for **new** fronts |
| Drag a build card           | Drop on controlled land to buy/build that structure   |

A click must be on land near a shared border. The simulation reports ocean, own territory, no-shared-border, and insufficient-supply failures.

## How Frontage v1 works

1. Click a target cell near your frontier.
2. The simulation finds up to 96 target-owned cells within 34 px that touch your territory.
3. A launch costs **30 supply + 15 per Barracks bonus step**. Bonus steps are `min(5, ceil(Barracks levels / 2))`.
4. Each front gains durable strength `1500 + 450 × bonus steps`, per-tick power `30 + 15 × bonus steps`, and defense piercing equal to bonus steps. Repeated clicks create separate fronts.
5. Each capture costs `max(1, defense − bonus steps)` from both the per-tick power and the durable strength pool.
6. A front captures connected target-owned pixels while it has power and strength. High ground and occupied land fall more slowly.
7. Every captured pixel must still touch the attacker's territory at capture time. Cut connections discard queued pixels.
8. If a front captures nothing for 20 consecutive ticks, it dies. A clash pause resets the idle counter.
9. **Least resistance:** each capture samples 10 high-priority frontier cells and takes the cheapest local defense.
10. **Cancellation:** cancel the latest front with `X` or the HUD button. Refund = `floor(launchCost × remainingStrength / initialStrength)`.
11. **Mutual fronts attrit:** both sides lose `100 + 50 × opponent bonus steps` strength simultaneously, once per pair per tick. A front at zero dies; the survivor holds the contact line.
12. **Victory:** holding **70% of land** wins immediately. Otherwise the last living state wins. There is no match time limit.
13. **State structures anchor territory:** every component connected to a live State structure is protected from annexation.
14. **Detached land is annexed:** every second, unprotected land touching a foreign protected mainland transfers to the largest shared border owner. Capturing a State destroys its annexation protection.
15. **Small neutral specks are cleaned up:** every 10 seconds, neutral pockets ≤96 cells bordering an owner are filled into the dominant owner.

### Terrain and defense

The map has six discrete elevation tiers: **lowland, plains, hills, highlands, mountains, peaks**. Elevation is part of the generated map, rendered as a green-to-ochre-to-grey-to-snow palette and marked with subtle contour boundaries.

| Property                 | Value                                      |
| ------------------------ | ------------------------------------------ |
| Base defense             | `1 + elevation tier` (1–6)                 |
| Occupied bonus           | `+1`                                       |
| State aura               | `+20` within 16 px, max once               |
| Supply launch cost       | `30 + 15 × Barracks bonus steps`           |
| Durable strength         | `1500 + 450 × bonus steps`                 |
| Power per front per tick | `30 + 15 × bonus steps`                    |
| Capture cost             | `max(1, defense − bonus steps)`            |
| Contact attrition        | `100 + 50 × opponent bonus steps` per tick |
| Command Post             | +2 supply per second                       |
| War Academy              | +40 supply cap                             |

Hovering a land cell updates the compact defense readout beside the card hand; its tooltip shows elevation, base defense, and aura details. Grid reference and target-description panels were removed to keep vertical space clear.

### Growth layers

The HUD selector switches the frontier-selection strategy used by attacks created from the next tick onward. Existing fronts keep the layer they started with, so you can compare layers in the same match.

| Layer        | Behavior                                                                              |
| ------------ | ------------------------------------------------------------------------------------- |
| **Circular** | Euclidean-priority frontier; expands as a digital disc instead of a Manhattan diamond |
| **Smooth**   | Radial bands with concavity filling; suppresses tangent wings and thin spikes         |
| **Organic**  | Deterministic random frontier selection; irregular, organic lobes                     |

Circular and smooth both grow radially from the border and can look similar by design; smooth trades exact circularity for banded concavity filling. Organic is the visually distinct mode.

### Structures

Each state starts with one **State structure** at its capital. It is the anchor for that state's protected mainland: every territory component connected to a live State structure cannot be annexed. The structure is visible as a large owner-colored circle with a cream capital star on the map, and a ringed dot on the minimap.

The State also projects a **16 px defensive aura** that adds **+20 defense** to every land pixel inside it. Overlapping auras use the strongest bonus, not a sum. Aura circles were removed; districts provide the territorial tint instead.

State structures can be captured like any other land cell. The structure is destroyed when its cell changes owner; its aura disappears immediately, and the state keeps its territory but loses annexation protection. The top bar shows the human state's anchored status.

### Build cards

The human commander starts with **90 supply** and **all five build cards** permanently available. Supply income is `min(60, 3 + floor(territory/10000) + structures)` per second; cap is `min(600, 120 + floor(territory/1000) + 40 × War Academy stacks)`. Drag any affordable card into your territory; cards are never consumed. Clicking a district, or dropping a matching card inside it, upgrades one level for **base cost + current level**:

| Card         | Cost | Effect                                                     |
| ------------ | ---- | ---------------------------------------------------------- |
| Mine         | 3    | +1 supply per second                                       |
| Barracks     | 12   | +1 front bonus step per 2 levels, up to +5                 |
| Defense Post | 2    | +5 defense to every friendly pixel in its district; stacks |
| Command Post | 4    | +2 supply per second                                       |
| War Academy  | 6    | +40 supply cap                                             |

There is no deck, draw, or reroll. Built structures are razed when captured.

Defensive auras only protect land owned by the structure's owner. A Defense Post covers its **entire district**, not just a small radius. Barracks is not an aura: every two levels add one bonus step, capped at +5, to all of that owner's fronts.

### Districts

Every buildable structure claims a **district** from its owner's territory. State capitals are aura anchors only; they do not claim a district, so they never lock the whole starting territory out of building:

- districts are a constrained Voronoi split: each owned cell belongs to the nearest eligible structure of that owner;
- a district never crosses an ownership border or exceeds its structure's range;
- districts cannot overlap;
- auras only affect the owning structure's district;
- multiple structures and districts of the same type are allowed;
- dropping the same type inside a district **stacks** onto that district's structure, multiplying its effect;
- dropping the same type outside all districts creates another structure/district;
- a different type cannot be dropped inside any existing district.

| Structure    | District range | Stack effect     |
| ------------ | -------------: | ---------------- |
| Mine         |             32 | +1 income        |
| Barracks     |             44 | +1 order / 2 Lv. |
| Defense Post |             40 | +5 defense       |
| Command Post |             32 | +1 order per 60s |
| War Academy  |             32 | +1 order cap     |

District extents and borders are perturbed by deterministic integer noise: coherent 8 px value noise plus fine jitter makes each district grow or shrink by roughly two pixels and gives Voronoi splits an irregular edge. The geometry follows the actual coverage used by auras and placement.

District pixels receive a subtle structure-type tint, a per-district brightness variant, and darkened boundaries in the WebGPU territory shader. This keeps even adjacent same-type districts distinguishable.

Structures must be at least **8 px apart** (centre to centre); dropping a new type too close to any existing structure is rejected. Structure icons are larger now: 15 px radius for the human State, 11 px for AI States, and 10 px for buildables. These are screen-space sizes, so icons do **not** grow as you zoom in.

The hand is presented as free-floating CCG-style cards at the bottom center, with no enclosing tray and no empty placeholders: cards enter from below, lift on hover, and tilt while dragged. The hand sinks to a semi-hidden peeking strip when the pointer leaves and rises when the pointer returns to it. The native drag ghost is suppressed; a curved accent arrow follows the cursor, and the landing circle shows the 8 px exclusion radius in green or red. Supply, cap, active fronts, cancellation, and hovered defense share a compact panel beside the hand.

The HUD shows **supply / cap** and active fronts. Supply accrues from territory and structures; Mines add +1/s, Command Posts +2/s, War Academies +40 cap. Barracks levels add one front bonus step per two levels (max +5).

This is deliberately provisional. See [docs/EXPERIMENTS.md](docs/EXPERIMENTS.md) for the stress rules and the exit plan.

## Architecture at a glance

```text
Svelte UI (+page.svelte)
  └── GameCanvas.svelte ......... fixed-step driver, pointer input, camera bridge
        ├── TerritorySimulation .. pure deterministic game core
        │     ├── generateMap .... seeded, versioned 2048 × 1024 atlas + 51 starts
        │     ├── TerritoryRng ... mulberry32
        │     ├── growth/ ........ circular / smooth / organic frontier layers
        │     ├── Structures/ .... one file per structure type + registry
        │     ├── integrity.ts ... annexation + neutral-pocket cleanup
        │     └── attacks ........ durable fronts, strength attrition, refunds
        ├── TerritoryRenderer .... WebGPU device, shader, adaptive chunked uploads
        └── MapCamera ............ CSS-pixel camera, zoom, clamping
  └── Minimap.svelte ............ 2D overview, throttled independent redraw
```

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for module responsibilities and data flow.

## Measured baseline

Ballpark figures from the included benchmark on the development machine (Windows, Node 24, headless Chrome with hardware acceleration). Treat them as regression baselines, not universal claims.

| Measurement                               | Result                                               |
| ----------------------------------------- | ---------------------------------------------------- |
| Map generation + 51 starts                | ~235 ms, one-time on world creation                  |
| Default (circular) all-bot attack tick    | ~1.3 ms                                              |
| Smooth-layer all-bot attack tick          | ~1.3 ms                                              |
| Organic-layer all-bot attack tick         | ~1.1 ms                                              |
| Full-state checksum                       | ~18.1 ms (on-demand; includes claim provenance)      |
| Browser render loop with cards + auras    | 142 fps; p99 7.1 ms; isolated cleanup spikes         |
| Upload strategy under stress              | adaptive full-texture chunks: ~21M px/s, ~80 calls/s |
| Full control texture                      | 8 MiB VRAM + 8 MiB CPU shadow                        |
| Node benchmark RSS (all benchmark worlds) | ~303 MiB                                             |

At 10 Hz, the attack-heavy simulation uses roughly 3.7–4.9% of a 100 ms tick budget depending on growth layer. Territory-integrity scans run once per second, with neutral-pocket cleanup every 10 seconds. Panning smoothness is protected by spreading heavy texture uploads across frames and by keeping the 51-row leaderboard virtualized to the visible window. See [docs/PERFORMANCE.md](docs/PERFORMANCE.md).

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
      constants.ts               Frontage/supply rules, 51-state palette/names
      rng.ts                     deterministic PRNG
      map.ts                     map generation and 51 start placement
      simulation.ts              world state, fronts, bots, checksums
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
  EXPERIMENTS.md                 retired EXP-001 history and exit plan
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
- The 51-state leaderboard and AI load are a stress mode, not the shipping match format.
- Online play, accounts, matchmaking, and persistence are specified but not implemented.
- No audio, fog of war, diplomacy, or spectator camera UI.
- Touch pan/tap and two-finger pinch zoom are supported.
- WebGPU is required. There is no WebGL/Canvas2D fallback.
- The simulation runs on the main thread.

## Documentation index

| Document                                     | Read it for                                         |
| -------------------------------------------- | --------------------------------------------------- |
| [docs/SPEC.md](docs/SPEC.md)                 | The canonical game and technical specification      |
| [docs/EXPERIMENTS.md](docs/EXPERIMENTS.md)   | Retired EXP-001 history, findings, and exit plan    |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Code map, data flow, extension points               |
| [docs/DETERMINISM.md](docs/DETERMINISM.md)   | Rules that keep every client in lockstep            |
| [docs/RENDERING.md](docs/RENDERING.md)       | WebGPU pipeline, texture layout, upload batching    |
| [docs/NETWORKING.md](docs/NETWORKING.md)     | Authoritative server, protocol, latency, anti-cheat |
| [docs/PERFORMANCE.md](docs/PERFORMANCE.md)   | Budgets, measured baseline, profiling playbook      |
| [docs/ROADMAP.md](docs/ROADMAP.md)           | Phased plan and acceptance criteria                 |
| [docs/DECISIONS.md](docs/DECISIONS.md)       | Why the stack and engine work this way              |
