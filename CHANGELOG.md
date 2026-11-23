# Changelog

## 0.72.0 — 2026-11-23

### Gameplay

- Ports snap to the nearest valid owned shoreline within 24 px and may be placed
  inside unrelated districts without joining or upgrading them.
- Eliminating a state now grants the credited attacker a permanent **+10
  supply/s**, stacking for each elimination.
- Bot attack, naval, and artillery decisions are staggered across the decision
  interval, removing the periodic all-bot decision spike while preserving each
  bot's cadence and attack-roll sequence.

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
