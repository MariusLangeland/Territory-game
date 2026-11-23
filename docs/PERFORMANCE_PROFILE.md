# Browser Performance Profile (headless Chrome, November 2026)

Measured profile of the **current production build** in `build/` (Frontage v1, app version
`0.77.0`, **rebuilt 2026-11-24 00:01** after the simulation performance optimizations) served by
`node build/index.js` (adapter-node) on `127.0.0.1:4174`. No game source, build output, or config
was changed. All instrumentation was injected at runtime over the Chrome DevTools Protocol (CDP),
so every number below describes the same code in `build/` that a user would download.

**Revision note.** This replaces the earlier profile of the 2026-11-23 22:42 pre-optimization
build. The frame/render side is essentially unchanged within run-to-run noise, but the worker side
improved substantially and that is now reflected here: steady worker tick **p50 0.90 ms,
p99 12.4 ms, max 12.8 ms** (pre-optimization: 1.40 / 51 / 59.4 ms) and GPU-process CPU busy
**9.0 %** (was 11.5 %) at 144 Hz.

- **WebGPU initialized successfully** — no error overlay, no software fallback: `navigator.gpu`
  present, `requestAdapter()` returned the NVIDIA adapter ("nvidia"/"blackwell", non-fallback),
  `canvas.getContext('webgpu')` created, and the game's own perf readout rendered.
- This complements the existing browser baseline in [PERFORMANCE.md](PERFORMANCE.md) §2.2 with
  phase timings, trace-based main-thread/GPU-process attribution, worker cadence, long-task and
  memory data. Numbers are from one host, one seed (`1234`), and headless Chrome; treat them as
  directional, not guarantees.

---

## 1. Environment and method

| Item            | Value                                                                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser         | Chrome `157.0.8103.79` (`HeadlessChrome/157.0.0.0`), `--headless=new`                                                                                 |
| Debug port      | `--remote-debugging-port=9333` (browser WebSocket, per-target flattened sessions)                                                                     |
| Required flags  | `--enable-unsafe-webgpu --ignore-gpu-blocklist`                                                                                                       |
| Stability flags | `--disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling --no-first-run --disable-extensions` |
| Window          | `--window-size=1920,1080`; page viewport 1898 × 982; `devicePixelRatio` 1                                                                             |
| Host GPU        | NVIDIA GeForce RTX 5070 Ti (driver 32.0.16.2101), D3D12 feature level 12.2                                                                            |
| Host CPU        | 28 logical cores (Intel Core i7-14700F class)                                                                                                         |
| Match           | Seed `1234`; 51 states / 4096 × 2048 atlas (default) and 8 states / same atlas                                                                        |
| Load cache      | HTTP cache cleared before each scenario ("cold" HTTP load)                                                                                            |
| Build           | `build/` artifact timestamp 2026-11-24 00:01, version 0.77.0                                                                                          |

`navigator.gpu` is only exposed on a secure context: on `about:blank` the API is absent, on
`http://127.0.0.1:4174` it is present. WebGPU did not need Vulkan/SwiftShader flags.

Measurement runs (all in the same headless browser, sequentially; the Chrome profile was fresh at
the start of the session, so the first app load paid cold GPU shader/pipeline cache costs — called
out where relevant):

| Run             | Scenario                                                                  | Sample window            |
| --------------- | ------------------------------------------------------------------------- | ------------------------ |
| 51-state        | Default match, cold HTTP load, deploy, trace 5 s, drag-pan 3.3 s          | 40 s steady              |
| 51-state repeat | Same match, cold HTTP load, no trace/pan (load/deploy check)              | 15 s steady              |
| 8-state         | Persisted `states: 8`, cold HTTP load, trace 4 s                          | 25 s steady              |
| Load trace      | Cold load start-to-ready, no steady play                                  | ~3.2 s trace             |
| Uncapped        | Same 51-state match with `--disable-frame-rate-limit --disable-gpu-vsync` | 20 s steady (3 s traced) |
| CPU profile     | 51-state steady play, 100 µs sampling                                     | 6 s                      |

