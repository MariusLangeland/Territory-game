# Architecture

This document describes the code as it exists in v0.2. For current rules, the attack experiment, and future online design, read [SPEC.md](SPEC.md), [EXPERIMENTS.md](EXPERIMENTS.md), and [NETWORKING.md](NETWORKING.md).

---

## 1. High-level shape

Territory is a client-rendered SvelteKit application with a pure TypeScript simulation core. There is no backend in v0.2. The simulation and renderer are deliberately hard to couple: they exchange a packed change batch after each tick and share immutable map arrays.

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
│  - players, attacks, RNG     │              │  - palette / uniforms   │
│  - no DOM, no clock          │              │  - WGSL pass            │
└──────────────────────────────┘              └─────────────────────────┘
```

`Minimap.svelte` reads the simulation arrays and camera view independently to paint a throttled 2D overview.

---

## 2. Module map

| Module                                      | Layer     | Responsibility                                                                | Key exports                  |
| ------------------------------------------- | --------- | ----------------------------------------------------------------------------- | ---------------------------- |
| `src/routes/+page.svelte`                   | UI        | Layout, HUD, intro/result/help/error overlays, input commands, seed flow      | Svelte component             |
| `src/routes/+page.ts`                       | UI        | Disables SSR; the game is browser-only                                        | `ssr = false`                |
| `src/lib/components/GameCanvas.svelte`      | Driver    | Canvas lifecycle, fixed timestep, pointer handling, camera bridge             | Svelte component             |
| `src/lib/components/Minimap.svelte`         | UI        | 2D owner overview and camera rectangle                                        | Svelte component             |
| `src/lib/game/constants.ts`                 | Rules     | Map size, balance, palette, names, versions                                   | constants, helpers           |
| `src/lib/game/rng.ts`                       | Core      | Mulberry32 deterministic PRNG                                                 | `DeterministicRng`           |
| `src/lib/game/map.ts`                       | Core      | Seeded map generation, terrain shade, starts                                  | `generateMap`, `hash32`      |
| `src/lib/game/simulation.ts`                | Core      | World state, free attacks, bots, checksums, snapshots                         | `TerritorySimulation`, types |
| `src/lib/game/net/protocol.ts`              | Contract  | Future wire message shapes                                                    | message types, guard         |
| `src/lib/game/render/camera.ts`             | Render    | Camera state and coordinate transforms                                        | `MapCamera`                  |
| `src/lib/game/render/camera-bridge.ts`      | UI/Render | Imperative camera actions without component exports                           | `GameCameraBridge`           |
| `src/lib/game/render/territory.wgsl.ts`     | Render    | Vertex and fragment shader source                                             | `TERRITORY_SHADER`           |
| `src/lib/game/render/territory-renderer.ts` | Render    | WebGPU device, textures, pipeline, adaptive chunked uploads, frame submission | `TerritoryRenderer`          |
| `scripts/benchmark.ts`                      | Tooling   | Map/tick/checksum benchmark                                                   | CLI                          |

---

## 3. Simulation

### 3.1 State ownership

`TerritorySimulation` is the single source of truth for:

- `owners: Uint16Array` — length 2,097,152; owner id per cell, `0` for unclaimed.
- `land: Uint8Array` — static land mask.
- `shade: Uint8Array` — static terrain brightness for the renderer.
- `players: PlayerState[]` — alive flag, territory count, derived frontier sets.
- `attacks: AttackState[]` — growable `Uint32Array` BFS queues, heads, capture counts.
- `rng: DeterministicRng` — simulation PRNG.
- `tick`, `winnerId`, `ended`.
- Pending command queue and packed change buffer.

The public arrays are exposed read-only-by-convention for the renderer and minimap. Nothing outside the simulation writes to them.

### 3.2 Ownership representation and packing

- Owner values are `1..108`; `Uint16Array` allows headroom for future player counts.
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
- The driver calls `renderer.applyChanges(result.changes, result.changeCount, result.changesOverflow)` before the next tick.
- If the buffer overflows, the renderer does a full control-texture rebuild. Game state is unaffected.

In the 108-state stress build, the technical caps allow roughly 219 active fronts (107 bots × 2 + 3 human) × 30 captures ≈ 6,570 changes per tick. That still fits comfortably in the 16,384-word buffer. Stress tests assert no overflow during sustained runs.

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
 ├─ applyPendingCommands()
 │    └─ sort by (sequence, playerId), validate, create attacks
 ├─ runBotDecisions() every 10 ticks
 ├─ processAttacks()
 │    ├─ for each attack id: pop BFS cells, claim up to 30, enqueue valid neighbours
 │    ├─ skip stale cells without spending the capture budget
 │    ├─ compact processed queue entries after 4,096
 │    └─ drop completed attacks
 ├─ updateEliminations()
 ├─ checkVictory()
 └─ buildSnapshot()
```

