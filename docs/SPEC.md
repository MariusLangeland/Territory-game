# TERRITORY — Specification

**Version:** 0.2.2 (attack stress experiment)  
**Status:** Local attack-focused stress build; online design target  
**Last synchronized with:** application 0.2.2, map version 2, protocol draft 4

This is the canonical description of what Territory is, what the current build does, and which technical contracts must hold. [ARCHITECTURE.md](ARCHITECTURE.md) explains the code; this document explains the intent and current rules. Temporary deviations are tracked in [EXPERIMENTS.md](EXPERIMENTS.md).

> **Important:** The economy has been temporarily removed to focus on the attack feature. Resource-free, unthrottled-by-troops attacks are **not the intended final combat model**. See section 4.10 and [EXPERIMENTS.md](EXPERIMENTS.md).

---

## 1. Product definition

### 1.1 One-line pitch

A fast, readable territory war played on a very large pixel atlas, where every pixel can change hands and outcomes can be replayed deterministically.

### 1.2 Reference point

OpenFront is the closest genre reference: a browser strategy game with a huge pixel territory map, real-time expansion, and rival states. Territory is not a clone and does not reuse OpenFront assets or code.

### 1.3 Design pillars

1. **The map is the game.** Ownership is pixel-resolution. Growth must be satisfying at combat zoom and readable at world zoom.
2. **Determinism is a feature.** A seed plus ordered commands must reproduce a match. Networked clients and the server must agree bit-for-bit.
3. **Speed is a feature.** A tick must not stall rendering, and no single frame may synchronously upload the whole map. Heavy map resyncs are chunked across frames.
4. **Readable conflict.** A player should understand within a second who owns a region, where their frontier is, and what a click will do.
5. **Online-ready boundaries.** Simulation, rendering, and UI communicate through contracts a server can adopt without a rewrite.

### 1.4 Long-term match shape (target, not current)

- 8 human states (or configurable rooms), with bots filling empty seats.
- One shared 2048 × 1024 atlas, approximately 38% land.
- Fixed 10 Hz simulation.
- Land generates a resource; attacks cost resources and time.
- Final attack semantics are **undecided**. The current free flood-fill front is a stress-test stand-in.
- Victory by last state standing or a future objective system.

---

## 2. Current build: attack stress experiment

### 2.1 Purpose

Exercise the attack pipeline in isolation:

- 107 AI states + one human all attacking continuously.
- Dense territory collision and simultaneous fronts.
- Hundreds of ownership changes per tick.
- Many dispersed texture upload regions.
- Large frontier-set and attack-queue workloads.

The user explicitly requested removing troops/income and adding 100 AI opponents. This build is an engineering experiment, not a balance proposal.

### 2.2 Implemented

| Area                                                      | Status                   |
| --------------------------------------------------------- | ------------------------ |
| 2048 × 1024 seeded procedural atlas                       | ✅                       |
| Land/ocean mask and terrain relief                        | ✅                       |
| 108 states (1 human + 107 AI)                             | ✅                       |
| Pixel ownership and incremental frontier tracking         | ✅                       |
| Resource-free local-front attacks (BFS)                   | ✅                       |
| 3 active fronts per human / 2 per bot (technical guard)   | ✅                       |
| Bot expansion/attacks                                     | ✅                       |
| Elimination and last-state-standing victory               | ✅                       |
| Pause, camera pan/zoom/fit/focus                          | ✅                       |
| WebGPU renderer with adaptive dirty-tile/chunked uploads  | ✅                       |
| Minimap, virtualized 108-state leaderboard, perf readout  | ✅                       |
| Seed input, URL seed, new world, rematch                  | ✅                       |
| Intro, field manual, defeat, result, WebGPU error screens | ✅                       |
| Deterministic tests + attack stress tests + benchmark     | ✅                       |
| Economy, troops, income, caps, costs                      | ❌ intentionally removed |

### 2.3 Not implemented

