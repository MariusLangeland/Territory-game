# Rendering

The renderer is WebGPU-only and designed around one large raster map with small, local ownership changes. It is deliberately decoupled from simulation logic.

---

## 1. Renderer goals

1. Display a 2048 × 1024 pixel ownership map crisply at any zoom.
2. Update the GPU texture without re-uploading the full map when a few pixels change.
3. Keep the fragment shader cheap enough for a full-screen pass at 60–144 fps.
4. Survive GPU device loss and shader failures with a clear error state.
5. Never mutate simulation state.

---

## 2. Pipeline

```text
CPU control shadow (RGBA8, 2048 × 1024)
        │ 32 × 32 dirty tiles / adaptive full resync chunks
        ▼
queue.writeTexture (partial updates)
        │
        ▼
mapTexture (rgba8unorm, nearest)
paletteTexture (256 × 1 rgba8unorm, nearest)
uniform buffer (64 B)
        │
        ▼
full-screen triangle
  vertex: no vertex buffer, 3 clip-space vertices
  fragment: ownership + land + relief + palette + time + hover
        │
        ▼
canvas swapchain (preferred format)
```

There is exactly one WebGPU draw call per frame for territory.

### Structure overlay

Structures are not encoded in the ownership texture. A transparent 2D canvas sits above the WebGPU canvas and draws up to 108 owner-colored capital-star circles at structure cells each frame:

- uses the same `MapCamera.mapToScreen` transform as the map;
- draws defense auras as faint owner-colored fields and attack auras as amber dashed fields, scaled by `effect.radius * camera.scale`; auras smaller than 16 px are hidden under the marker;
- draws a dark halo, cream ring, and owner-colored disc for every structure;
- uses a cream five-point capital star for State structures, a pickaxe for Mines, crossed swords for Barracks, a shield for Defense Posts, a command mast for Command Posts, and layered chevrons for War Academies;
- uses 10/7.5 px radii for human/AI State capitals, 6 px for buildables, plus an extra human capital halo;
- culls offscreen markers;
- resizes with the map viewport and DPR (capped at 2);
- `pointer-events: none`, so attacks/drags still target the WebGPU canvas;
- reads the live `simulation.structures` registry and each structure's effect list, so a destroyed structure and its aura disappear immediately;
- the minimap separately draws live structures as owner-colored circles with a cream ring and center dot.

The overlay is intentionally separate from the territory shader: structures need icons and future labels, while territory upload cost and sampling stay unchanged. A combined elevation + structure + organic run measured 144 fps, p99 7.1 ms.

---

## 3. Control texture layout

The control texture is created as `rgba8unorm`, with usage `TEXTURE_BINDING | COPY_DST`.

| Channel | Value                  | Used by                                  |
| ------- | ---------------------- | ---------------------------------------- |
| R       | Owner id 0–108         | Player color, border comparison          |
| G       | `0` ocean / `255` land | Ocean styling, coastlines                |
| B       | Terrain shade 0–255    | Relief brightness and grain              |
| A       | Elevation tier 0–255   | Six-tier terrain color and contour edges |

### Elevation rendering

The alpha channel stores `elevation / (ELEVATION_LEVELS - 1)`. The fragment shader decodes it back to a tier and:

- mixes an elevation palette into land color — green lowland, olive plains, ochre hills, brown highlands, grey mountains, pale peaks;
- keeps owner colors dominant (18% terrain mix) while unclaimed land shows the terrain palette more strongly (52%);
- brightens the top tier toward snow;
- darkens pixels where a neighbour has a different tier, producing subtle contour boundaries;
- leaves the continuous shade channel for relief grain.

This reuses the existing RGBA control texture and requires no extra upload or texture binding. Defense is not encoded separately; it is derived from elevation plus owner in the HUD and simulation.

Why not upload owner only as R8? A single RGBA8 texture keeps sampling simple and leaves room for static channels without adding another binding. The renderer only writes R for ownership changes; G/B are written at initialization/resync.

The CPU shadow is `Uint8Array(2048 * 1024 * 4) = 8 MiB`. The GPU texture is another 8 MiB. This is acceptable for the target map size.

### Palette

`PALETTE` in `constants.ts` is index-aligned with owner ids:

- index 0 = unclaimed land,
- indices 1–108 = player colors (eight hand-picked, the rest generated on a golden-angle hue wheel).

The palette texture is 256 × 1. Unused indices remain black. The shader looks up `(owner + 0.5) / 256`.

---

## 4. Adaptive texture uploads

### The problem

A single dirty rectangle is wrong for this game. With 108 states attacking simultaneously, the union of all changed pixels becomes almost the whole map, and the renderer would upload ~2.1M pixels per tick (21M px/s at 10 Hz).