### What was instrumented (runtime only)

Injected before any app script via `Page.addScriptToEvaluateOnNewDocument`:

- rAF cadence: a native rAF sampler registered before the game loop (so it does not measure
  itself), plus a wrapper that times every other rAF callback (the game frame loop).
- `PerformanceObserver` for `longtask` (> 50 ms), LCP/CLS/FCP/paint entries.
- WebGPU wrappers on `requestAdapter`/`requestDevice`, `queue.writeTexture`/`writeBuffer`/`submit`,
  `createTexture`/`createRenderPipeline`/`createShaderModule`, and `getCurrentTexture` (call
  counts, uploaded pixel regions, per-call duration).
- `Worker` wrapper forwarding to a real native listener: timestamps, per-message `type`/`tick`,
  handler duration, and main→worker `postMessage` log.
- DOM: milestone selectors (loading overlay, intro, deploy button, canvas, perf readout, HUD),
  mutation counter, and sampler of the game's own `FPS / PX/S / CALLS/S` perf readout every 200 ms.
- `performance.memory` sampler (1 s) plus CDP `Performance.getMetrics`, `Runtime.getHeapUsage`,
  `Memory.getDOMCounters` at load/deploy/end.

Trace runs used `Tracing.start` with `devtools.timeline`, `disabled-by-default-devtools.timeline`,
`disabled-by-default-devtools.timeline.frame`, and `gpu`. A separate invalidation-tracking trace
plus the new-build trace were used to explain per-frame layout. The 6 s CPU profile used
`Profiler.setSamplingInterval 100`.

Known instrumentation cost: one extra rAF callback per frame and two low-frequency `setInterval`
samplers (≈ 26 timer tasks/s, negligible), plus tracing overhead during the explicitly marked
trace windows. Tolerances are stated per metric where it matters.

---

## 2. Page load, intro, and deploy transition

Timeline in ms after navigation start (`performance.now()`); "ready" = intro DEPLOY enabled =
worker simulation ready + WebGPU renderer ready.

| Milestone                                    | 51 states (repeat visit) | 51 states (first visit, fresh profile) |    8 states | 51 uncapped (first visit) |
| -------------------------------------------- | -----------------------: | -------------------------------------: | ----------: | ------------------------: |
| `loading-overlay` mounted                    |                     42.7 |                                   91.0 |        45.1 |                      90.7 |
| Worker `new Worker()`                        |                     86.8 |                                  142.7 |        94.9 |                     135.3 |
| Worker init message (map + sim ready)        |                  1,225.5 |                                1,446.1 |     1,370.5 |                   1,664.3 |
| **Worker map generation + sim construction** |              **1,138.7** |                                1,303.4 |     1,275.6 |                   1,529.0 |
| Intro overlay visible (game canvas mounts)   |                  1,234.1 |                                1,455.9 |     1,379.4 |                   1,677.2 |
| **Renderer init after canvas mount**         |                **168.2** |                                  509.3 |       173.3 |                     475.3 |
| **Ready / time to interactive**              |              **1,402.3** |                            **1,965.2** | **1,552.7** |                   2,152.5 |
| First contentful paint (headless metric)     |                    1,412 |                                  1,980 |       1,564 |                     2,160 |
| Largest contentful paint                     |                    1,412 |                                  1,980 |       1,564 |                     2,160 |
| Cumulative layout shift                      |                    0.018 |                                  0.026 |       0.004 |                     0.025 |

Load composition (repeat visit, 18 subresources, 464.8 KB decoded / 126.9 KB transferred with
gzip/br; largest assets: worker 121.3 KB, app chunk 106 KB, CSS 57.6 KB):

- **No hydration phase is measurable.** The server returns a 2,091-byte SvelteKit shell with no
  app markup; the game DOM is client-rendered. "Page load" is therefore script fetch/eval + mount,
  not hydration.