| Area                                                    | Target                                         |
| ------------------------------------------------------- | ---------------------------------------------- |
| Final attack design                                     | Undecided; must replace the experimental model |
| Authoritative game server, rooms, reconnect, prediction | [NETWORKING.md](NETWORKING.md)                 |
| Human-vs-human play, lobbies, spectating                | [ROADMAP.md](ROADMAP.md)                       |
| Accounts, progression, persistence                      | [ROADMAP.md](ROADMAP.md)                       |
| Replay viewer                                           | [DETERMINISM.md](DETERMINISM.md)               |
| Fog, diplomacy, audio, pinch zoom, WebGL fallback       | Backlog                                        |

---

## 3. Vocabulary

| Term                 | Meaning                                                                                |
| -------------------- | -------------------------------------------------------------------------------------- |
| **Cell / map pixel** | One element of the 2048 × 1024 ownership grid                                          |
| **Owner**            | State id `1..108`; `0` means unclaimed                                                 |
| **Territory**        | Count of land cells owned by a state                                                   |
| **Frontier**         | An owned land cell with an adjacent land cell owned by someone else (unclaimed counts) |
| **Front / attack**   | A deterministic BFS flood that captures connected target-owned cells                   |
| **Tick**             | One fixed simulation step, 100 ms                                                      |
| **Command**          | An attack intent applied at a tick boundary                                            |
| **Snapshot**         | Read-only UI view produced after a tick                                                |
| **Change batch**     | Packed owner/index words emitted for the renderer                                      |
| **Seed**             | 32-bit value that regenerates the exact map and starting positions                     |

---

## 4. Current rules

All numeric values come from `src/lib/game/constants.ts`. Outcome-affecting changes require a version bump and updated tests.

### 4.1 The world

- 2048 × 1024 cells (2,097,152 total).
- Generator targets 38% land.
- Static binary land mask and 8-bit terrain shade.
- Ocean cannot be owned.
- Map and starts are deterministic from the seed and versioned by `MAP_VERSION`.
- `MAP_VERSION = 2`; `PROTOCOL_VERSION = 2`.

### 4.2 Starting positions

- 108 start points are selected by farthest-point sampling over high-density land candidates, seeded deterministically.
- A preferred minimum spacing of 34 cells prevents initial beachheads from overlapping.
- The first start is near the map centre; subsequent starts maximize distance from existing starts.
- Starting territory is a ragged disc of radius approximately **16 cells**, clipped to land, with deterministic per-cell frontier wobble.
- A fallback guarantees every state begins with at least one owned pixel.
- Initial total claimed land is roughly 65K pixels (~8% of land). Each state starts with only territory; no resources exist.

### 4.3 Attack lifecycle

1. Player clicks a cell. `enqueueAttack` validates against current state for immediate UI feedback.
2. A valid click queues an attack command, applied at the start of the next tick.
3. The clicked cell's current owner becomes the **target owner** (neutral or rival).
4. The simulation searches a 34-cell radius for cells of the target owner adjacent to the attacker's territory. These become seeds.
5. Seeds are sorted by squared distance from the click, then by pixel index, and capped at 96.
6. Launch is free and requires no troops. Up to **3 attacks** may be active per human state; bots use a limit of 2.
7. Each tick, each front processes its FIFO queue until it has captured **30** valid target-owned cells or the queue is exhausted. Stale cells (no longer target-owned) are skipped without consuming the capture budget.
8. Before every capture, the cell must still share a land edge with territory owned by the attacker. If another front severed the path back to the attacker, the queued cell is discarded. A front can never create a detached enclave.
9. Capturing a cell claims it for the attacker and enqueues its four neighbours if they are still owned by the target and are land. Duplicates are tolerated; ownership is the visited check.
10. **Orders are finite:** a front expires **50 ticks (5 seconds)** after creation (`ATTACK_LIFETIME_TICKS`) even if it still has legal frontier cells.
11. The front also ends early when its queue is exhausted or a tick produces **zero legal captures**. A severed front peters out immediately rather than idling or continuing through disconnected cells.
12. Attacks are processed in creation-id order. If another front takes a cell first, the later front skips it.
13. A front continues only while it has at least one legal cell adjacent to the attacker's territory and its 5-second lifetime has not elapsed.

### 4.4 Valid attack clicks

An attack is valid only if:

- the match is not ended,
- the attacker is alive,
- the clicked coordinate is on land,
- the clicked cell is not owned by the attacker,
- the attacker has fewer than the technical active-front cap,
- at least one target-owned cell within 34 cells touches the attacker's territory.
- adjacency is checked again when the command executes and on every captured cell.

