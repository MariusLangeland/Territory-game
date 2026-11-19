# Experiments

Temporary builds that intentionally diverge from the main game design. They exist to answer a specific technical question, and they must have an exit plan.

---

## EXP-001 — Attack stress test with attack orders and light economy

**Status:** active in application `0.9.x`  
**Started:** 2026-11-19  
**Question:** Does the attack pipeline stay correct, deterministic, and fast with 108 states, 10-second attack-order refreshes, and a light human card economy?

### Motivation

The normal economy (troops, production caps, launch costs) limits how many attacks can run and how quickly the map changes. This experiment removes troops/production caps and keeps only attack orders, terrain defense, and a light human card economy to stress the actual attack path:

- many simultaneous flood-fill fronts,
- dense territory collision,
- hundreds of ownership changes per tick,
- many dispersed dirty texture regions,
- 108 frontier sets and bot decisions.

**This is not the intended final combat model.** Attack orders, cards, and structures are experimental layers on the attack stress test.

### Temporary rules

| Rule                     | Value                                                                              |
| ------------------------ | ---------------------------------------------------------------------------------- |
| States                   | 108 (1 human + 107 AI)                                                             |
| Troops / production caps | removed                                                                            |
| Gold / cards             | light human economy; 3 starting gold, +1/10s                                       |
| Attack launch cost       | 1 attack order                                                                     |
| Capture cost             | target pixel defense                                                               |
| Attack budget            | 30 points per attack per tick                                                      |
| Pixel defense            | `1 + elevation + occupied + aura` (1–27)                                           |
| Elevation                | six tiers, lowland through peaks                                                   |
| Attack lifetime          | 50 ticks / 5 seconds (`ATTACK_LIFETIME_TICKS`)                                     |
| Attack orders            | 3 human / 2 bots; refresh every 10 seconds                                         |
| Extra order gain         | Command Post: +1 every 60 seconds                                                  |
| Order cap growth         | War Academy: +1 refresh cap                                                        |
| Bot decisions            | once per second                                                                    |
| Starting territory       | radius ~16, ragged, spaced across the map                                          |
| Structures               | one capturable State structure per state at its capital                            |
| State aura               | +20 defense within 12 px; overlaps do not stack                                    |
| Human economy            | 3 starting gold; 1 gold / 10s; 3-card hand                                         |
| Build cards              | Mine 3g, Barracks 2g, Defense Post 1g, Command Post 4g, War Academy 6g; Refresh 1g |

Each launch consumes one attack order. Orders refresh to the cap every 10 seconds and are not refunded when a front ends. The attack still requires a shared land border with the clicked target's owner. It flood-fills through connected target-owned pixels, spends 30 attack points per tick, and continues only while every captured pixel remains edge-connected to the attacker's territory. A capture costs `1 + elevation` and one more if the pixel is occupied, so high ground and defended pixels fall more slowly. If opposing fronts sever that connection, candidates are dropped and a front with zero legal captures that tick peters out. Attacks process in creation-id order.

### Growth layers and territorial cleanup

Three modular frontier selectors are implemented and switchable from the HUD for **new orders**:

| Mode     | Expansion shape | Selection                                        |
| -------- | --------------- | ------------------------------------------------ |
| Circular | digital disc    | Euclidean-distance priority heap                 |
| Smooth   | rounded front   | nearest radial band + attacker-neighbour scoring |
| Organic  | irregular lobes | deterministic random frontier pick               |

Existing orders retain their original layer; bots and the human pick up the currently selected mode for newly created attacks on the next tick. Growth mode and per-frontier state are included in checksums. Distance-based layers grow from the centroid of the initial border contact; the click is only a target/search selector, so growth always emanates from the border.

Two cleanup rules plus the first structure are always active:

- **Mutual front cancellation:** if two states are attacking each other and a front touches land claimed by the opposing attack, every order between the pair ends and the contact line becomes the border.
- **State structure anchoring:** each state starts with one State structure at its capital. Every territory component connected to a live State structure is protected from annexation. Capturing the structure destroys it and removes protection.
- **State aura:** a live State projects +20 defense over a 12 px radius; overlapping auras take the maximum. Capturing the structure removes the aura immediately.
- **Human card economy:** start with 3 gold and 3 random cards from the five-type buildable pool. Income is 1 gold/10s plus 1 per Mine. Drag a card onto controlled, structure-free land to build it. Refresh costs 1 gold and replaces the hand with three fresh independent pool draws. Bots do not build yet.
- **Attack orders:** 3 for the human, 2 for bots, refreshed to the cap every 10 seconds. Command Posts add +1 order on each 60-second pulse; War Academies add +1 live refresh cap. Orders may exceed the cap through Command Posts.
- **Detached-land annexation:** once per second, and immediately after a cancellation, components without a live State structure are transferred to the owner of the adjacent protected mainland with the largest shared border.

This is the current attack-shape test surface, not a final gameplay choice.

### Intentional deviations