- Main-thread startup (load trace): largest task **46.9 ms** (initial script evaluation at
  ~43 ms), then **40.4 ms** applying the worker init payload, **39.0 ms** building the 8.4 M-pixel
  CPU control texture, and **22.4 ms** first renderer frames. No main-thread task exceeded 50 ms.
- **Map generation is entirely off the main thread**: one worker-thread task of **1,122.2 ms**
  produced the 51-state world (page long-task observer sees nothing). The loading overlay repaints
  at 141–144 fps while it runs.
- GPU/renderer init: `requestAdapter` 75.9 ms, `requestDevice` 27.6 ms, initial full-atlas texture
  upload (32 MiB, one `writeTexture` of 4096 × 2048) is a single **74.4 ms** GPU-process task,
  followed by 22.5 ms and 19.0 ms GPU tasks during the first frames. WebGPU pipeline creation
  itself is sub-millisecond; the cost is device creation and the initial texture upload.
- **First-visit shader/pipeline warm-up costs ~340 ms**: in a fresh Chrome profile the renderer
  init took 509 ms (vs 168 ms once the GPU shader cache is warm) and the page saw one 122 ms
  main-thread long task; time to interactive was 1.97 s vs 1.40 s on the next visit.
- Intro idle (static map behind the overlay): 144.1 fps, game frame callback **0.19 ms mean**
  (p95 0.3 ms), zero uploads, 0–4 DOM mutations/s.
- Headless FCP/LCP are unreliable: `firstPaint` fired at 32 ms while FCP reported 1,412 ms. Use the
  milestone table, not the paint metrics.

### Deploy transition (click DEPLOY → live HUD)

| Metric                              |         51 states (repeat visit) |                       51 states (first visit) |                         8 states |
| ----------------------------------- | -------------------------------: | --------------------------------------------: | -------------------------------: |
| Click → intro overlay removed       |                          58.8 ms |                                       51.9 ms |                          48.4 ms |
| Click → perf readout + HUD mounted  |             58.8 ms (same frame) |                                       51.8 ms |                          48.4 ms |
| Click → worker `resume` postMessage |                           8.7 ms |                                        4.8 ms |                           5.2 ms |
| Resume → first worker visual/tick   |                         125.0 ms |                                      129.5 ms |                         102.5 ms |
| Frames in the 2 s deploy window     | 290 (140 fps), one 55.5 ms frame | 192 (93 fps), 513.9 / 125.1 ms warm-up stalls | 291 (141 fps), one 48.7 ms frame |

The repeat-visit deploy hitch is the HUD mount/first game frame; frame cadence returns to 144 fps
on the next frame. The first-ever deploy additionally pays the GPU pipeline/shader warm-up
(≈ 0.5 s + 0.13 s stalls), after which cadence is normal. Worker simulation was paused during the
intro, so the first live tick arrives one tick after resume.

---

## 3. Steady-state frame cadence and cost

Headless Chrome here presented at a **144 Hz vsync** (`requestAnimationFrame` p50 interval
6.9 ms), i.e. a 6.94 ms frame budget. All windows below are post-deploy unless noted.

### 3.1 Main-thread rAF cadence

| Window                               | Frames | p50 | p95 | p99 |  max | Effective fps | Frames > 8 ms |
| ------------------------------------ | -----: | --: | --: | --: | ---: | ------------: | ------------: |
| 51 states, 8 s steady (pre-trace)    |  1,149 | 6.9 | 7.0 | 7.1 | 20.8 |         143.1 |             7 |
| 51 states, 5 s traced steady         |    720 | 6.9 | 7.0 | 7.1 |  7.1 |         144.1 |             0 |
| 51 states, 3.3 s drag-pan            |    470 | 6.9 | 7.0 | 7.1 |  7.1 |         144.1 |             0 |
| 8 states, 8 s steady (pre-trace)     |  1,153 | 6.9 | 7.0 | 7.1 |  7.1 |         144.1 |             0 |
| 8 states, 4 s traced steady          |    577 | 6.9 | 7.0 | 7.1 |  7.1 |         144.1 |             0 |
| 51 states, intro idle                |    449 | 6.9 | 7.0 | 7.1 |  7.1 |         144.1 |             0 |
| 51 states, deploy 2 s (repeat visit) |    290 | 6.9 | 7.0 | 7.1 | 55.5 |         140.1 |             1 |

