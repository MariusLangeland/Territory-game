# Performance

Territory exists because a huge pixel map is only fun if it stays fast. This document records budgets, the current stress baseline, and the profiling playbook.

All numbers are from the development machine unless stated otherwise. They are directional, not guarantees.

> The current build is Frontage v1. The 51-state all-bot stress configuration remains the harshest benchmark and is intentionally harsher than the target match.

---

## 1. Targets

| Area                                         | Target                                  | Hard fail                     |
| -------------------------------------------- | --------------------------------------- | ----------------------------- |
| Simulation tick, circular/organic, 51 states | < 5 ms p95                              | > 10 ms p95                   |
| Simulation tick, smooth, 51 states           | < 7 ms p95                              | > 10 ms p95                   |
| Time to interactive                          | < 1.5 s after assets on desktop         | > 3 s                         |
| Map generation + 51 starts                   | < 500 ms                                | > 1 s                         |
| Render loop                                  | 60 fps at 1600 × 1000 integrated GPU    | < 45 fps                      |
| Full-frame GPU time                          | < 4 ms at 1440p mid-range               | > 8 ms                        |
| Tick-boundary upload work                    | < 2 ms main-thread; full resync chunked | one synchronous full-map call |
| Panning under 200+ fronts                    | p99 <8 ms; isolated spikes ≤15 ms       | periodic 10 Hz hitches        |
| Checksum                                     | < 25 ms on demand                       | run per tick                  |
| Browser JS/GPU memory                        | < 300 MiB for stress build              | > 500 MiB                     |
| Click-to-visible update                      | ≤ 2 ticks                               | > 4 ticks                     |

The Evolution Lab runs its entire sandbox and match loop in a Web Worker. The worker steps under an 8 ms frame budget and posts visual updates at up to roughly 60 Hz; the main thread only applies those deltas, renders, and handles camera/input. At most one visual is in flight: the worker waits for the renderer to apply it and acknowledge before sending the next, coalescing changes (or falling back to a full owner snapshot) while the UI is behind. The renderer applies queued deltas in order, so a slow frame cannot silently skip one. Changing speed resets the worker accumulator so returning to `1×` takes effect immediately instead of replaying a fast-forward backlog. Panning, zooming, speed changes, setup edits, and selection therefore do not wait behind simulation steps. Pausing flushes a final visual and state. The worker saves a generation-boundary session checkpoint to IndexedDB, making reload-and-continue possible without replaying completed generations.

Bot construction refreshes districts only within the new structure's radius and batches auras once per 3-second decision tick; a full-map district rebuild under 50 simultaneous bot builds cost ~200 ms and is no longer used for construction. District palette changes are reported as 32 × 32 tiles, so the renderer rewrites alpha for a few tiles instead of rebuilding the 2.1M-pixel control texture. Bot build ticks are staggered across the 3-second interval; in a 300-tick sample the worst district batch was 32 tiles (previously up to 549 when all 50 bots built together). The 10 Hz simulation has a 100 ms budget per tick. It uses ~2.6–3.3% under stress depending on growth layer; rendering and GPU uploads are the limiting factors. The integrity scan costs ~8.5 ms but is limited to once per second. The merged-district union scan costs ~2.7 ms over the 2.1M-cell map and is throttled to at most once per 5 ticks (twice per second) from render/UI reads; it is never part of the 10 Hz simulation tick or checksums.

### Long-run soak

`pnpm soak` runs a deterministic 10,000-tick match, samples every 1,000 ticks (fronts, structures, districts, alive, RSS, checksum), and validates ownership/structure invariants. It also replays a short world twice to confirm checksums match. Use it before releases and after AI/economy changes; a rising RSS or district/front count without corresponding territorial change is a leak signal.

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
| Generate 2048 × 1024 map + 51 starts                    | **~230 ms/op**  |
| Sustained all-bot attack tick                           | **~3.3 ms/op**  |
| All-bot attack tick (collision-heavy, 100 ticks warmed) | **~3.2 ms/op**  |
| Circular layer comparison tick                          | **~2.6 ms/op**  |
| Smooth layer comparison tick                            | **~3.1 ms/op**  |
| Organic layer comparison tick                           | **~3.2 ms/op**  |
| Full-state checksum                                     | **~16.2 ms/op** |
| Active attacks after sustained run                      | ~10–24 fronts   |
| Node RSS (all benchmark simulations)                    | ~296 MiB        |