There is no troop/resource check. Failure reasons: ocean, own territory, no shared border, too many active attacks, eliminated, match over, invalid coordinates.

### 4.5 Borders

- A frontier cell is owned land with at least one adjacent land cell owned by a different owner (including unclaimed).
- Each state's frontier is stored as a `Set<number>` derived cache.
- It is maintained incrementally on claim and rebuilt at spawn.
- Coastal-only owned pixels with no land neighbours are not frontier cells.
- The attack queue does not use this set to expand; it uses ownership plus attacker-adjacency checks on neighbours. Border connectivity is revalidated at capture time, not just at enqueue time.

### 4.6 Attack queues

- Queue storage is a growable `Uint32Array` per active front.
- `queueLength` is the live count and `head` is the next unprocessed entry.
- There is no per-attack visited set. Once a cell is captured, its owner changes, so re-enqueued copies fail the ownership check.
- Queues compact processed entries after 4,096 cells to limit retained memory.
- A front's queue can become large while consuming a large connected region. This is a known stress characteristic and part of the reason the attack model is experimental.
- If a queued cell no longer touches the attacker's territory, it is skipped. If a whole tick captures nothing, the front is removed. This prevents fronts from phasing through opposing attacks and leaving enclaves.

### 4.7 Eliminations and victory

- After attacks resolve, a state with zero owned land is eliminated.
- Its frontier is cleared and its active attacks are dropped.
- The last living state wins; the tick loop stops advancing.
- If the human is eliminated, the UI pauses and offers spectate/rematch/new world. Spectating resumes the simulation.

### 4.8 Bots

- 107 AI states.
- Bots act once per second (`BOT_DECISION_INTERVAL = 10`).
- A bot with fewer than 2 active attacks samples its frontier deterministically up to 8 times and launches one attack when it finds a valid adjacent target.
- It attacks neutral neighbours whenever its sampled frontier has one, and only attacks a rival when no neutral option exists. This is a provisional stress-build policy, not final AI.
- Bots use the same attack API and limits as the human.
- Bots share one seeded PRNG, processed in ascending player-id order, so behavior is replayable.
- With no economy, bots attack from the first decision tick and saturate the map quickly.

### 4.9 Tick order

1. Increment `tick`.
2. Apply queued attack commands sorted by `(sequence, playerId)`.
3. Run bot decisions (only on every 10th tick).
4. Process active attacks in creation-id order.
5. Eliminate states with no territory and remove their attacks.
6. Check victory.
7. Build the public snapshot.

No economy phase exists in this experiment.

### 4.10 Experimental attack caveats

This attack model is intentionally provisional:

- It has no resource cost, cooldown, supply, or strategy limit beyond a technical active-front cap.
- It flood-fills through an arbitrarily large connected region, producing geometric (often diamond-like) territory growth.
- It ends when its frontier is exhausted, its land connection to the attacker is severed (zero legal captures in a tick), or its 5-second lifetime expires.
- Bots do not coordinate or defend strategically.
- The 108-state match may become a near-even patchwork.
- Attack limits exist to keep the stress test bounded and are **not** a game-design decision.

The final design may introduce costs, supply, attack duration, cancellation, target selection, and different propagation rules. Do not build balance or progression on the current semantics. See [EXPERIMENTS.md](EXPERIMENTS.md).

### 4.11 Combat randomness

Combat has no dice, crits, spread, or morale. Given the same state and accepted commands, every pixel outcome is deterministic.

---

## 5. Player experience

### 5.1 Screen flow

1. **Boot/loading:** map, starts, and WebGPU initialisation.
2. **Intro:** seed load, deploy. Simulation paused. Copy identifies the attack stress build.
3. **Live match:** 108-state HUD, virtualized scrollable leaderboard, map, minimap, status console, perf readout.
4. **Paused:** fixed ticks stop; camera still works.
5. **Defeat:** human has no territory; spectate/rematch/new world.
6. **Result:** last state wins; final standings.
7. **Field manual:** explains the experiment, orders, camera, system.
8. **WebGPU unavailable:** actionable error screen.

### 5.2 HUD