Across the full 40 s 51-state session: the repeat-visit run had 3/2,933 frames > 8 ms (one 55.5 ms
HUD-mount frame and two ~14 ms single-vsync drops, ≈ 0.1 %); the first-visit run had 17/6,402, of
which 8 belong to the one-off shader-warm-up bursts directly after the first deploy. In the
traced and pan windows every frame met the 6.94 ms vsync deadline.

Game frame-loop callback CPU (measured by wrapping the app's own rAF callback; excludes the
injected sampler):

| Window                |    mean |    p50 |    p95 |    p99 |     max |
| --------------------- | ------: | -----: | -----: | -----: | ------: |
| 51 states, steady 8 s | 0.76 ms | 0.4 ms | 3.2 ms | 6.5 ms | 15.8 ms |
| 51 states, traced 5 s | 0.56 ms | 0.4 ms | 1.9 ms | 2.6 ms |  5.7 ms |
| 8 states, steady 8 s  | 0.30 ms | 0.3 ms | 0.5 ms | 1.2 ms |  3.5 ms |
| 51 states, intro idle | 0.19 ms | 0.2 ms | 0.3 ms | 0.4 ms |  0.7 ms |

### 3.2 Renderer stats exposed by the game's perf readout

Values are parsed from the DOM `.perf-readout` (`FPS`, `PX/S`, `CALLS/S`) sampled every 200 ms.
`PX/S` counts uploaded pixels and `CALLS/S` counts `queue.writeTexture` calls in the renderer's
own 1 s window.

| 51 states         |   p50 |   p90 |   p95 |   p99 |                                   max |
| ----------------- | ----: | ----: | ----: | ----: | ------------------------------------: |
| FPS               |   144 |   144 |   144 |   144 | 144 (min 47 first visit / 136 repeat) |
| Uploaded pixels/s | 217 K | 520 K | 635 K | 705 K |                                 705 K |
| Upload calls/s    |   138 |   317 |   358 |   444 |                                   444 |

| 8 states          |  p50 |  p90 |   p95 |   p99 |           max |
| ----------------- | ---: | ---: | ----: | ----: | ------------: |
| FPS               |  144 |  144 |   144 |   144 | 144 (min 138) |
| Uploaded pixels/s | 35 K | 69 K | 127 K | 134 K |         134 K |
| Upload calls/s    |   20 |   44 |    78 |    81 |            81 |

After the shader warm-up the readout held 144 FPS in both scenarios (51-state repeat-visit mean
143.9 with min 143; 8-state mean 144.0 with min 143). The lower 8-state upload volume is the
8-state match being ~6× lighter on uploaded pixels and ~7× lighter on upload calls than the
51-state match.

### 3.3 WebGPU call cost

From the wrapper on the page's WebGPU queue:

- 51-state steady: **2.04 `writeTexture` calls per frame** (2,342 calls / 1,149 frames), upload
  region p50 2,048 px (two 32 × 32 dirty tiles), p90 2,048, p95 3,072, p99 4,096 px. Call duration
  p50 0.1 ms, p95 0.3 ms, max 0.9 ms. The data view passed is always the full 32 MiB CPU control
  texture with a `dataLayout` offset; only the width × height region is transferred.
- `queue.submit`, `createCommandEncoder`, `getCurrentTexture`, and the 64-byte uniform
  `writeBuffer` are ~0.01 ms each per frame.
