# Performance

Territory exists because a huge pixel map is only fun if it stays fast. This document records budgets, the current stress baseline, and the profiling playbook.

All numbers are from the development machine unless stated otherwise. They are directional, not guarantees.

> The current build is `EXP-001`: 108 states, free attacks, no economy. This is intentionally harsher than the target game. See [EXPERIMENTS.md](EXPERIMENTS.md).

---

## 1. Targets

| Area                                          | Target                                  | Hard fail                     |
| --------------------------------------------- | --------------------------------------- | ----------------------------- |
| Simulation tick, circular/organic, 108 states | < 2 ms p95                              | > 8 ms p95                    |
| Simulation tick, smooth, 108 states           | < 3 ms p95                              | > 8 ms p95                    |
| Time to interactive                           | < 1.5 s after assets on desktop         | > 3 s                         |
| Map generation + 108 starts                   | < 500 ms                                | > 1 s                         |
| Render loop                                   | 60 fps at 1600 × 1000 integrated GPU    | < 45 fps                      |
| Full-frame GPU time                           | < 4 ms at 1440p mid-range               | > 8 ms                        |
| Tick-boundary upload work                     | < 2 ms main-thread; full resync chunked | one synchronous full-map call |
| Panning under 200+ fronts                     | no frame >10 ms above the rAF baseline  | periodic 10 Hz hitches        |
| Checksum                                      | < 20 ms on demand                       | run per tick                  |
| Browser JS/GPU memory                         | < 300 MiB for stress build              | > 500 MiB                     |
| Click-to-visible update                       | ≤ 2 ticks                               | > 4 ticks                     |

The 10 Hz simulation has a 100 ms budget per tick. It uses ~1.7–2.6% under stress depending on growth layer; rendering and GPU uploads are the limiting factors.

---

## 2. Current baseline

### 2.1 Node benchmark

Run:

```sh
pnpm bench
```

Environment: Windows, Node.js 24.21, development hardware. Benchmark seeds: `0xbeefcafe` (map), `0x12345678` (sustained all-bot run), `0x87654321` (collision-heavy run), `0x13572468` (growth-layer comparison). Five map generations, 1,000 sustained stress ticks, 500 collision-heavy ticks, 300 ticks per growth layer, five checksums.

| Operation                                               | Result          |
| ------------------------------------------------------- | --------------- |
| Generate 2048 × 1024 map + 108 starts                   | **~226 ms/op**  |
| Sustained all-bot attack tick (default circular)        | **~1.7 ms/op**  |
| All-bot attack tick (collision-heavy, 100 ticks warmed) | **~1.8 ms/op**  |
| Circular layer comparison tick                          | **~1.7 ms/op**  |
| Smooth layer comparison tick                            | **~2.6 ms/op**  |
| Organic layer comparison tick                           | **~1.7 ms/op**  |
| Full-state checksum                                     | **~8.7 ms/op**  |
| Active attacks after sustained run                      | ~150–200 fronts |
| Node RSS (all benchmark simulations)                    | ~312 MiB        |

At 10 Hz, 1.7–2.6 ms per tick is roughly **1.7–2.6% of a 100 ms tick budget**. The exact number varies with active fronts, mode, and how much of the map is contested. Smooth is the most expensive layer because it scores nearby candidates for attacker-neighbour count.

### 2.2 Browser baseline

Measured in headless Chrome with hardware acceleration, 1600 × 1000, devicePixelRatio 1, seed `1234`:

| Metric                                   | Result                                                                 |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| Panning at 144 fps under ~209 fronts     | median 6.9 ms, p99 7.1 ms, max 7.2 ms, **0 frames >10 ms**             |
| Map uploads under full stress            | ~21M pixels/s, ~80 writeTexture calls/s (adaptive chunked full resync) |
| HUD snapshots                            | 5 Hz (territory still renders at 10 Hz)                                |
| Leaderboard                              | 108 logical rows; only ~19 visible DOM rows are mounted (virtualized)  |
| Failed WebGPU initialization             | 0 in supported test browser                                            |
| Console/page errors during sustained run | 0                                                                      |

The upload strategy intentionally trades bandwidth for input smoothness under extreme load: once dirty tiles exceed 96, the renderer schedules a full-texture resync split into 8 horizontal chunks, at most 2 chunks per frame. Uploading one contiguous 8 MiB texture is far cheaper for the main thread than hundreds of tiny texture writes. At lower action, the normal 32 × 32 dirty-tile path is used.

