# Experiments

Temporary builds that intentionally diverge from the main game design. They exist to answer a specific technical question, and they must have an exit plan.

---

## EXP-001 — Resource-free attack stress test

**Status:** active in application `0.3.x`  
**Started:** 2026-11-19  
**Question:** Does the attack pipeline stay correct, deterministic, and fast with 108 states attacking simultaneously and no economy throttling?

### Motivation

The normal economy (troops, income, caps, attack costs) limits how many attacks can run and how quickly the map changes. That is useful for gameplay but hides attack-layer bugs and performance limits. This experiment removes the economy to stress the actual attack path:

- many simultaneous flood-fill fronts,
- dense territory collision,
- hundreds of ownership changes per tick,
- many dispersed dirty texture regions,
- 108 frontier sets and bot decisions.

**This is not the intended final combat model.** The user explicitly requested this simplification for attack-focused development.

### Temporary rules

| Rule                   | Value                                                    |
| ---------------------- | -------------------------------------------------------- |
| States                 | 108 (1 human + 107 AI)                                   |
| Troops / income / caps | removed                                                  |
| Attack launch cost     | removed                                                  |
| Capture cost           | removed                                                  |
| Capture rate           | 30 pixels per attack per tick                            |
| Attack lifetime        | 50 ticks / 5 seconds (`ATTACK_LIFETIME_TICKS`)           |
| Active attack limit    | 3 per player (technical safety valve, not a design rule) |
| Bot attack limit       | 2 (technical safety valve)                               |
| Bot decisions          | once per second                                          |
| Starting territory     | radius ~16, ragged, spaced across the map                |

The attack still requires a shared land border with the clicked target's owner. It flood-fills through connected target-owned pixels, costs nothing, and continues only while every captured pixel remains edge-connected to the attacker's territory. If opposing fronts sever that connection, candidates are dropped and a front with zero legal captures that tick peters out. Attacks process in creation-id order.

### Growth layers

Three modular frontier selectors are implemented and switchable from the HUD for **new orders**:

| Mode     | Expansion shape | Selection                                        |
| -------- | --------------- | ------------------------------------------------ |
| Circular | digital disc    | Euclidean-distance priority heap                 |
| Smooth   | rounded front   | nearest radial band + attacker-neighbour scoring |
| Organic  | irregular lobes | deterministic random frontier pick               |

Existing orders retain their original layer; bots and the human pick up the currently selected mode for newly created attacks on the next tick. Growth mode and per-frontier state are included in checksums. Distance-based layers grow from the centroid of the initial border contact; the click is only a target/search selector, so growth always emanates from the border.

This is the current attack-shape test surface, not a final gameplay choice.

### Intentional deviations

- There is no economy HUD.
- AI states attack automatically from tick 10 and prefer neutral land while it exists, so the experiment stresses attack throughput before rival dogpiling.
- Attack counts are a load guardrail rather than a strategy constraint.
- The match may end quickly or settle into a patchwork; balance is not validated in this build.
- The leaderboard is scrollable because 108 states are alive at the start.
- Attack limits may change or disappear as stress findings demand.

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
- [ ] Decide the real attack model and retire this experiment.

### Findings so far

- 108 starts are feasible on the fixed atlas with a 16 px start radius and spacing enforcement.
- Bot fronts saturate the map in roughly 10 seconds when unthrottled; the resulting leaderboard is nearly tied and visually becomes a patchwork.
- A single global dirty rectangle would be catastrophic with this many fronts; 32 × 32 tile uploads are the normal path. At high front counts, tiles alone caused ~2,169 texture calls/s and panning stalls. The renderer now switches to an adaptive full-texture resync chunked across frames: ~21M pixels/s, ~80 calls/s, no measured frame above 10 ms while panning.
- 5 Hz HUD snapshots plus a virtualized leaderboard were required to remove the remaining tick-boundary DOM stalls (108-row updates produced ~14 ms frames).
- Replacing per-attack `Set<number>` + JS number arrays with an ownership-checked `Uint32Array` queue reduced benchmark RSS from ~529 MiB to ~189 MiB for two simulated worlds in the connectivity- and lifetime-checked build.
- Full-state checksum remains ~9 ms and is not run per tick.
- Growth-layer tick cost at 108 states: circular ~1.8–2.0 ms, smooth ~3.0–3.3 ms, organic ~1.8 ms (Node benchmark; radial-band scanning and neighbour scoring are the extra smooth-layer cost).
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
- Treat active-attack limits as final design.
- Assume the 108-state spawn/leaderboard is the shipping experience.
- Remove determinism or attack invariants while stress-testing.