No rendering, DOM, timers, or promises are present in this path.

### 3.6 Commands

Current command type:

```ts
interface AttackCommand {
	type: 'attack';
	playerId: number;
	x: number;
	y: number;
	sequence: number;
}
```

`enqueueAttack` performs cheap validation and queues. The authoritative creation still happens inside the next `step()`, where state may have changed. This separation is the model for future network intents.

### 3.7 Snapshots

`GameSnapshot` contains only serializable UI data:

- tick, seed, land counts, claimed land;
- public player records;
- active attacks;
- winner/ended/human id.

The UI never receives frontier sets, queue internals, or the PRNG.

### 3.8 Checksum

`checksum()` is an FNV-1a hash over:

- tick, RNG state, next attack id, ended/winner;
- every owner cell;
- each player's alive flag and territory;
- active attack ids, attacker/defender, head, queue length, and remaining queue cells.

It intentionally excludes renderer state, camera, UI, and border sets (derived). It is used in tests and intended for server/client verification. Cost is about 9 ms on the development machine, so it is never run per tick in production.

---

## 4. Map generation

`generateMap(seed)`:

1. Computes a quantised elevation (0–65535) for every cell using five octaves of hashed value noise plus a broad continental signal and edge falloff.
2. Builds a 1024-bin elevation histogram and picks the threshold that yields the target 38% land.
3. Writes the land mask and terrain shade.
4. Chooses 108 start points with optimized farthest-point sampling from candidate land cells, enforcing a 34-cell preferred spacing.
5. Returns `{ width, height, land, shade, landCount, starts }`.

Start paint uses a ragged disc of radius ~16: a per-cell integer hash perturbs the radius, then cells outside land or already owned are ignored. A fallback ensures every state receives at least one land pixel. The initial frontiers are rebuilt afterward by one full scan.

Map generation with 108 starts is the slowest CPU operation (~220–230 ms) and happens once per world during the loading screen. It is not part of the tick budget.

### Attack queue representation

Each active attack owns a growable `Uint32Array` plus `head`/`queueLength` counters. Captured cells change ownership, so a separate visited `Set` is unnecessary: duplicate queue entries fail the owner check. Queues compact after 4,096 processed cells and shrink their capacity when possible. This replaced per-attack number arrays plus Sets, reducing benchmark RSS from ~529 MiB to ~198–228 MiB with two worlds.

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
| A       | Unused (`255`)                    |

The palette is a 256 × 1 `rgba8unorm` texture. Index 0 is unclaimed land; indices 1–108 are player colors. The first eight colors are hand-picked and the rest are generated on a golden-angle hue wheel.

### 5.3 Dirty uploads

After a tick:

1. For each changed pixel, update the control shadow and mark its 32 × 32 tile dirty using a generation-stamped `Uint32Array`.
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
- The leaderboard is virtualized to the visible row window (~19 rows), so 108 logical states do not become 108 live DOM rows.
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
| Frontier sets (108 states)               | map-dependent                        |
| Attack queues (packed `Uint32Array`)     | ~4 bytes per live queue entry        |
| Svelte DOM/HUD (virtualized leaderboard) | small                                |

The measured Node RSS for two stress simulations plus benchmark tooling is ~198–228 MiB. That includes the Node runtime and two worlds and is not the browser working set. Earlier per-attack `Set` bookkeeping produced ~529 MiB for the same benchmark; packed queues and ownership-based duplicate handling removed most of that overhead.

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
- Bot behavior is intentionally simple: no strategic target selection, no coordinated attacks, no defense logic.
- The 108-state free-attack mode is an experiment. Economy and final attack semantics are intentionally absent.
- The virtualized leaderboard mounts only the visible window plus overscan; rank numbers remain absolute.
- Upload volume in a fully active 108-state map is intentionally higher in exchange for smooth input under saturation.
