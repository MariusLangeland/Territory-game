# Performance

Territory exists because a huge pixel map is only fun if it stays fast. This document records budgets, the current baseline, and the profiling playbook used to protect them.

All numbers are from the development machine unless stated otherwise. They are directional, not guarantees.

---

## 1. Targets

| Area                    | Target                               | Hard fail          |
| ----------------------- | ------------------------------------ | ------------------ |
| Simulation tick         | < 2 ms p95 normal 8-state mid-game   | > 8 ms p95         |
| Time to interactive     | < 1.5 s after assets on desktop      | > 3 s              |
| Map generation          | < 500 ms                             | > 1 s              |
| Render loop             | 60 fps at 1600 × 1000 integrated GPU | < 45 fps           |
| Full-frame GPU time     | < 4 ms at 1440p mid-range            | > 8 ms             |
| Per-tick map upload     | < 200K pixels typical                | full 2.1M per tick |
| Checksum                | < 20 ms on demand                    | run per tick       |
| JS heap for match       | < 120 MiB                            | > 300 MiB          |
| Click-to-visible update | ≤ 2 ticks                            | > 4 ticks          |

The 10 Hz simulation has a 100 ms budget per tick. It uses a small fraction today; rendering and GPU uploads are the limiting factors.

---

## 2. Current baseline

### 2.1 Node benchmark

Run:

```sh
pnpm bench
```

Environment: Windows, Node.js 24.21, development hardware. Benchmark uses seeds `0xbeefcafe` (map), `0x12345678` (idle), `0x87654321` (mid-match). Five map generations, 1,000 idle ticks, 500 mid-match ticks, five checksums.

| Operation                                            | Result               |
| ---------------------------------------------------- | -------------------- |
| Generate 2048 × 1024 map                             | **~200–210 ms/op**   |
| Idle simulation tick                                 | **~0.075 ms/op**     |
| Mid-match simulation tick (8 states, bots attacking) | **~0.06–0.07 ms/op** |
| Full-state checksum                                  | **~8.9 ms/op**       |
| Node RSS (benchmark process, two worlds)             | ~142–147 MiB         |

At 10 Hz, 0.06–0.08 ms per tick is roughly **0.06–0.08% of a 100 ms tick budget**; the measured map generation result was 208.8 ms in the final run. The exact number varies with how many attacks are active; a contested late-game map should be measured again once bots can reach most of the map.

### 2.2 Browser baseline

Measured in headless Chrome with hardware acceleration, 1600 × 1000, devicePixelRatio 1, seed `1234`:

| Metric                        | Result                              |
| ----------------------------- | ----------------------------------- |
| rAF ceiling                   | 144 fps                             |
| HUD perf readout              | 144 FPS                             |
| Map uploads during bot combat | ~0.55–1.0M pixels/s (~55–100K/tick) |
| Failed WebGPU initialization  | 0 in supported test browser         |

The upload number depends on how many bot attacks are active and how spread out they are; a busier screenshot run with three human attacks and active bots reached ~1.0M pixels/s. In an earlier naive implementation, a single dirty rectangle for all bots uploaded ~21M pixels/s because each bot fought on a different continent. Tile-based dirty uploads fixed this.

### 2.3 What these numbers do not cover

- Late-game maps with hundreds of thousands of owned cells and maximal attack activity.
- A 4K display with DPR 2 (the renderer caps DPR at 2).
- Integrated GPUs on low-power laptops.
- Browser tab throttling/background behavior.
- Multiple clients plus server networking.
- Memory profiling in the browser heap (only Node RSS was observed).

Add measurements before claiming these are solved.

---

## 3. Where the time goes

### Map generation (one-time, ~200 ms)

- 2.1M elevation computations with five noise octaves.
- Histogram scan.
- 2.1M land/shade writes.
- Start selection + initial border rebuild.

It runs once on world creation and is hidden by the loading screen. Do not run it during a live tick.

Potential optimizations if needed:

- generate elevation at half resolution and upsample;
- pre-bake maps as assets;
- move generation to a worker so the intro paints sooner.

### Simulation tick (~0.06–0.08 ms)

- Economy: 8 players.
- Bots: up to 8 decisions every 10 ticks; frontier sampling.
- Attacks: up to 24 active attacks × up to 30 captures.
- Border maintenance: constant work per captured cell.
- Change packing: one `Uint32Array` write per change.

No per-cell object allocation. No sorting of the full map. The frontier sets are the only nontrivial derived structure.

Potential hot spots if capture rates rise:

- Set operations per claimed cell (remove/add border entries);
- BFS queue growth;
- frontier iteration for bot target selection;
- per-tick snapshot construction.

### Rendering

- One full-screen fragment shader with ~5 texture samples.
- CPU updates proportional to changed pixels.
- GPU uploads proportional to dirty tiles, not map size.
- Continuous rAF because of ocean animation and smooth camera.
- Minimap sampling is throttled and independent.

### GPU uploads

The key performance decision is to never upload a global dirty rectangle. Tiles bound the damage; strip merging reduces the number of `writeTexture` calls. The control shadow is updated in place with no allocation per tick.

---

## 4. Memory