The leaderboard virtualization is just as important: updating 108 Svelte rows at 5 Hz produced ~14 ms tick-boundary frames; mounting only the visible slice removed those. The HUD clock/values update at 5 Hz while map rendering remains per-tick.

### 2.3 What these numbers do not cover

- The final target match size or economy-throttled combat load.
- A 4K display with DPR 2 (the renderer caps DPR at 2).
- Integrated GPUs on low-power laptops.
- Browser tab throttling/background behavior.
- Multiple clients plus server networking.
- Memory profiling in the browser heap (only Node RSS was observed).
- Long-running matches after territories stabilize.

Add measurements before claiming these are solved.

---

## 3. Where the time goes

### Map generation (one-time, ~220–230 ms)

- 2.1M elevation computations with five noise octaves.
- Histogram scan.
- 2.1M land/shade writes.
- Sampling ~6,900 candidate starts, farthest-point selection for 108 starts, initial paint, and full border rebuild.

It runs once on world creation and is hidden by the loading screen. Do not run it during a live tick.

Potential optimizations if needed:

- generate elevation at half resolution and upsample;
- pre-bake maps/assets;
- move generation to a worker.

### Simulation tick (~1.7–2.6 ms)

- Bots: up to 107 decisions every 10 ticks; frontier sampling.
- Attacks: ~150–200 active fronts × up to 30 captures, with stale-cell skipping.
- Growth-layer selection: heap operations for circular, sector and neighbour scoring for smooth, RNG array swaps for organic.
- Border maintenance: constant work per captured cell.
- Change packing: one `Uint32Array` write per change.
- No attack queue compaction; frontiers are lifetime-bounded.

No per-cell object allocation. Attack frontiers use flat arrays/heaps and rely on ownership changes for duplicate suppression instead of per-attack Sets. The frontier sets are the main derived structure.

Potential hot spots if attack density rises:

- Set operations per claimed cell (remove/add border entries);
- frontier growth and duplicates;
- smooth-layer neighbour scoring across many candidates;
- frontier iteration for bot target selection;
- snapshot construction for 108 players.

### Rendering

- One full-screen fragment shader with ~5 texture samples.
- CPU control-texture writes proportional to changed pixels.
- Normal uploads use 32 × 32 dirty tiles merged into strips.
- Dense, dispersed updates switch to a chunked full-texture resync (8 chunks, max 2 per frame).
- Continuous rAF for ocean animation and smooth camera input.
- Minimap sampling is throttled and independent.
- HUD snapshots update at 5 Hz; the leaderboard mounts only the visible window.

### GPU uploads / input latency

The stress build changes thousands of pixels per tick across hundreds of local fronts. The first tile-only uploader produced ~2,169 `writeTexture` calls/s and ~28 ms max panning frames. A single full upload reduced calls to ~10/s but still produced 12–14 ms tick-boundary stalls. The final strategy splits a full upload across frames:

1. Collect tick changes into the CPU shadow.
2. If >96 dirty tiles, queue a full-texture resync.
3. Upload at most two horizontal chunks (1 MiB each) per rendered frame.
4. Keep drawing frames while chunks arrive; visuals catch up within a few frames.

Combined with HUD throttling and leaderboard virtualization, this yielded 144 fps panning with zero frames over 10 ms under ~209 fronts. The cost is higher upload bandwidth (~21M pixels/s) during saturation. That trade is intentional because input smoothness is the requirement.

Replacing per-attack Set bookkeeping with flat frontier structures also cut memory drastically.

---

## 4. Memory

| Item                                    | Approx.                             |
| --------------------------------------- | ----------------------------------- |
| Owner grid                              | 4 MiB                               |
| Land mask                               | 2 MiB                               |
| Terrain shade                           | 2 MiB                               |
| Elevation scratch during map generation | 4 MiB (transient)                   |
| CPU control shadow                      | 8 MiB                               |
| GPU map texture                         | 8 MiB                               |
| Canvas backing buffer                   | width × height × 4, capped by DPR 2 |
| Frontier sets (108 states)              | map-dependent                       |
| Growth frontier candidates              | layer-dependent, lifetime-bounded   |
| Svelte DOM/HUD                          | ~19 virtualized leaderboard rows    |
| Node benchmark RSS (five worlds)        | ~312 MiB                            |