A pure 32 × 32 tile strategy fixes the upload volume, but not the input latency: ~200 dispersed fronts produced **~2,169 `writeTexture` calls/s**, and panning stuttered with frames up to ~28 ms.

A single full-texture upload per tick reduced calls to ~10/s but occasionally stalled a frame for 12–14 ms. One big synchronous `writeTexture` is still work on the input path.

### The solution: tiles for light updates, chunked resync for dense updates

- Divide the map into 32 × 32 tiles (`64 × 32 = 2,048` tiles).
- Use a generation-stamped `Uint32Array` to mark dirty tiles cheaply.
- Track dirty tile rows and a dirty tile count.
- If ≤ 96 tiles are dirty, merge contiguous dirty tiles per row into strips and upload them immediately.
- If > 96 tiles are dirty, queue a **full-texture resync** and upload it in eight horizontal chunks, at most two chunks per rendered frame.
- While a resync is in progress, incoming ticks continue updating the CPU shadow; the current cycle uses the latest data, and another cycle is scheduled if further changes arrived.

This means no single frame has to copy the entire 8 MiB texture. The visual map may trail the CPU state by a few frames during extreme action, which is imperceptible for territory changes but keeps panning stable.

### Light upload call

```ts
device.queue.writeTexture(
	{ texture: mapTexture, origin: { x, y } },
	controlPixels,
	{ offset: (y * width + x) * 4, bytesPerRow: width * 4, rowsPerImage: h },
	{ width: w, height: h }
);
```

A tile is uploaded in full even if only one pixel inside it changed. At 32 × 32, this is cheaper than many per-pixel uploads and much cheaper than a global rectangle. The tile size is a tuning knob: smaller means less overdraw, larger means fewer API calls.

### Results

- Frame pacing while panning under ~209 fronts: **144 fps**, p99 **7.1 ms**, max **7.2 ms**, zero frames >10 ms.
- Upload traffic: **~21M pixels/s**, **~80 calls/s** during saturation.
- HUD snapshots are limited to 5 Hz; the leaderboard is virtualized so only ~19 rows live in the DOM. Without those two changes, 5 Hz HUD updates still produced ~14 ms frames.
- Initial creation still performs one direct full upload before the first frame.

---

## 5. Shader

Source: `src/lib/game/render/territory.wgsl.ts`.

### Vertex stage

A single full-screen triangle with three hard-coded clip-space vertices:

```wgsl
vec2(-1, -1), vec2(3, -1), vec2(-1, 3)
```

No vertex buffers, no index buffers.

### Uniforms

| Field        | Purpose                                               |
| ------------ | ----------------------------------------------------- |
| `resolution` | Physical framebuffer size                             |
| `camera`     | Map-space center                                      |
| `mapSize`    | 2048 × 1024                                           |
| `hover`      | Hovered map cell, negative when none                  |
| `scale`      | Physical pixels per map pixel                         |
| `time`       | Seconds for ocean animation                           |
| `zoom`       | Camera zoom factor for pixel-grid gating              |
| `dpr`        | Device pixel ratio for screen-constant hover outlines |

The uniform struct is 48 bytes in a 64-byte buffer (std140-friendly padding).

### Fragment behavior

1. Map screen pixel → map coordinates.
2. Outside map: deep-water gradient, faint coordinate grid, edge glow.
3. Inside map: sample the nearest control texel and four neighbours.
4. Land:
   - palette owner color;
   - shade-based brightness;
   - terrain contours from shade bands;
   - deterministic per-pixel grain;
   - darker one-pixel owner frontier;
   - pale coastline where adjacent to ocean;
   - pixel grid at high zoom.
5. Ocean:
   - two animated sine waves;
   - coast glow;
   - sparse grid;
   - darker owner frontier is not relevant.
6. Map edge highlight.
7. Hover box/crosshair scaled in screen space.
8. Vignette to improve HUD legibility.

The shader is intentionally procedural. No map art assets are required at runtime.

### Visual invariants

- Owned vs unclaimed land must remain distinguishable by color.
- Territory boundaries must be visible against both land and other owners.
- Ocean cannot be mistaken for owned territory.
- The map must not become a flat solid block when zoomed out.
- Animated water must not obscure ownership.

---

## 6. Camera

`MapCamera` handles:

- fit scale = `min(viewportWidth / mapWidth, viewportHeight / mapHeight)`;
- zoom multiplier in `[0.82, 18]`;
- pan in CSS pixels;
- zoom-at-pointer preserving the map point under the cursor;
- centering/clamping so the camera cannot show only void at high zoom;
- screen ↔ map transforms in CSS pixels.

The renderer receives:

```text
physical scale = camera.scale * dpr
```