- One-off startup cost: a single 8,388,608 px (32 MiB) `writeTexture` for the initial full atlas,
  measured as a 74.4 ms GPU-process task (see §2).
- Interactive pan uses the same dirty-tile path: 116.7 upload calls/s, 470/470 frames met the
  6.94 ms vsync deadline (p50 callback 0.4 ms) — no periodic 10 Hz hitch.

### 3.4 Trace-based main-thread and GPU-process attribution

5.0 s trace inside the 51-state steady run (721 frames, 143.6 commits/s, mean commit interval
6.96 ms):

| Thread                                 | Metric                                 |                                         Result |
| -------------------------------------- | -------------------------------------- | ---------------------------------------------: |
| Page main (`CrRendererMain`)           | RunTask busy time                      | 933.2 ms / 5.02 s = **18.6 %** (1.29 ms/frame) |
| Page main                              | RunTask duration p50 / p95 / p99 / max |                  0.005 / 0.80 / 1.38 / 9.55 ms |
| Page worker (`DedicatedWorker thread`) | tick task p50 / p90 / p99 / max        |             **0.90 / 8.22 / 12.36 / 12.84 ms** |
| GPU process (`CrGpuMain`)              | `GPUTask` busy time                    |  **9.0 %** (454.2 ms / 5.02 s = 0.63 ms/frame) |
| GPU process                            | `GPUTask` p50 / p95 / max              |                         0.148 / 0.36 / 1.45 ms |
| GPU process                            | `WebGPU` sub-events                    |                 1,485 events, 296.4 ms (5.9 %) |

8-state equivalent: main RunTask busy **11.1 %** (445.3 ms / 4.02 s, 0.78 ms/frame); worker tick
p50 0.27 ms (max 6.09 ms); GPU process **7.3 %** (292.8 ms, 0.51 ms/frame).

`GPUTask`/`WebGPU` are CPU time inside the GPU process (Dawn/D3D12 command submission), **not**
actual GPU execution time; see §7. At 144 Hz the measured main-thread and GPU-process CPU paths use
roughly one fifth and one eleventh of the frame budget respectively, so the frame cadence above is
not near the platform ceiling (§7 quantifies the headroom).

---

## 4. HUD and DOM update cost

- Snapshot/HUD updates are throttled by design (snapshot to Svelte at 5 Hz). Measured DOM
  mutations during 51-state steady play: **115/s** (p50; 48/s during the traced window);
  8-state: 48/s. DOM after deploy: 387 elements (51 states) / 310 (8 states); 56 JS event
  listeners; CDP DOM counters report 1,414–1,664 node entries across all documents.
- Every rendered frame performs one style recalc + layout cycle inside the frame callback:
  727 `Layout` events / 721 frames (145/s), mean **0.106 ms** (p95 0.173, max 0.406); 722
  `UpdateLayoutTree` (mean 0.046 ms). Combined ≈ **0.15 ms/frame, ~2 % of the 6.94 ms budget**.
  The invalidation trace shows the per-frame dirty element is a leaderboard/supply span whose
  style is changed by Svelte reactive updates; the forced layout then flushes inside
  `renderer.resize()` (a `canvas.clientWidth` read), with a `resize > render > frame` stack.
  `Paint` is rare (217 events, mean 0.063 ms); the WebGPU canvas itself is composited, not painted.
- Worker-message handling on the main thread: the synchronous handler is cheap — p50 0.1 ms,
  p95 0.2 ms over 421 messages (max 4.5 ms, only the init message). The enclosing browser task
  (`HandlePostMessage`) is p50 0.16 ms but **p90 ≈ 8.7 ms**: about five tasks per 5 s (≈ 1/s) take
  7.7–9.5 ms, and the trace shows the time is a single nested Svelte flush `FunctionCall` in the
  Svelte runtime chunk. These are the largest recurring main-thread items and each exceeds one
  144 Hz frame; in practice only 3/2,933 repeat-visit frames were > 8 ms.