Earlier per-attack `Set<number>` + JS array queues produced ~529 MiB for the same benchmark. Packed/array frontiers and ownership-based duplicate handling brought that down substantially; the current benchmark runs five worlds and measures ~312 MiB. Browser memory should be measured separately before shipping.

---

## 5. Profiling playbook

### Simulation

1. Run `pnpm bench` for a quick regression check.
2. Use a CPU profile around `TerritorySimulation.step()`.
3. Record active attacks, changes per tick, and frontier size per layer.
4. Watch allocation/GC when changing attack frontier logic.
5. Do not include rendering when measuring simulation cost.

### Rendering

1. Read the in-game FPS and px/s.
2. Use Chrome DevTools Performance for the main thread.
3. Use a WebGPU timestamp-query build for GPU times.
4. Compare the same camera, zoom, tick, and map.
5. Test idle map vs heavy combat vs full-map fit.
6. Test DPR 1 and DPR 2.
7. Verify write-call counts if changing tile size or strip merging.

### Browser/GPU

- Confirm hardware acceleration.
- Check adapter/device creation time.
- Test on a low-power integrated GPU.
- Do not use `--enable-unsafe-webgpu` as a production assumption.

---

## 6. Guardrails for contributors

1. **Do not add per-cell object allocation.** Use typed arrays/flat numeric arrays.
2. **Do not iterate the full 2M-cell map per tick.**
3. **Do not create a new GPU texture per update.**
4. **Do not synchronously upload the full map on the input path.** If dense changes need a resync, chunk it across frames.
5. **Do not add per-attack Sets if flat frontier storage can avoid them.**
6. **Do not perform a checksum every tick.**
7. **Do not add `Math.random` or frame-dependent simulation logic.**
8. **Benchmark before/after.** Record hardware and test conditions.
9. **Keep rendering and simulation decoupled.**
10. **Do not mistake this stress baseline for the shipping performance target.**
11. **Measure the browser, not only Node.** Upload/GPU cost dominates here.
12. **Keep leaderboard DOM small.** Virtualize long lists; do not mount all 108 rows if only ~19 are visible.

---

## 7. Scaling considerations

### More simultaneous fronts

- Queue memory grows with active fronts.
- Dirty upload area grows with dispersed fronts.
- The active-front cap is currently the main bound.
- The final attack design will decide whether this load profile is acceptable.

### More players

- Public player list and leaderboard DOM grow linearly; 108 is still small.
- Frontier sets/attacks grow.
- The owner grid does not grow.
- Leaderboard virtualization may become worthwhile above ~100 rows.

### Larger maps

- Owner/control textures scale linearly; 4096 × 4096 would be 32 MiB CPU + 32 MiB GPU control plus owner arrays.
- Texture limits and map generation cost become constraints.
- Tiling/chunking may be required.

### More frequent ticks

- 10 Hz is cheap; 20 Hz doubles simulation and snapshot churn.
- Rendering can remain at 60/144 fps.

### Online scale

- Server tick time and event-loop lag matter once rooms share processes.
- Room isolation becomes important if one stress room starves others.
- Network deltas for hundreds of fronts need compact encoding.

---

## 8. Regression checklist

Before merging a performance-sensitive change:

- [ ] `pnpm check` passes.
- [ ] `pnpm test` passes.
- [ ] `pnpm bench` recorded; no unexplained regression.
- [ ] Browser perf readout shows modest write-call rates; dense full-resync chunks are spread across frames.
- [ ] At 1600 × 1000, gameplay is smooth while panning/zooming under attack load.
- [ ] Pausing does not leave a busy simulation loop.
- [ ] Memory does not grow per tick (frontiers, marks, frontier sets).
- [ ] 108 leaderboard rows remain usable.
- [ ] The build still clearly identifies itself as an attack experiment.
- [ ] Drag-pan under ~200 fronts stays free of recurring 10 Hz hitches.
- [ ] All three growth layers were sampled in `pnpm bench`; smooth remains within its 3 ms budget.

---

## 9. Future optimizations (ranked)

1. Decide the final attack model so load can be bounded by design, not only caps.
2. Adaptive tile size or per-front dirty regions if upload calls become limiting.
3. Move simulation to a Web Worker.
4. Render-on-demand idle mode.
5. Adaptive DPR/resolution.
6. Pre-baked maps to remove generation cost and portability risk.
7. Virtualize/harden the 108-state leaderboard.
8. GPU timestamp queries and automated performance gates.
9. WebGL2 fallback only if support data justifies it.
