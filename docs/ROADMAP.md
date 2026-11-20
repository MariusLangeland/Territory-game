# Roadmap

This is a delivery plan, not a promise. Each phase has a narrow outcome and acceptance criteria. Do not start a later phase while an earlier phase has a correctness or determinism hole.

---

## Phase 0 — Scaffold and playable slice ✅

**Outcome:** A browser game that proves the core ideas: large pixel map, deterministic simulation, WebGPU rendering, local skirmish.

Delivered:

- SvelteKit 3 / Svelte 5 / TypeScript project.
- 2048 × 1024 seeded atlas.
- Pixel ownership, attacks, border maintenance, elimination, victory.
- WebGPU renderer with dirty-tile uploads and strip merging.
- HUD, minimap, field manual, intro/result/defeat/error states.
- Seed loading, rematch, URL seed.
- Deterministic tests and benchmark.
- Specification and architecture docs.
- Responsive layout and WebGPU error handling.

> Phase 0 initially shipped with troops/income and 8 states. That economy is currently removed and the state count is 51 for the attack stress experiment below.

Acceptance criteria met:

- [x] `pnpm check`, `pnpm test`, `pnpm build` pass.
- [x] Two identical simulations produce the same checksum.
- [x] Clicks expand/attack and update the HUD.
- [x] Pause freezes ticks.
- [x] Normal combat does not upload the full map per tick.
- [x] Unsupported WebGPU shows a useful error.
- [x] Desktop and narrow viewports do not overflow.

---

## Phase 0.5 — Attack stress experiment (current)

**Outcome:** Prove the attack pipeline stays deterministic and interactive with 51 states, light economies, and no troop/production caps, then decide what the real attack model should be.

Status: complete. Frontage v1 is implemented in 0.30.0; EXP-001 is retired. See [COMBAT_DESIGN.md](COMBAT_DESIGN.md).

Work completed:

- Replaced troops/production caps with one supply economy, build cards, durable fronts, and defense-derived capture costs.
- Added 50 AI states (51 total).
- Implemented spaced start placement for every state, with fallback.
- Replaced per-attack Sets/arrays with packed `Uint32Array` queues and ownership-based dedup.
- Reduced dirty tiles to 32 × 32 for dispersed fronts.
- Made the leaderboard virtualized and scrollable for 51 logical states.
- Added attack stress tests, an all-bot benchmark, and honest experiment documentation.
- Added deterministic headless match telemetry ([TELEMETRY.md](TELEMETRY.md)).
- Added threat-aware bot defense, supply reserves, and structure rebuilding.
- Replaced passive Mine with active Artillery: one shell per level, structure-level damage, bot use, and range/shell visuals.
- Removed the supply ceiling; added compact HUD formatting, infinite Barracks scaling, Fortifications, and global Jammer suppression with a stack cache for high-frequency effects.

Acceptance criteria:

- [x] All 51 states spawn with non-zero territory.
- [x] Deterministic with all bots attacking.
- [x] No ownership/border invariant failures under sustained load.
- [x] Browser stays interactive under sustained attack load.
- [x] No synchronous per-frame full-map upload; dense resyncs are chunked across frames.
- [x] Final attack semantics approved and implemented (Frontage v1).
- [x] Stress-only order economy replaced by supply, durable strength, refunds, and 70% victory.

**Exit condition met:** Frontage v1 replaces the free flood-fill experiment; economy work can continue against supply.

---

## Phase 1 — Harden the local game

**Outcome:** A vertical slice that a new player can understand and finish without developer guidance.

### Work

1. **Tutorial and onboarding**
   - Highlight a recommended first expansion.
   - One-time contextual prompts for the first attack and first rival contact.
   - Field manual link from the intro.
2. **Game feel**
   - Attack pulse/flash on recently captured pixels.
   - Front-line direction indicator.
   - Victory/defeat transitions and final standings polish.
   - Bot aggression and pacing tuned to a 4–10 minute match after the economy returns.
3. **Mobile parity**
   - Pinch zoom: implemented (two-finger, gesture-midpoint anchored, tap suppression).
   - Compact mobile hand/minimap/tool layout: implemented; 320–430 px test pass still pending.
   - Test at 320–430 px widths and touch scroll behavior.
4. **Accessibility**
   - Keyboard map navigation and attack alternative: implemented (arrow cursor, Enter, Shift, live status).
   - Screen-reader status for major events.
   - Color-blind palette check and non-color owner cues.
   - Reduced-motion mode tested.
5. **Simulation robustness**
   - Replay fixture tests at multiple ticks.
   - Property-style invariant tests for ownership vs territory counts.
   - Long-run soak test with bots.
   - Explicit match end conditions for edge cases (no land, simultaneous elimination).
6. **Operational quality**
   - GitHub Actions: install, check, test, build.
   - Add camera math and packing tests.
   - Add a browser smoke checklist.
7. **UX states**
   - Confirm before abandoning a live match.
   - Persist seed/settings locally.
   - Better copy for rejection reasons.
8. **Balance**
   - Measure average match length and human win rate.
   - Tune the final attack model, economy, and bot aggression from data. The current free-attack stress build is not a balance baseline.
   - Headless harness: `pnpm telemetry` ([TELEMETRY.md](TELEMETRY.md)).