- 6 s CPU profile of 51-state steady play (11,148 samples): 83.9 % idle, 4.4 % program/V8
  overhead, **2.9 % `writeTexture`**, **1.1 % `resize`** (the per-frame canvas size/DPR read),
  **3.6 % in the renderer/frame-loop chunk**, ~3.2 % in Svelte/app runtime chunks (flush +
  accessors), remainder compositor/raster plumbing and minor GC. No single hot game function
  dominates the main thread.

---

## 5. Worker cadence and simulation cost

The worker owns simulation (main thread never steps). It posts one visual message per tick when
running, plus 1 Hz telemetry. Tick numbers are strictly sequential: **421/420 consecutive visual
deltas were exactly +1** — no dropped or duplicated ticks, and the sender/receiver never coalesced
ticks in these runs.

| Metric (steady, 51 states)                           |                                           Result |
| ---------------------------------------------------- | -----------------------------------------------: |
| Visual messages / seconds                            |                 421 / 42.0 s = **10.03 ticks/s** |
| Inter-message gap mean / p50 / p90 / p95 / p99 / max | 100.0 / 108.7 / 119.4 / 123.4 / 127.9 / 237.9 ms |
| Gaps < 50 ms (catch-up pairs)                        |                                 43 of 420 (10 %) |
| Gaps > 120 ms                                        |                                  38 of 420 (9 %) |
| Worker thread tick CPU p50 / p90 / p99 / max (trace) |               **0.90 / 8.22 / 12.36 / 12.84 ms** |
| Trace-confirmed timer-fire intervals p50 / p99       |                                 108.2 / 121.9 ms |

8 states: 272 visuals / 27.2 s = 10.0 ticks/s; gap mean 100.3, p50 108.0, p90 115.8, p99 124.7,
max 132.6 ms; worker tick cost p50 0.27 ms, p90 5.82, p99 6.08, max 6.09 ms.

The simulation rate is correct on average (10.0 Hz), but pacing is **bimodal**: most ticks are
posted 106–118 ms apart, with periodic catch-up pairs (1–15 ms apart) so the worker accumulator
averages 100 ms. The worker timer therefore jitters by roughly +9 ms median / +28 % at p99. The
costliest worker ticks (up to 12.8 ms in 51 states, 6.1 ms in 8 states) are worker-thread-only
maintenance work (bot decisions / integrity scans) — down from 51–59 ms on the pre-optimization
build and no longer anywhere near the 100 ms tick budget. They never blocked the main thread or
broke frame cadence. 1 Hz telemetry messages are additional but tiny.

---

## 6. Long tasks (> 50 ms)

| Phase                        | 51 states                                                                                               | 8 states               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------- |
| Initial page load            | repeat visit: **0** (max main task 46.9 ms); first visit: **1 × 122 ms** (cold shader/pipeline compile) | 0                      |
| Worker map generation        | single 1,122.2 ms **worker-thread** task (does not block main thread)                                   | 1,275.6 ms worker task |
| Deploy / HUD mount           | repeat visit: **1 × 51 ms**; first visit: 0 counted by the observer but two 514 / 125 ms warm-up stalls | 0                      |
| 40 s steady play + 3.3 s pan | **0 long tasks** on the main thread                                                                     | 0                      |
| Worker heavy ticks (steady)  | max **12.8 ms** on worker thread                                                                        | max 6.1 ms             |

So in the normal capped (144 Hz) configuration there were no steady-play main-thread long tasks and
the worker's heavy maintenance tick peaked at 12.8 ms (vs 59.4 ms pre-optimization). The only

> 50 ms main-thread tasks observed were first-visit GPU shader/pipeline warm-up and a 51 ms
> deploy-adjacent task; all are outside steady play.

---

## 7. Headroom probe (uncapped frame rate)

Same 51-state match, browser additionally launched with `--disable-frame-rate-limit
--disable-gpu-vsync` so rAF runs as fast as the pipeline allows (fresh profile, so this run pays
the first-visit shader warm-up: ready 2.15 s):

