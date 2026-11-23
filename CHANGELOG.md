# Changelog

## 0.77.0 — 2026-11-23

### Project structure

- Moved all worker-owned simulation code into `src/lib/game/worker/`:
  host, client, protocols, local facade, worker entry, and tests.
- Extracted shared worker `WorkerMatchInit`/`WorkerVisual` payloads into
  `worker/protocol.ts`; evolution-specific commands stay in `ai/`.
- Replaced the misnamed `RemoteEvolutionSimulation`/`evolution-view.ts` with the
  shared `RemoteSimulationView`/`worker/view.ts`.
- Added `SimulationView` as the read-only renderer/UI contract. `GameCanvas` and
  `Minimap` no longer cast worker mirrors through `TerritorySimulation`.
- Moved the built-worker smoke test into CI after the production build.
- Extracted the main game's 3,096-line scoped stylesheet into
  `src/routes/game-page.css`, scoped under `.game-shell`, cutting `+page.svelte`
  from 5,773 to ~2,500 lines.
- Added `session/game-session.ts`; the page no longer loads bot rosters, creates
  workers, tracks generations, timers, or disposes workers directly.
- Added `session/seed.ts` and `session/onboarding.ts`; URL seed parsing and
  onboarding persistence no longer live in the page.
- Moved HUD formatting helpers into `lib/format.ts`; page commands and
  pause/resume now go through the session facade.
- Extracted player actions into `ui/actions.ts`, keyboard input/cursor handling
  into `ui/keyboard.ts`, and context-menu construction/focus handling into
  `ui/structure-menu.ts`.
- Extracted `DiplomacyToast`, `UpgradeTooltip`, and `StructureMenu` UI components.
- Extracted `GameTopBar` (commander/clock/actions) and `WorldRail`
  (leaderboard/war feed) components.
- `+page.svelte` is now ~1,975 lines, down from 5,773 before the restructure.
- No gameplay, protocol, or deterministic behavior changed.

## 0.76.0 — 2026-11-23

### Worker-owned local simulation

- Moved local match stepping, bot decisions, and territory-integrity scans into a
  dedicated Web Worker.
- The main thread now renders from a read-only mirror and receives owner/render
  deltas; it no longer runs `TerritorySimulation.step()`.
- Commands are forwarded asynchronously to the worker and validated there.
- Added worker pause/resume, deterministic command results, telemetry delivery,
  and full worker disposal on world rebuild/unmount.
- HUD updates remain throttled to 5 Hz while territory rendering continues at
  10 Hz.
- Worker visuals carry per-capture district palette bytes and full owner/district
  arrays on overflow, so district rendering tracks captures live.
- Hover attack-cost previews use the same 34 px border search radius as
  authoritative attack validation.
- Added worker host tests covering init, stepping, pause/resume, commands, and
  deterministic checksums, plus `pnpm test:worker`, which boots the built worker
  bundle and verifies init transfer, visual deltas, commands, and paused ticks.
  The same smoke runs at 4096×2048 with 51 states via `WORKER_SMOKE_WIDTH` /
  `WORKER_SMOKE_HEIGHT` / `WORKER_SMOKE_PLAYERS`.

Known parity notes for UI verification: hover/upgrade previews use mirror
approximations, and the browser worker path has not been exercised by automated
browser tests.

## 0.75.1 — 2026-11-23

### Client performance

- Investigated large-map client stutter: normal 4096² ticks average ~1.8 ms, but
  annex scans average ~41 ms and neutral-pocket cleanup ~81 ms on the main
  thread.
- Full-texture resyncs now use a fixed 512K-pixel chunk budget (~4 MiB/frame)
  instead of splitting by height, preventing oversized upload frames on large
  atlases.
- The full-resync dirty-tile threshold now scales with atlas tile count.
- Minimap base refreshes every 6 ticks above 8.4M cells.
- Documented that integrity-scan time-slicing or worker offload is the required
  next fix for fully smooth large-map clients.

## 0.75.0 — 2026-11-23

### Arbitrary map sizes

- Default atlas doubled per side: **4096 × 2048** (8,388,608 cells).
- Map presets are now 4096×2048 / 3072×1536 / 2560×1440.
- Match setup accepts custom width/height up to **8192 px per side** and
  **2²⁶ total cells**.
- Expanded packed ownership changes from 21 to **26 index bits**, preserving six
  owner bits and supporting every atlas within the GPU-safe limits.
- Map generation validates arbitrary dimensions instead of assuming
  2048×1024.
- Bumped `MAP_VERSION` to **5** and wire protocol to **41**.

## 0.74.1 — 2026-11-23

### Online capacity