At 10 Hz, 2.6–3.3 ms per tick is roughly **2.6–3.3% of a 100 ms tick budget**. The derived structure-stack cache keeps per-tick income and per-launch attack stats independent of total structure count. The least-resistance sampler adds 10 frontier operations per capture; smooth remains the most expensive layer. The exact number varies with active fronts, mode, how much of the map is contested, and how many states still hold a State structure. Smooth is the most expensive layer because it scans the nearest radial band and scores candidates for attacker-neighbour count. Attack orders reduce active fronts relative to the old free-front model; defense, capital auras, conflict cancellation, and structure loss further reduce capture volume.

### 2.2 Browser baseline

Measured in headless Chrome with hardware acceleration, 1600 × 1000, devicePixelRatio 1, seed `1234`:

| Metric                                   | Result                                                                 |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| Panning at 144 fps under ~209 fronts     | median 6.9 ms, p99 7.1 ms, max 7.2 ms, **0 frames >10 ms**             |
| 7 s organic run with live conflicts      | 1008 frames, p99 7.1 ms, max 13.8 ms, 1 frame >10 ms                   |
| 4 s cards + auras + markers + organic    | 574 frames, 143 fps, p99 7.1 ms, max 14.0 ms, 2 frames >10 ms          |
| Map uploads under full stress            | ~21M pixels/s, ~80 writeTexture calls/s (adaptive chunked full resync) |
| HUD snapshots                            | 5 Hz (territory still renders at 10 Hz)                                |
| Leaderboard                              | 51 logical rows; only ~19 visible DOM rows are mounted (virtualized)   |
| Failed WebGPU initialization             | 0 in supported test browser                                            |
| Console/page errors during sustained run | 0                                                                      |

The upload strategy intentionally trades bandwidth for input smoothness under extreme load: once dirty tiles exceed 96, the renderer schedules a full-texture resync split into 8 horizontal chunks, at most 2 chunks per frame. Uploading one contiguous 8 MiB texture is far cheaper for the main thread than hundreds of tiny texture writes. At lower action, the normal 32 × 32 dirty-tile path is used, including for district palette changes.

The leaderboard virtualization is just as important: updating 51 Svelte rows at 5 Hz produced ~14 ms tick-boundary frames; mounting only the visible slice removed those. The HUD clock/values update at 5 Hz while map rendering remains per-tick.

### 2.3 Evolution Lab worker investigation (November 2026)

Measured with `pnpm bench`, the local Node build, and a CPU profile of
`EvolutionSandbox.stepOnce()`. The Evolution Lab worker is **simulation CPU
bound**, not render bound.

| Match size | Steady tick cost | Single-core ceiling |
| ---------- | ---------------: | ------------------: |
| 2 players  |     0.42 ms/tick |      ~2,400 ticks/s |
| 4 players  |     0.45 ms/tick |      ~2,200 ticks/s |
| 8 players  |     0.56 ms/tick |      ~1,800 ticks/s |
| 16 players |     0.94 ms/tick |      ~1,070 ticks/s |
| 51 players |     2.43 ms/tick |        ~410 ticks/s |

The 51-state `pnpm bench` run measured **4.08 ms/tick sustained**,
**226 ms** for map generation + 51 starts, and **16.4 ms** per on-demand
checksum. Match setup for a 1280 × 720 Evolution Lab map costs **130–155 ms**,
which is significant for short 400–1600 tick matches.

CPU profile hot spots, largest first:

1. `findBotBuildCell` / `botNeedsExpansion`: scans rings up to 80 px around the
   State and validates every candidate against every structure
   (`structures.hasWithinRadius`). It accounts for roughly **20–45%** of worker
   samples depending on player count.