| Metric                                     |                                                               Result |
| ------------------------------------------ | -------------------------------------------------------------------: |
| rAF commit rate (3 s traced steady window) |               4,417 commits / 3.02 s = **1,462 fps**, 0.68 ms/commit |
| Game perf readout FPS                      |           p50 **1,482**, mean 1,431, p90 1,640, p95 1,669, min 1,027 |
| Main thread RunTask busy                   |                                     **96.8 %** (2,923.4 ms / 3.02 s) |
| GPU process `GPUTask` busy                 |                               **52.1 %** (1,574.7 ms, 0.36 ms/frame) |
| Main-thread long tasks                     | 3: 59 ms + 122 ms during load/warm-up, 220 ms at deploy (saturation) |

Interpretation: when vsync is removed, the measured pipeline saturates at ~1,450–1,500 fps and the
**main thread becomes the limiting resource** (96.8 % busy) while the GPU-process CPU path still has
headroom (52.1 %). At the real 144 Hz target those same paths sit at ~19 % and ~9 % utilization,
i.e. several times of CPU-side headroom under this load. Uncapped rendering also slowed the load
phase (ready 2.15 s vs 1.40 s) because the loading overlay itself was being rendered at
thousands of fps while the worker generated the map.

---

## 8. Memory

| Metric (51 states)                  | After load/init |  Steady peak |  End of run |
| ----------------------------------- | --------------: | -----------: | ----------: |
| `performance.memory` JS heap used   |       ~86–90 MB | **114.2 MB** |     89.5 MB |
| CDP `Runtime.getHeapUsage` V8 used  |               – |            – |     11.7 MB |
| `backingStorageSize` (ArrayBuffers) |               – |            – | **80.6 MB** |
| `jsHeapSizeLimit`                   |               – |            – |    4,192 MB |