DPR is capped at 2 to control fill rate and backing-buffer size. A 4K display with DPR 2 can still cost significant fill; future adaptive resolution could cap physical pixels instead of DPR.

### Coordinate conversion for input

`GameCanvas` uses `canvas.getBoundingClientRect()` and `camera.screenToMap(x, y)`, then floors to integer cells. Pointer capture makes drags reliable outside the canvas.

---

## 7. Frame scheduling

- Continuous `requestAnimationFrame` while the component is mounted.
- Simulation steps are driven by a separate fixed-step accumulator.
- Simulation can be paused without stopping rendering (water and camera remain smooth).
- Snapshot updates go to Svelte at 10 Hz; not every frame.
- Camera view reports are throttled to ~140 ms to limit Svelte updates.
- Render stats are reported once per second.

### Why continuous instead of on-demand

Ocean shimmer and pointer-driven zoom/pan need smooth frames. A full-screen fragment pass is cheap relative to a 2.1M-cell CPU update, so continuous rendering is acceptable at this scale. If battery life becomes a priority, add a render-on-demand mode that freezes water while idle.

---

## 8. Performance

### Baseline measured in headless Chrome

| Measurement                 | Value                                        |
| --------------------------- | -------------------------------------------- |
| Panning under ~209 fronts   | 144 fps; p99 7.1 ms; zero frames >10 ms      |
| Upload traffic under stress | ~21M pixels/s, ~80 calls/s (adaptive resync) |
| Initial upload              | 2.1M pixels (8 MiB), before first frame      |
| Draw calls                  | 1                                            |
| Control texture             | 8 MiB CPU + 8 MiB GPU                        |
| Compute per fragment        | 5 texture samples + arithmetic               |

These are not guarantees. GPU fill rate, display size, DPR, browser compositor, and background throttling all affect results.

### Budgets

| Metric                         | Budget                             |
| ------------------------------ | ---------------------------------- |
| Tick-boundary upload work      | < 2 ms main-thread                 |
| Full-frame GPU time at 1440p   | < 4 ms on mid-range hardware       |
| JS renderer overhead per frame | < 1 ms                             |
| CPU texture updates per tick   | < 2 ms for ≤ 8,000 changes         |
| Frame pacing under stress      | 0 frames >10 ms above rAF baseline |
| Frame pacing                   | Stable 60 fps on integrated GPU    |

### Profiling

- HUD shows `fps`, `uploadedPixels`, and `uploadCalls` from the renderer. Calls/s is the quickest signal that the dense-resync path is active.
- Use Chrome DevTools Performance for JS and GPU traces.
- For WebGPU timings, use `timestamp-query` with a separate profiling build if needed.
- Always compare before/after with the same camera position, zoom, and map state.

---

## 9. Error handling

- Missing `navigator.gpu`: throw `WebGPUUnavailableError` with browser guidance.
- No adapter: throw with hardware-acceleration guidance.
- No canvas context: throw.
- Shader compilation errors: `getCompilationInfo()` messages are surfaced in the error overlay.
- Device loss: `device.lost` fires `onDeviceLost`, and the UI shows an error overlay.
- Change buffer overflow: full CPU/GPU resync, not an error overlay.
- Invalid packed pixel index: skipped by the renderer; full resync remains available.

There is no WebGL2 or Canvas2D fallback in v0.1. The minimap is Canvas2D, but it is not a substitute for the map renderer.

---

## 10. Testing the renderer

Automated browser smoke checks used during development:

1. Start dev server.
2. Open a seeded world.
3. Assert no error overlay appears.
4. Deploy and wait for a few ticks.
5. Assert the HUD appears and the perf readout is nonzero.
6. Click a border cell and assert a success toast.
7. Toggle pause and assert the tick counter freezes.
8. Resize to a mobile viewport and assert no horizontal overflow.

These checks are not currently committed as an E2E suite because WebGPU support in CI is inconsistent. If CI gets a software GPU (Dawn/SwiftShader) or a hardware runner, add Playwright tests and gate merges on them.

Unit tests can cover camera math and packing/unpacking without a GPU.

---

## 11. Future rendering work

1. **WebGL2 fallback** if browser coverage becomes a product requirement.
2. **Adaptive resolution** for high-DPR/low-power devices.
3. **Render-on-demand mode** to pause water animation and idle frames.
4. **Map labels and attack vectors** as a second overlay pass or shader input.
5. **Fog of war** requiring a visibility mask texture and likely a second control channel.
6. **Larger maps** requiring texture-array tiling, frustum culling, and more aggressive dirty-tile uploads.
7. **Post-processing** (bloom/grade) only after the base pass budget is measured.
8. **GPU timestamps** for real performance regression tests.