2. `TerritoryIntegrity.labelComponents`: full-map component labeling every
   annex interval (3 s). Roughly **25–40%** of worker samples.
3. `cleanupUnclaimedPockets`: full-map scan every 10 s, roughly **5–10%**.
4. Attack processing, map generation, and structure work are secondary at
   normal match sizes.

At `1000×`, the requested rate is 10,000 ticks/s. Even the 2-player case is
only ~2,400 ticks/s before worker scheduling and message overhead, so the
`1000×` label is a request, not a guaranteed rate. On the main thread, a
2-player `1000×` run held **360 frames over 2.5 s** with p50 6.9 ms, p99 7.1 ms,
and max 7.1 ms; the worker separation is working. The remaining ceiling is
simulation work, not WebGPU rendering or Svelte.

Optimizations applied in 0.65.0:

- `findBotBuildCell` results are cached per player/type across ticks. Known-good
  sites are validated on read; negative inner-ring results are re-scanned on a
  slower cadence or when ownership changes near that State.
- The structure registry indexes spacing queries in 32 px buckets instead of
  scanning every structure for every candidate.
- Annex component scans run only when ownership changed since the previous
  scan or a State/Port was destroyed, every 3 seconds, and are offset from the
  bot decision tick. This removes the 20–30 ms combined tick spike.
- Naval route searches use weighted A* with a route cache and stop at the first
  nearest-Port sea path; a long landing request dropped from ~150 ms to under
  10 ms.
- Full-map pocket cleanup runs only when ownership changed since the previous
  cleanup pass.

A/B measurements on the same machine and seeds, with behavior unchanged
(identical structure/attack/owner counts):

| Scenario                                         |   Before |    After | Change |
| ------------------------------------------------ | -------: | -------: | -----: |
| 51 states, 500 ticks                             | 7,209 ms | 6,308 ms | −12.5% |
| 8-player evolution, 1,000 ticks                  |   708 ms |   618 ms | −12.7% |
| Idle/no-ownership-change simulation, 1,000 ticks |   605 ms |    52 ms |   −91% |

A later cross-tick cache for `botNeedsExpansion` (valid until ownership,
structure, or layout versions change) reduced an 8-player 1,000-tick run from
829 ms to 781 ms (−5.8%) with identical owned-pixel counts.

The next round added a tick-independent cache for Port and inner-ring build
sites (invalidated by ownership/structure/layout changes) and reset-only
component labels. The 51-state, 500-tick run moved from 1,276 ms to 1,251 ms
(−2.0%); the 8-player active-run time stayed at ~528 ms because captures
invalidate the site cache every tick. The wins are largest in stable late-game
periods; active wars still pay the integrity scan. The lab now reports measured
ticks/s instead of implying the requested `1000×` is always achieved. Match maps
are kept in a small LRU, so repeated lineage seeds avoid another 130–155 ms
generation pass; unique seeds still pay it.

Remaining follow-ups:

- Incremental or region-scoped component updates for integrity during active
  wars.
- Replace the remaining 80 px build-site ring scan with a small candidate index
  for very large territories.

### 2.4 What these numbers do not cover

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

### Map generation (one-time, ~300 ms)

- 2.1M elevation computations with five noise octaves.
- Land histogram threshold plus a second land-height histogram for six elevation quantiles.
- 2.1M land/shade/elevation writes.
- Sampling ~6,900 candidate starts, farthest-point selection for 51 starts, initial paint, and full border rebuild.

It runs once on world creation and is hidden by the loading screen. Do not run it during a live tick.

Potential optimizations if needed:

- generate elevation at half resolution and upsample;
- pre-bake maps/assets;
- move generation to a worker.

### Simulation tick (~2.6–3.3 ms)