8 states peaked at 92.6 MB JS heap, ended 88.5 MB, same ~81.2 MB backing storage — as expected,
the atlas-sized typed arrays dominate and are identical for both state counts (owners 16.8 MB,
3 × 8.4 MB terrain layers, 8.4 MB district codes, 33.5 MB CPU control texture on the main thread,
plus the worker's own copies). DOM at end of run: 771 layout objects, 1,632 CDP node entries,
56 event listeners (387 actual document elements).

**Not measurable here:** GPU/VRAM allocations, the worker's JS heap (a separate isolate),
compositor surfaces, and native/browser-process memory. No browser DevTools memory tooling
(`Memory.getBrowserSamplingProfile`, heap snapshots) was used because it would perturb the
frame measurements.

---

## 9. Caveats and what remains unmeasurable

- **Headless only, one host, one seed.** D3D12 device creation, 32 MiB initial upload, 144 Hz
  presentation, and timer granularity are environment-specific. Other processes were active on the
  shared host during the runs, so absolute ms values can drift run-to-run. Do not treat absolute
  numbers as cross-machine guarantees; the utilization fractions and relative phase costs are the
  more portable results.
- **Fresh-profile shader cache matters.** The first app load in a brand-new Chrome profile paid
  ≈ 340 ms extra renderer init and 0.5–0.13 s stalls on first deploy (GPU shader/pipeline
  compilation). Repeat visits measured 1.40 s to interactive. Both cases are reported separately.
- **GPU execution time is not measured.** `queue.submit` is asynchronous; Chrome tracing exposes
  GPU-process CPU work (`GPUTask`, `WebGPU`) but not actual GPU shader/fill time, and the game does
  not enable WebGPU `timestamp-query`. Presentation/compositor latency, swap-chain wait time, and
  real display latency are likewise unmeasurable from page JS.
- **Vsync is inferred.** rAF p50 of 6.9 ms and the renderer's own 144 FPS readout are consistent
  with a 144 Hz presentation target in this headless session; the exact BeginFrame source is a
  browser-internal detail. Frame cadence numbers describe what the page sees.
- **Traces and injected instrumentation perturb the system.** Trace windows (5 s / 4 s) add
  recording overhead; the injected rAF wrapper adds a tiny per-frame cost.
- **Worker timer jitter may be headless-specific.** The 106–118 ms medians (with catch-up pairs)
  are measured against a nominal 100 ms `setTimeout`; Chrome timer scheduling/coalescing on a
  headless page is not the same as a focused desktop tab. Tick _accuracy_ (10.0 ticks/s, no drops)
  is robust; tick _spacing_ is reported as observed.
- **Not covered:** DPR 2 / 4K displays, integrated/low-power GPUs, tab throttling or occlusion,
  multiple simultaneous clients, the online room path, long late-game matches, audio (none
  exists), mobile/touch, and the 500-stack bot surge setting. The existing
  [PERFORMANCE.md](PERFORMANCE.md) §2.4 list still applies.
- **Headless FCP/LCP are unreliable** (see §2); use the milestone timings.
- **Build note:** measurements are of the `build/` artifact timestamped 2026-11-24 00:01
  (0.77.0), which includes the merged simulation performance optimizations. The earlier
  2026-11-23 22:42 artifact profile is superseded by this document.
- Benign console noise during runs: one `404 /favicon.ico` and Chrome's warning that
  `powerPreference` is ignored for `requestAdapter()` on Windows. The renderer's own perf readout
  includes the one-off startup statistics window.

---

## 10. Summary table

| Question                         | Result (this host, headless Chrome 157)                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| WebGPU initialized?              | **Yes** — NVIDIA RTX 5070 Ti adapter, no fallback, no error overlay                                           |
| Time to intro-interactive        | 1.40 s (51, repeat visit) / 1.97 s (51, first visit) / 1.55 s (8)                                             |
| Where load time goes             | worker map gen ~1.1–1.3 s, renderer/GPU init ~0.17 s (repeat) or ~0.51 s (first visit), startup JS ~50 ms     |
| Deploy transition                | 48–59 ms to live HUD; repeat-visit HUD-mount frame 55.5 ms                                                    |
| Main-thread rAF cadence, steady  | 144.1 fps (6.9 ms p50, 7.1 ms p99); 3/2,933 repeat-visit frames > 8 ms                                        |
| Game frame-loop CPU              | 0.4 ms p50, 3.2 ms p95 (51 states); 0.3 ms p50 (8 states)                                                     |
| Uploads (51 states)              | 138 calls/s p50 (444 p99), 217 K px/s p50 (705 K p99)                                                         |
| Main-thread utilization          | 18.6 % (51 states), 11.1 % (8 states) at 144 Hz                                                               |
| GPU-process CPU                  | 9.0 % (51 states), 7.3 % (8 states) at 144 Hz; 0.63 / 0.51 ms per frame                                       |
| HUD cost                         | ~0.15 ms/frame forced style+layout; ~1/s Svelte flush tasks of 7.7–9.5 ms                                     |
| Worker cadence                   | 10.0 ticks/s average; every visual = +1 tick; gaps p50 108.7 ms, p99 127.9 ms                                 |
| Worker tick cost                 | **p50 0.90 ms, p99 12.4 ms, max 12.8 ms** (51 states); was p99 51 / max 59.4 pre-optimization                 |
| Main-thread long tasks (> 50 ms) | **0** during 40 s steady play + pan; only first-visit shader warm-up / deploy-adjacent                        |
| JS heap                          | ~90 MB typical, 114 MB peak; 81 MB ArrayBuffer backing store                                                  |
| CPU-side frame headroom          | main thread saturates ≈1,450–1,500 fps uncapped; ~19 % / ~9 % of budget at 144 Hz                             |
| Still unmeasurable               | GPU execution time, presentation latency, VRAM/native memory, DPR 2/4K, low-end GPUs, background-tab behavior |