- Brand with attack-stress identification and 108 states.
- Human name/color, land share, rank, living-state count.
- War clock.
- Pause/resume, field manual, new world.
- World-control leaderboard: 108 logical rows in a virtualized scroll container; only the visible window is mounted, sorted by alive, then territory, then id.
- Active fronts and alive state count.
- War feed for eliminations/victory.
- World claimed meter.
- Minimap with camera rectangle and start positions.
- Status console: hover coordinate/ownership and human active orders.
- Zoom/fit/focus tools; FPS, uploaded pixels/second, and texture write calls/second.
- HUD data refreshes at 5 Hz; territory rendering and simulation remain at 10 Hz.
- Leaderboard virtualization: only visible rows plus overscan exist in the DOM.

### 5.3 Controls

| Input          | Action                              |
| -------------- | ----------------------------------- |
| Left click/tap | Issue a free attack if valid        |
| Left drag      | Pan; a drag does not fire an attack |
| Wheel          | Zoom at pointer                     |
| Space          | Pause/resume                        |
| `F`            | Fit map                             |
| `C`            | Focus human beachhead               |
| `+` / `−`      | Zoom                                |
| `H`            | Field manual                        |
| Minimap click  | Center camera                       |

### 5.4 Camera

- Default: human start, 3.8× fit zoom.
- Range: 0.82×–18×.
- Clamped to the map at high zoom.
- CSS-pixel input, DPR capped at 2.
- Pausing/UI interaction must not move the camera unexpectedly.

### 5.5 Feedback

- Valid order → toast.
- Invalid order → specific reason toast.
- Human attack targets drawn on minimap.
- Hover outline and ownership label.
- Active human attack count in status console.
- 108-state leaderboard scrolls via virtualization; rank numbers are absolute and the human row is highlighted when visible.
- Paused clicks do not issue orders.

### 5.6 Accessibility/responsive

- Buttons have labels/focus states; reduced-motion support.
- Desktop: topbar, scrollable right rail, minimap, status console, tool rail.
- Narrow: right rail/key hints collapse, topbar compresses, minimap/status shrink.
- Pinch zoom missing; mobile parity not claimed.

---

## 6. Technical contracts

### 6.1 Layer boundaries

| Layer            | May read                      | May mutate                              | Must not                             |
| ---------------- | ----------------------------- | --------------------------------------- | ------------------------------------ |
| Simulation       | constants, map, RNG           | owners, players, attacks, change buffer | DOM, clock, randomness, renderer, UI |
| Renderer         | sim arrays + change batch     | control texture, GPU resources, camera  | mutate sim state                     |
| UI               | snapshots, camera bridge      | UI state                                | mutate ownership                     |
| Network (future) | intents, snapshots, checksums | authoritative command queue             | trust client state                   |

### 6.2 Fixed-step driver

- rAF accumulator, 250 ms catch-up cap, max 4 simulation steps/frame.
- Paused/ended: no ticks.
- Simulation never reads wall-clock time.
- Camera and render loop are independent.

### 6.3 Snapshot and change batch

- Snapshot after each tick; no direct simulation arrays in UI.
- Change batch: `(owner << 21) | pixelIndex`, `Uint32Array(16_384)`.
- Consumed before the next tick.
- Overflow triggers renderer full resync and never changes game state.

### 6.4 Player payload

Current public player fields:

```ts
{
	(id, name, isBot, alive, territory, landShare);
}
```

No troops, income, or other economy fields exist.

---

## 7. Determinism contract (summary)

Full detail: [DETERMINISM.md](DETERMINISM.md).

1. Same build + map version + seed + ordered commands ⇒ same state and checksum.
2. No wall clock, frame rate, camera, device, UI, or unseeded randomness in decisions.
3. Ownership and positions are integer; attacks have no float math.
4. PRNG seeded; bot draw order fixed by ascending player id.
5. Commands apply at tick boundaries in stable order.
6. Attack ordering by creation id; queue processing FIFO; neighbour enqueue order W/E/N/S.
7. Checksums cover tick, RNG, attack ids/queues, owners, players, winner.
8. Any behavior change requires tests and a protocol-version decision.

---

## 8. Rendering contract (summary)

Full detail: [RENDERING.md](RENDERING.md).