- There is no economy HUD.
- AI states attack automatically from tick 10 and prefer neutral land while it exists, so the experiment stresses attack throughput before rival dogpiling.
- Attack orders are now a gameplay constraint; the 10-second refresh is part of the experiment.
- The match may end quickly or settle into a patchwork; balance is not validated in this build.
- The leaderboard is scrollable because 108 states are alive at the start.
- Attack-order caps, refresh cadence, and the two order cards may change as stress findings demand.

### Success criteria

- [x] All 108 states spawn with at least one owned land pixel.
- [x] Ownership is always land-only and territory totals remain consistent.
- [x] Same seed + commands ⇒ same checksum with all 108 bots active.
- [x] Hundreds of simultaneous fronts run without corrupting borders.
- [x] Change buffer does not overflow during normal stress runs.
- [x] Browser stays interactive at 1600 × 1000; panning under ~209 fronts measured 144 fps with zero frames >10 ms.
- [x] No console/page errors during sustained run.
- [x] Tests and production build pass, including a live-run assertion that every captured pixel is edge-connected to its attacker.
- [x] A front with no legal captures in a tick is dropped and cannot leave an enclave.
- [x] Every attack order expires after 50 ticks / 5 seconds.
- [x] Circular, smooth, and organic layers can be switched live and are deterministic.
- [x] Each layer has focused tests and a benchmark comparison.
- [x] Distance-based layers anchor at the border contact; a deep click cannot pull a tendril inland.
- [x] Mutual attacks cancel at contact, and both states' pair orders die.
- [x] Detached territory is annexed by the surrounding protected mainland; unclaimed islands are left intact.
- [x] State structures anchor protection, are capturable, and disappear with their anchors.
- [x] Elevation tiers drive visible terrain color and base defense.
- [x] Occupied territory adds one defense, and high-defense fronts capture fewer pixels per tick.
- [x] State auras add +20 within 12 px and disappear with their structure.
- [x] Human economy pays income, draws three cards, consumes cards on drag-build, and supports paid refresh.
- [x] Mine income, Barracks attack strength, and Defense Post auras affect the simulation.
- [x] Attack orders are spent per launch, refresh every 10 seconds, and can be raised by War Academies or granted by Command Posts.
- [x] The card pool now contains five types, including the 4-cost Command Post and 6-cost War Academy.
- [ ] Decide the real attack model and retire this experiment.

### Findings so far

- 108 starts are feasible on the fixed atlas with a 16 px start radius and spacing enforcement.
- Bot fronts saturate the map in roughly 10 seconds when unthrottled; the resulting leaderboard is nearly tied and visually becomes a patchwork.
- A single global dirty rectangle would be catastrophic with this many fronts; 32 × 32 tile uploads are the normal path. At high front counts, tiles alone caused ~2,169 texture calls/s and panning stalls. The renderer now switches to an adaptive full-texture resync chunked across frames: ~21M pixels/s, ~80 calls/s, no measured frame above 10 ms while panning.
- 5 Hz HUD snapshots plus a virtualized leaderboard were required to remove the remaining tick-boundary DOM stalls (108-row updates produced ~14 ms frames).
- Replacing per-attack `Set<number>` + JS number arrays with an ownership-checked `Uint32Array` queue reduced benchmark RSS from ~529 MiB to ~189 MiB for two simulated worlds in the connectivity- and lifetime-checked build.
- Full-state checksum is ~19.6 ms (claim provenance doubles the owner-map pass) and is not run per tick.
- Growth-layer tick cost at 108 states: circular ~1.7 ms, smooth ~2.2 ms, organic ~1.5 ms (Node benchmark; includes throttled integrity scans, structure effects, defense spending, and attack-order refreshes).
- Attack orders, capital auras, and defense costs reduce capture volume; the benchmark ended around 77–96 fronts.
- One-second integrity scans cost ~8.5 ms and are capped by a cooldown.
- The attack queue can grow large while consuming a connected neutral region; compaction and ownership-based deduplication keep it bounded in practice, but final attack targeting needs a design review.

### Exit plan

When the attack design is ready:

1. Decide the final attack semantics (cost, duration, targeting, cancellation, visibility).
2. Decide whether circular, smooth, organic, or another growth model ships (and whether the switch remains as a mod/test option).
3. Restore or replace the economy with the intended resource model.
4. Remove stress-only guards or make them part of the real rules.
5. Restore a normal player count / matchmaking model.
6. Remove or repurpose the 108-state HUD and instrumentation.
7. Add regression tests for the new attack rules.
8. Update [SPEC.md](SPEC.md), [ARCHITECTURE.md](ARCHITECTURE.md), [DETERMINISM.md](DETERMINISM.md), [PERFORMANCE.md](PERFORMANCE.md), and this document.
9. Keep or archive the stress benchmark as a load-test harness.

### Do not

- Build balance, progression, or monetization on top of this attack model.
- Treat attack-order caps or the 10-second refresh as final design.
- Assume the 108-state spawn/leaderboard is the shipping experience.
- Remove determinism or attack invariants while stress-testing.