### Acceptance criteria

- A new player can complete a match without reading source code.
- No unresolved ownership/territory/bootstrap invariant.
- Touch users can pan, tap, and pinch zoom.
- Long-run bot simulation stays stable for 30 simulated minutes.
- CI runs checks/tests/build on every PR.
- Performance baseline unchanged or improved with documented evidence.

---

## Phase 2 — Online MVP

**Outcome:** Two or more humans can play one authoritative match over the network, survive a reconnect, and verify deterministic agreement.

### Work

1. **Server skeleton**
   - Node WebSocket server, shared simulation import.
   - Room creation/join, one active match per room.
   - Server tick loop at 10 Hz.
   - Health/metrics endpoints.
2. **Protocol**
   - Implement `hello`, `join`, `welcome`, `tick`, `ack`, `reject`, `match-over`, `ping`.
   - Protocol/map version gating.
   - Binary or compact encoding for owner deltas.
3. **Authority**
   - Server-side validation of every intent.
   - Fixed ordering by tick/player/sequence.
   - Rejection reasons and UI feedback.
4. **Client integration**
   - Connection lifecycle, loading, reconnection.
   - Apply authoritative owner deltas to renderer.
   - Public player state and active attacks from server.
5. **Prediction and reconciliation**
   - Local responsiveness; authoritative correction.
   - Periodic checksums.
   - Baseline resync on mismatch.
6. **Join in progress**
   - Compressed owner baseline for late join.
   - Seat/player assignment.
7. **Bots**
   - Server-controlled bots in rooms that are not full.
   - Human disconnect: bot takeover or seat hold policy.
8. **Testing**
   - Headless two-client integration test with deterministic checksums.
   - Latency simulation.
   - Malformed input and rate limiting.
   - Reconnect and forced desync.

### Acceptance criteria

- Two clients complete a match with identical authoritative checksums.
- Arrival order does not affect outcomes under randomized delay.
- Reconnect resumes within the grace window without corrupting state.
- Late joins receive a valid baseline.
- Server rejects invalid ownership/attack attempts and logs them.
- No client can set territory or other authoritative values.
- Server tick p95 stays within budget with the load target.

---

## Phase 3 — Scale and live operations

**Outcome:** Multiple rooms per process, reliable deployment, match history, and a usable public online experience.

### Work

1. **Rooms and matchmaking**
   - Public/private rooms.
   - Region and latency-aware placement.
   - Matchmaking queue; fill with bots after a timeout.
2. **Persistence**
   - Match records, seeds, command logs, final checksums.
   - Player identity and accounts (or delegated auth).
   - Leaderboards/season metadata.
3. **Replays**
   - Export/import replay format from [DETERMINISM.md](DETERMINISM.md).
   - Server-side deterministic replay verification.
   - Match history viewer.
4. **Spectators**
   - Read-only tick stream.
   - Delayed spectating option for competitive integrity.
5. **Operations**
   - Room manager and worker health checks.
   - Metrics dashboards, alerts, tick lag, desync rate.
   - Graceful deploy: finish in-flight matches on old builds.
   - Backpressure, rate limits, abuse controls.
6. **Scalability**
   - Load test 100+ rooms; profile event loop.
   - Room placement and sharding.
   - Memory/GC monitoring.
7. **Community features**
   - Chat or emotes, with moderation and rate limits.
   - Private lobbies and seed sharing.

### Acceptance criteria

- Deployment does not corrupt in-flight matches.
- Match history and replay verification are available.
- Load target met with documented headroom.
- Incident runbook exists for desync, server crash, and room stuck states.
- Abuse controls tested.

---

## Phase 4 — Product polish

**Outcome:** A game that feels intentional and retains players.

Candidates:

- richer map generation and multiple biomes/maps;
- cosmetic palettes/themes;
- daily seed challenges;
- statistics and progression;
- refined bot AI and difficulty levels;
- tournament/season modes;
- audio and music;
- social features;
- WebGL fallback if support data demands it;
- simulation worker and further performance headroom;
- localization.

Prioritize by retention and fairness data, not by feature count.

---

## Backlog (unsorted)

- Fog of war / visibility.
- Alliances and pacts.
- Unit upgrades or leader abilities.
- Terrain effects (mountains, rivers).
- Naval traversal.
- Shipping state count/mode after the 51-state stress experiment.
- Map editor and shareable custom maps.
- Deterministic daily challenges.
- Spectator UI with timelines.
- In-game replay scrubber.
- Server-side anti-bot detection.
- Browser storage for settings and last seed.
- High-DPI adaptive rendering.
- Progressive Web App/installability.
- Web Worker simulation.
- WebGPU compute for min-map generation.
- Automated performance gate in CI.

---

## Sequencing rules

1. Never build matchmaking on top of a non-deterministic network loop.
2. Never ship prediction before the authoritative baseline is trustworthy.
3. Never add more authoritative state without updating checksums and tests.
4. Never accept "it looks right" for territory ownership; prove invariants.
5. Profile before optimizing, and record the method.
6. Keep all versions (app, map, protocol, simulation build) explicit in match metadata.
