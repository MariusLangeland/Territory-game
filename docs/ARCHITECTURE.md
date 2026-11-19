# Architecture

This document describes the code as it exists in v0.1. For intended rules and future online design, read [SPEC.md](SPEC.md) and [NETWORKING.md](NETWORKING.md).

---

## 1. High-level shape

Territory is a client-rendered SvelteKit application with a pure TypeScript simulation core. There is no backend in v0.1. The simulation and renderer are deliberately hard to couple: they exchange a packed change batch after each tick and share immutable map arrays.

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Svelte route: src/routes/+page.svelte                                │
│  - screen state, HUD values, overlays, toasts, seed flow             │
│  - calls camera bridge and simulation.enqueueAttack                  │
│  - receives snapshots 10×/second                                     │
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

| Module                                      | Layer     | Responsibility                                                           | Key exports                  |
| ------------------------------------------- | --------- | ------------------------------------------------------------------------ | ---------------------------- |
| `src/routes/+page.svelte`                   | UI        | Layout, HUD, intro/result/help/error overlays, input commands, seed flow | Svelte component             |
| `src/routes/+page.ts`                       | UI        | Disables SSR; the game is browser-only                                   | `ssr = false`                |
| `src/lib/components/GameCanvas.svelte`      | Driver    | Canvas lifecycle, fixed timestep, pointer handling, camera bridge        | Svelte component             |
| `src/lib/components/Minimap.svelte`         | UI        | 2D owner overview and camera rectangle                                   | Svelte component             |
| `src/lib/game/constants.ts`                 | Rules     | Map size, balance, palette, names, versions                              | constants, helpers           |
| `src/lib/game/rng.ts`                       | Core      | Mulberry32 deterministic PRNG                                            | `DeterministicRng`           |
| `src/lib/game/map.ts`                       | Core      | Seeded map generation, terrain shade, starts                             | `generateMap`, `hash32`      |
| `src/lib/game/simulation.ts`                | Core      | World state, commands, economy, attacks, bots, checksums, snapshots      | `TerritorySimulation`, types |
| `src/lib/game/net/protocol.ts`              | Contract  | Future wire message shapes                                               | message types, guard         |
| `src/lib/game/render/camera.ts`             | Render    | Camera state and coordinate transforms                                   | `MapCamera`                  |
| `src/lib/game/render/camera-bridge.ts`      | UI/Render | Imperative camera actions without component exports                      | `GameCameraBridge`           |
| `src/lib/game/render/territory.wgsl.ts`     | Render    | Vertex and fragment shader source                                        | `TERRITORY_SHADER`           |
| `src/lib/game/render/territory-renderer.ts` | Render    | WebGPU device, textures, pipeline, dirty uploads, frame submission       | `TerritoryRenderer`          |
| `scripts/benchmark.ts`                      | Tooling   | Map/tick/checksum benchmark                                              | CLI                          |

---

## 3. Simulation

### 3.1 State ownership

`TerritorySimulation` is the single source of truth for:

- `owners: Uint16Array` — length 2,097,152; owner id per cell, `0` for unclaimed.
- `land: Uint8Array` — static land mask.
- `shade: Uint8Array` — static terrain brightness for the renderer.
- `players: PlayerState[]` — economy, alive flag, derived frontier sets.
- `attacks: AttackState[]` — BFS queues, seen sets, heads, capture counts.
- `rng: DeterministicRng` — simulation PRNG.
- `tick`, `winnerId`, `ended`.
- Pending command queue and packed change buffer.

The public arrays are exposed read-only-by-convention for the renderer and minimap. Nothing outside the simulation writes to them.

### 3.2 Ownership representation and packing

- Owner values are `1..8`; `Uint16Array` allows headroom for future players.
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

The capacity is far above normal maximum captures (8 players × 3 attacks × 30 = 720 per tick, assuming every attack runs), leaving ample headroom for future capture rates or multiple capture events per cell.

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
 ├─ economy for every living player
 ├─ runBotDecisions() every 10 ticks
 ├─ processAttacks()
 │    ├─ for each attack id: pop BFS cells, claim, drain troops, enqueue neighbours
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
- each player's alive/troops/territory;
- active attack ids, attacker/defender, head, queue length, and remaining queue cells.

It intentionally excludes renderer state, camera, UI, and border sets (derived). It is used in tests and intended for server/client verification. Cost is about 9 ms on the development machine, so it is never run per tick in production.

---

## 4. Map generation

`generateMap(seed)`:

1. Computes a quantised elevation (0–65535) for every cell using five octaves of hashed value noise plus a broad continental signal and edge falloff.
2. Builds a 1024-bin elevation histogram and picks the threshold that yields the target 38% land.
3. Writes the land mask and terrain shade.
4. Chooses eight start points with farthest-point sampling from candidate land cells with sufficient local density.
5. Returns `{ width, height, land, shade, landCount, starts }`.

Start paint uses a ragged disc: a per-cell integer hash perturbs the radius, then cells outside land or already owned are ignored. The initial frontiers are rebuilt afterward by one full scan.

Map generation is the slowest CPU operation (~200 ms) and happens once per world during the loading screen. It is not part of the tick budget.

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

The palette is a 256 × 1 `rgba8unorm` texture where index 0 is unclaimed land and indices 1–8 are player colors.

### 5.3 Dirty uploads

After a tick:

1. For each changed pixel, update the control shadow and mark its 64 × 64 tile dirty using a generation-stamped `Uint32Array`.
2. Clear a small per-tile-row dirty flag array.
3. For each dirty tile row, scan for contiguous dirty tiles and upload one horizontal strip via `queue.writeTexture`.
4. Add the uploaded pixel count to the perf readout.

Why tiles instead of a single dirty rectangle: bot attacks occur across the whole map at once. A single bounding box degenerates to uploading nearly the full 8 MiB texture every tick (observed ~21M px/s). Tile strips reduce this to a few local areas (observed ~0.55–1.0M px/s in normal bot combat).

The full texture is uploaded only on initial load, overflow resync, or GPU reset.

### 5.4 Frame loop

`GameCanvas.svelte` drives `requestAnimationFrame`:

- fixed simulation steps from an accumulator (max 4 per frame, 250 ms catch-up cap);
- consume change batches immediately;
- send snapshots to Svelte;
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

- Svelte state receives immutable snapshots after each tick.
- The simulation object is not deeply reactive.
- The renderer mutates its own control texture/GPU resources outside Svelte reactivity.
- This avoids proxy overhead on multi-megabyte typed arrays.

---

## 7. Memory sketch

| Item                                | Approx. size                         |
| ----------------------------------- | ------------------------------------ |
| Owners (`Uint16Array`)              | 4 MiB                                |
| Land (`Uint8Array`)                 | 2 MiB                                |
| Shade (`Uint8Array`)                | 2 MiB                                |
| Renderer control shadow             | 8 MiB                                |
| GPU map texture                     | 8 MiB                                |
| Palette texture                     | 1 KiB                                |
| Elevation scratch during map gen    | 4 MiB + histogram (transient)        |
| Start candidate land indices        | not retained; temp during generation |
| Frontier sets, attacks, queue cells | small and map-dependent              |
| Svelte DOM/HUD                      | small                                |

The practical JS heap after a world loads is well under the 120 MiB budget. The measured Node RSS for two simulations plus benchmark tooling was ~147 MiB; that number includes Node runtime and two worlds, so it is not the browser working set.

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
5. Never let a client set owner ids or troop counts.

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
