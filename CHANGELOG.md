# Changelog

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