- Bots: up to 50 decisions every 10 ticks; frontier sampling.
- Attacks: ~10–24 active fronts × embedded-order point budgets, least-resistance sampling, and stale-cell skipping.
- Growth-layer selection: heap operations for circular, radial-band scanning and neighbour scoring for smooth, RNG array swaps for organic.
- Border maintenance: constant work per captured cell.
- Change packing: one `Uint32Array` write per change.
- No attack queue compaction; frontiers are lifetime-bounded.
- Claim-provenance writes on every capture and mutual-front checks.
- Per-capture defense lookup from elevation + occupancy + aura, plus attacker Barracks strength.
- Least-resistance sampling: up to 10 frontier pops, cost comparisons, and push-backs per capture. This is bounded and adds no allocation beyond the small sampled array.
- Aura overlay (friendly-owned State/Defense Post fields) built at start, rebuilt on structure changes, and locally recomputed for captured cells.
- District Voronoi pass over owner-local structure ranges; local neighbourhood recompute on structure creation/destruction, single-cell update on ordinary captures, and dirty-tile alpha uploads. Each comparison adds a few integer hash samples for coherent edge noise. A 5-bit district palette is packed into the control alpha channel, so no extra texture upload. Per-cell district ids add 8 MiB and palette codes add 2 MiB per simulation.
- Base attack-order grants and cap scans; per-tick Command Post order-rate accrual.
- Per-tick continuous resource accrual: human income lookup and Command Post order-rate scan. Build/upgrade command validation; the card hand is static, with no draw or reroll RNG.
- Structure lookup on claims and structure metadata in checksums.
- Integrity scan once per second: component labeling plus detached-component border counts.
- Structure overlay: 15/11 px State capitals, 10 px type-specific buildable icons, and stack-count badges per rendered frame on a 2D canvas. Aura circles were removed. Icon radii are camera-independent screen pixels. District tint/boundaries are decoded from the packed control alpha in the territory shader.
- Card hand: five permanent DOM cards, gold/income readout; raise/sink, hover, and drag use compositor-friendly transform transitions. Drag/drop conversion is input-only.

No per-cell object allocation. Attack frontiers use flat arrays/heaps and rely on ownership changes for duplicate suppression instead of per-attack Sets. The frontier sets are the main derived structure.

Potential hot spots if attack density rises:

- Set operations per claimed cell (remove/add border entries);
- frontier growth and duplicates;
- smooth-layer neighbour scoring across many candidates;
- frontier iteration for bot target selection;
- snapshot construction for 51 players.

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
| Frontier sets (51 states)               | map-dependent                       |
| Growth frontier candidates              | layer-dependent, lifetime-bounded   |
| Svelte DOM/HUD                          | ~19 virtualized leaderboard rows    |
| Node benchmark RSS (five worlds)        | ~296 MiB                            |

Earlier per-attack `Set<number>` + JS array queues produced ~529 MiB for the same benchmark. Packed/array frontiers and ownership-based duplicate handling brought that down substantially; the current benchmark runs five worlds and measures ~296 MiB depending on GC timing. Integrity preallocates two 2M-entry typed arrays (~16 MiB), the aura overlay adds 4 MiB, and the district type/id/palette arrays add 14 MiB per simulation. Browser memory should be measured separately before shipping.

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
12. **Keep leaderboard DOM small.** Virtualize long lists; do not mount all 51 rows if only ~19 are visible.

---

## 7. Scaling considerations

### More simultaneous fronts

- Queue memory grows with active fronts.
- Dirty upload area grows with dispersed fronts.
- Attack-order supply is currently the main bound: +1 per player every 10 seconds (base caps 3 human / 2 bots), plus Command Posts.
- The final attack design will decide whether this load profile is acceptable.

### More players

- Public player list and leaderboard DOM grow linearly; 51 is still small.
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
- [ ] 51 leaderboard rows remain usable.
- [ ] Drag-pan under ~200 fronts stays free of recurring 10 Hz hitches.
- [ ] All three growth layers were sampled in `pnpm bench`.
- [ ] Organic run with active conflicts: p99 frame 7.1 ms, max 13.8 ms, 1/1008 frames >10 ms.

---

## 9. Future optimizations (ranked)

1. Make active-war integrity component labeling incremental or region-scoped.
2. Replace the remaining ring scan for very large territories with a candidate index.
3. Render-on-demand idle mode.
4. Adaptive DPR/resolution.
5. GPU timestamp queries and automated performance gates.
6. WebGL2 fallback only if support data justifies it.