| Item                             | Approx.                                             |
| -------------------------------- | --------------------------------------------------- |
| Owner grid                       | 4 MiB                                               |
| Land mask                        | 2 MiB                                               |
| Terrain shade                    | 2 MiB                                               |
| Elevation scratch during map gen | 4 MiB (transient)                                   |
| CPU control shadow               | 8 MiB                                               |
| GPU map texture                  | 8 MiB                                               |
| Canvas backing buffer            | width × height × 4, capped by DPR 2                 |
| Player state / sets / attacks    | map-dependent, small at spawn, grows with territory |
| Svelte DOM/HUD                   | small                                               |

A live desktop match should stay well below 120 MiB of added JS heap plus GPU memory. Re-measure if map dimensions, player count, or per-cell metadata grows.

---

## 5. Profiling playbook

### Simulation

1. Run `pnpm bench` for a quick regression check.
2. Use a CPU profile around `TerritorySimulation.step()`.
3. Check active attack count and captured cells in the tick.
4. Watch allocation via heap sampling when changing attack queue logic.
5. Never profile with rendering included when the question is simulation cost.

### Rendering

1. Open the in-game perf readout (FPS + px/s).
2. Use Chrome DevTools Performance for main-thread cost.
3. Use a WebGPU timestamp-query build for GPU times.
4. Compare the same camera, zoom, tick, and map.
5. Test idle map vs heavy combat vs panning vs full-map fit.
6. Test both DPR 1 and DPR 2.

### Uploads

- Inspect `uploadedPixels` after one tick.
- Temporarily instrument tile counts if needed.
- If uploads spike, check whether attacks are spread across the map and whether strip merging is working.
- A full upload should only occur on initial load or overflow.

### Browser/GPU

- Confirm hardware acceleration is on.
- Check adapter/device creation time.
- Test on a low-power integrated GPU rather than only the dev workstation.
- Use `--enable-unsafe-webgpu` only when a browser needs it for testing; it is not a production assumption.

---

## 6. Performance guardrails for contributors

1. **Do not add per-cell object allocation.** Use typed arrays or flat numeric arrays.
2. **Do not iterate the full 2M-cell map per tick.** If you need a global operation, make it on-demand or incremental.
3. **Do not create a new GPU texture per update.** Reuse the control texture.
4. **Do not upload a global bounding rectangle for distributed changes.** Mark tiles.
5. **Do not perform checksum every tick.** It is 9 ms; use a configurable interval.
6. **Do not add `Math.random` or frame-dependent simulation logic.**
7. **Benchmark before and after.** Include hardware and test conditions in the PR/commit notes.
8. **Keep rendering and simulation decoupled.** A rendering change should not alter tick timing semantics.
9. **Cap DPR.** Full-frame fragment cost scales with pixels.
10. **Profile on a mid-range GPU.** The dev GPU is not the target.

---

## 7. Scaling considerations

### More players

- Public player list grows linearly; 8 → 32 is still small.
- Frontier sets and attacks grow.
- Snapshot construction and leaderboard sort are small.
- The owner grid does not grow. Update processing stays proportional to changes.

### Larger maps

- Owner + control textures scale linearly; 4096 × 4096 would be 32 MiB CPU + 32 MiB GPU for RGBA control, plus owners.
- Texture limits and max texture dimension become constraints.
- Tiling by map chunk may be needed for culling and partial residency.
- Map generation cost grows linearly unless optimized/pre-baked.

### More frequent ticks

- 10 Hz is currently cheap. 20 Hz would double simulation and snapshot/UI churn.
- Rendering can stay at 60/144 fps while the simulation ticks at a lower rate.
- Network bandwidth and input latency policy need reconsideration per tick rate.

### Online scale

- Server tick time and event-loop lag matter more than client GPU once rooms are hosted together.
- Room isolation becomes important when one room's 24 attacks starve another room.
- Use per-room metrics and load tests before multi-room-per-process assumptions.

---

## 8. Regression checklist

Before merging a performance-sensitive change:

- [ ] `pnpm check` passes.
- [ ] `pnpm test` passes.
- [ ] `pnpm bench` numbers are recorded and not regressed without explanation.
- [ ] Browser perf readout shows no full-texture uploads during normal combat.
- [ ] Map upload count remains local (not a global bounding box).
- [ ] At 1600 × 1000, gameplay is smooth while panning and zooming.
- [ ] Pausing does not leave the renderer in a busy loop that starves input.
- [ ] Memory does not grow per tick (no leak in change buffers, tile marks, or attack queues).
- [ ] Mobile/narrow layout does not multiply canvases or duplicate renderers.

---

## 9. Future optimizations (ranked)

1. Move the simulation to a Web Worker to isolate tick work from rendering/UI.
2. Add render-on-demand idle mode with a frozen ocean animation.
3. Adaptive DPR/resolution based on frame time.
4. Pre-baked/compressed maps to cut the 200 ms generation and remove map-gen portability risk.
5. Worker-side minimap generation.
6. Better strip merging (vertical merges or larger tiles) if tile calls become a bottleneck.
7. GPU timestamp queries and automated benchmarks on CI hardware.
8. Consider WebGL2 fallback only if support data justifies the cost.