- Set a single-process support target of **200 concurrent human players at
  10 Hz**, packed as 25 rooms × 8 humans on the compact 1280×720 online arena.
- Added 25-room / 200-player admission caps and `/api/online/metrics`.
- Added `pnpm bench:online`, which gates p95 ≤ 50 ms, p99 ≤ 300 ms, and RSS
  ≤ 1.5 GiB.
- Online rooms now default to the compact arena to sharply reduce per-room
  memory; reference result is ~969 MiB and 5.8 MiB/s outbound for 200 players.
- Coalesced SSE ticks so a slow client delays one frame instead of accumulating
  an unbounded queue.

## 0.74.0 — 2026-11-23

### Online multiplayer MVP

- Added authoritative online rooms: create/join a room code, up to four human
  seats, bots fill every remaining seat, and the host starts the match.
- Added a server-side 10 Hz tick loop, intent sequence validation, rate limits,
  authoritative player ids, baseline welcome snapshots, and SSE tick streaming.
- Added multi-human simulation support: per-seat supply, hands, income accrual,
  and viewer-specific snapshots while preserving local single-player defaults.
- Added `/online` lobby and live match UI with cards, upgrades, attacks,
  artillery targeting, cancel-front, server connection state, and share links.
- Added `online-room` tests covering seat assignment, host start, monotonic
  intents, per-viewer snapshots, owner-baseline RLE, and mid-match reconnect.
- Wire protocol bumped to 40.

Limitations in this MVP: rooms are in memory and lost on server restart; late
join after start is rejected (reconnect with the same session is supported);
tokens live in session storage; no accounts, chat, persistence, or matchmaking;
transport is HTTP/SSE rather than WebSocket.

## 0.73.0 — 2026-11-23

### Diplomacy

- Implemented player-only alliances: request an AI ally from the rival context
  menu, deterministic bot acceptance, 30-second proposals, three-minute pacts,
  non-aggression, common-enemy coordination, proportional front cancellation,
  betrayal cooldown, and expiry/elimination cleanup.
- Added allied-capital rings, an `ALLY` / `PENDING` label in rival banners, an
  alliance-aware attack cursor, remaining-time context-menu labels, and
  alliance result toasts.
- Protocol 39 adds `alliances` and `allianceProposals` to snapshots.
- Added tests for acceptance, rejection, allied attack blocking, front
  cancellation, break cooldown, expiry, elimination cleanup, and checksum
  determinism.

## 0.72.0 — 2026-11-23

### Gameplay

- **Organic growth is locked for player matches.** The intro and HUD growth
  selectors are removed; circular and smooth remain internal test/benchmark
  implementations only.
- New match modifier: **500-STACK SURGE** gives every AI commander a starting
  500-stack Command Post for high-economy stress matches. It is saved with match
  defaults and leaves the human commander unchanged in standard matches.

- Ports snap to the nearest valid owned shoreline within 24 px and may be placed
  inside unrelated districts without joining or upgrading them.
- Eliminating a state now grants the credited attacker a permanent **+10
  supply/s**, stacking for each elimination.
- Bot attack, naval, and artillery decisions are staggered across the decision
  interval, removing the periodic all-bot decision spike while preserving each
  bot's cadence and attack-roll sequence.
- Bots now break out of the economy/defense loop: after the basic economy they
  fund a first Barracks, then cap-grow War Academies and field Artillery.
- Annexation transfers are queued and drained at a fixed per-tick budget, and
  Port land-component walks are shared per component, removing the large
  late-game annex hitch.

- Alliances are implemented: request an AI ally from the rival context menu,
  wait for deterministic bot acceptance, gain non-aggression/coordination for
  three minutes, and optionally break the pact with a betrayal cooldown.

### UI

- Right-click structure context menu with **Demolish Structure** as its first
  action. Demolition is command-driven, applies on the next tick, and pays no
  refund. State and rival structures cannot be demolished.
- Right-click rival territory shows a **Request Alliance** placeholder; the
  alliance mechanic is intentionally not implemented yet.
- Rival supply banners now show the number of fronts the rival could currently
  afford (`N ATK`).
- Rival supply banners use a dark translucent rounded background for legibility.

### Performance and reliability

- Weighted A* with route caching and early Port selection cut long naval landing
  request latency from roughly 150 ms to under 10 ms.
- Bot build-site and expansion caches are retained across ticks and invalidated
  locally.
- Annexation scans run every 3 seconds and are offset from decision traffic.
- Component labeling avoids modulo and redundant land checks.

### Documentation and tooling

- Added ADRs for staggered decisions, demolition, elimination income, and the
  deferred alliance mechanic.
- Updated generated rules reference, SPEC, determinism notes, README, and
  release checklist coverage.
