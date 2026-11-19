# Performance

Territory exists because a huge pixel map is only fun if it stays fast. This document records budgets, the current stress baseline, and the profiling playbook.

All numbers are from the development machine unless stated otherwise. They are directional, not guarantees.

> The current build is `EXP-001`: 108 states, free attacks, no economy. This is intentionally harsher than the target game. See [EXPERIMENTS.md](EXPERIMENTS.md).

---

## 1. Targets

| Area                                          | Target                               | Hard fail          |
| --------------------------------------------- | ------------------------------------ | ------------------ |
| Simulation tick, 108 states under attack load | < 2 ms p95                           | > 8 ms p95         |
| Time to interactive                           | < 1.5 s after assets on desktop      | > 3 s              |
| Map generation + 108 starts                   | < 500 ms                             | > 1 s              |
| Render loop                                   | 60 fps at 1600 × 1000 integrated GPU | < 45 fps           |
| Full-frame GPU time                           | < 4 ms at 1440p mid-range            | > 8 ms             |
| Per-tick map upload                           | < 1M pixels under 108-state stress   | full 2.1M per tick |
| Checksum                                      | < 20 ms on demand                    | run per tick       |
| Browser JS/GPU memory                         | < 300 MiB for stress build           | > 500 MiB          |
| Click-to-visible update                       | ≤ 2 ticks                            | > 4 ticks          |

The 10 Hz simulation has a 100 ms budget per tick. It uses ~1.4% under stress; rendering and GPU uploads are the limiting factors.

---

## 2. Current baseline

### 2.1 Node benchmark

Run:

```sh
pnpm bench
```

Environment: Windows, Node.js 24.21, development hardware. Benchmark seeds: `0xbeefcafe` (map), `0x12345678` (sustained all-bot run), `0x87654321` (collision-heavy run). Five map generations, 1,000 sustained stress ticks, 500 collision-heavy ticks, five checksums.

| Operation                                               | Result             |
| ------------------------------------------------------- | ------------------ |
| Generate 2048 × 1024 map + 108 starts                   | **~225–230 ms/op** |
| Sustained all-bot attack tick                           | **~1.4 ms/op**     |
| All-bot attack tick (collision-heavy, 100 ticks warmed) | **~1.4 ms/op**     |
| Full-state checksum                                     | **~8.2 ms/op**     |
| Active attacks after 1,000 / 600 ticks                  | ~200+ fronts       |
| Node RSS (benchmark process, two stress worlds)         | ~198–228 MiB       |

At 10 Hz, 1.3–1.4 ms per tick is roughly **1.3–1.4% of a 100 ms tick budget**. The exact number varies with active fronts and how much of the map is contested.

### 2.2 Browser baseline

Measured in headless Chrome with hardware acceleration, 1600 × 1000, devicePixelRatio 1, seed `1234`:

| Metric                                   | Result                                           |
| ---------------------------------------- | ------------------------------------------------ |
| HUD perf readout under full stress       | 126–132 fps                                      |
| Map uploads during 108-state combat      | ~2.2–4.7M pixels/s (~220K–470K/tick)             |
| Leaderboard                              | 108 rows, scrollable; all states active at start |
| Failed WebGPU initialization             | 0 in supported test browser                      |
| Console/page errors during sustained run | 0                                                |

The upload number depends on how many fronts are active and how dispersed their captured pixels are. This is the worst case for the current renderer, not a normal-play target.

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

### Simulation tick (~1.3–1.4 ms)

- Bots: up to 107 decisions every 10 ticks; frontier sampling.
- Attacks: ~200 active fronts × up to 30 captures, with stale-cell skipping.
- Border maintenance: constant work per captured cell.
- Change packing: one `Uint32Array` write per change.
- Attack queue compaction after 4,096 processed cells.

No per-cell object allocation. Attack queues are `Uint32Array` and rely on ownership changes for duplicate suppression instead of per-attack Sets. The frontier sets are the main derived structure.

Potential hot spots if attack density rises:

- Set operations per claimed cell (remove/add border entries);
- queue growth and duplicates;
- frontier iteration for bot target selection;
- snapshot construction for 108 players.

### Rendering

- One full-screen fragment shader with ~5 texture samples.
- CPU updates proportional to changed pixels.
- GPU uploads proportional to dirty 32 × 32 tiles, not map size.
- Continuous rAF for ocean animation and camera smoothness.
- Minimap sampling is throttled and independent.
- 108 leaderboard rows update at 10 Hz.

### GPU uploads

The stress build changes thousands of pixels per tick across hundreds of local fronts. Marking 32 × 32 tiles and merging horizontal runs keeps uploads local. The observed full-stress rate ranges from ~2.2M pixels/s at 157 active fronts to ~4.7M pixels/s near saturation.

An earlier naive implementation used a single dirty rectangle for all attackers and uploaded ~21M pixels/s because attacks were spread across continents. Tile strips fixed that. Replacing per-attack Set bookkeeping with packed queues also cut memory drastically.

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
| Attack queues                           | ~4 bytes per live queue entry       |
| Svelte DOM/HUD                          | 108 leaderboard rows, small         |
| Node benchmark RSS (two worlds)         | ~198–228 MiB                        |

Earlier per-attack `Set<number>` + JS array queues produced ~529 MiB for the same benchmark. Packed queues and ownership-based dedup brought that down to ~198–228 MiB depending on the run. Browser memory should be measured separately before shipping.

---

## 5. Profiling playbook

### Simulation

1. Run `pnpm bench` for a quick regression check.
2. Use a CPU profile around `TerritorySimulation.step()`.
3. Record active attacks, changes per tick, queue cells, and frontier size.
4. Watch allocation/GC when changing attack queue logic.
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
4. **Do not upload a global bounding rectangle for distributed changes.**
5. **Do not add per-attack Sets if typed queues can avoid them.**
6. **Do not perform a checksum every tick.**
7. **Do not add `Math.random` or frame-dependent simulation logic.**
8. **Benchmark before/after.** Record hardware and test conditions.
9. **Keep rendering and simulation decoupled.**
10. **Do not mistake this stress baseline for the shipping performance target.**
11. **Measure the browser, not only Node.** Upload/GPU cost dominates here.

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
- [ ] Browser perf readout shows local tile uploads, not a full texture per tick.
- [ ] At 1600 × 1000, gameplay is smooth while panning/zooming under attack load.
- [ ] Pausing does not leave a busy simulation loop.
- [ ] Memory does not grow per tick (queues, marks, frontier sets).
- [ ] 108 leaderboard rows remain usable.
- [ ] The build still clearly identifies itself as an attack experiment.

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