1. One 2048 × 1024 `rgba8unorm` control texture and a 256 × 1 palette texture.
2. R = owner id, G = land, B = terrain shade, A unused.
3. Per-tick changes normally upload 32 × 32 dirty tiles merged into strips. Above 96 dirty tiles, an adaptive full-texture resync is queued and uploaded in eight horizontal chunks, at most two per frame. No frame does a synchronous full-map upload.
4. One full-screen triangle and one fragment shader.
5. Renderer never mutates simulation state.
6. WebGPU failure is explicit; no silent blank map.
7. DPR capped at 2.
8. Shader differences across GPUs cannot affect simulation.

---

## 9. Networking target (summary)

Full detail: [NETWORKING.md](NETWORKING.md).

- Server-authoritative intents, deterministic 10 Hz simulation.
- Clients may run local prediction.
- Server stamps commands with authoritative ticks; deterministic ordering.
- Owner deltas/checksums/baseline resync.
- No server exists yet.
- Wire types are in `src/lib/game/net/protocol.ts`; current player payload has no economy fields.

---

## 10. Performance requirements

| Area                                          | Target                                               |
| --------------------------------------------- | ---------------------------------------------------- |
| Simulation tick, 108 states under attack load | < 2 ms p95 (10 Hz budget = 100 ms)                   |
| Render loop                                   | 60 fps at 1600 × 1000 under stress                   |
| Input smoothness under full attack load       | no recurring 10 Hz hitch; 0 frames >10 ms at 144 fps |
| Tick-boundary upload work                     | < 2 ms; full resync must be chunked                  |
| Map generation + 108 starts                   | < 500 ms                                             |
| Checksum                                      | On demand, < 20 ms                                   |
| Browser JS/GPU memory                         | < 300 MiB total for the stress build                 |
| Input latency                                 | Click-to-frontier update ≤ 2 ticks                   |

See [PERFORMANCE.md](PERFORMANCE.md) for measured results and method.

---

## 11. Failure handling

| Failure                      | Behavior                                    |
| ---------------------------- | ------------------------------------------- |
| No WebGPU/adapter            | Error overlay                               |
| Shader compile error         | Error overlay with compiler text            |
| Device lost                  | Error callback/overlay                      |
| Change buffer overflow       | Renderer full resync; simulation unaffected |
| Invalid pixel index          | Skip; resync available                      |
| Map/start generation failure | Error state                                 |
| Tab suspended                | Catch-up capped at 4 ticks                  |
| Undefined palette id         | Falls back to neutral color                 |

---

## 12. Acceptance criteria — v0.2 attack stress

- [x] All 108 states spawn with nonzero territory.
- [x] Same seed and commands produce identical checksums with all bots attacking.
- [x] Ownership is always land-only; territory totals match owner counts.
- [x] Fronts resolve without corrupting frontier sets.
- [x] Change buffer does not overflow in stress runs.
- [x] Clicking a valid frontier creates a free attack with no economy check.
- [x] HUD and leaderboard scale to 108 logical rows and active counts, with DOM virtualization.
- [x] Panning stays smooth under full stress (0 frames >10 ms in the verification run).
- [x] 108-state browser run stays interactive at 1600 × 1000; panning under ~209 fronts measured 144 fps with zero frames >10 ms.
- [x] `pnpm check`, `pnpm test`, `pnpm build` pass.
- [x] Docs clearly state that current attack semantics are experimental.
- [ ] Final attack model decided and implemented.
- [ ] Economy restored or replaced.

---

## 13. Open questions

1. **Final attack model:** cost/resource, duration, cancellation, targeting, propagation shape, and limits?
2. **Economy:** what resource and generation model returns, and how it throttles attacks?
3. **Match size:** 108 is a stress mode. What is the shipping player/state count?
4. **Match duration/pacing:** unthrottled attacks saturate the map in ~10 seconds.
5. **Leaderboard scale:** scroll, pagination, or top-N with pinned player?
6. **Queue bounds:** is an attack allowed to flood an arbitrarily large connected region?
7. **Server tick buffer:** how much latency to absorb in online play?
8. **Map format:** procedural generation vs baked assets for cross-engine certainty?
9. **Simulation worker:** when to move off the main thread?
10. **WebGL fallback:** worth the maintenance cost?
