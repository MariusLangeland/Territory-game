# Headless match telemetry

`scripts/telemetry.ts` is a deterministic, renderer-free harness that plays
`TerritorySimulation` matches headlessly and reports match-level telemetry. It
exists to answer questions like: how often does a match finish, how many states
survive, what do bot build economies produce, how much war/grievance activity
happens, and what happens to the human state when nobody commands it.

The harness never modifies simulation behavior. It reads public snapshots and
uses a small number of read-only internal counters that the snapshot does not
expose; no simulation state is written, and no simulation source file changes.

## Quick start

```sh
# Default run (3 seeds x 1200 ticks, organic growth layer)
pnpm telemetry

# Machine-readable report for CI or notebooks
pnpm telemetry --json

# Fast smoke run used by the task verification
pnpm exec tsx scripts/telemetry.ts --seeds 2 --ticks 300

# Compare growth layers on the same seeds
pnpm exec tsx scripts/telemetry.ts --seeds 3 --start-seed 1234 --ticks 1200 --mode circular
pnpm exec tsx scripts/telemetry.ts --seeds 3 --start-seed 1234 --ticks 1200 --mode smooth
```

The harness requires no install step beyond the repository's own dev
dependencies (`tsx`), opens no network sockets, and never touches the DOM or
WebGPU. It must be run from the repository root because it imports the game
modules with relative paths. CI runs a 1-seed × 300-tick smoke pass.

## CLI reference

| Flag               | Default   | Meaning                                                                    |
| ------------------ | --------- | -------------------------------------------------------------------------- |
| `--seeds <count>`  | `3`       | Number of consecutive seeds to run; must be at least 1.                    |
| `--start-seed <n>` | `1234`    | First seed. Later seeds advance by 1, wrapping at 2^32.                    |
| `--ticks <max>`    | `1200`    | Tick ceiling per match. The match also stops early on victory.             |
| `--mode <mode>`    | `organic` | Growth layer for every attack created: `circular`, `smooth`, or `organic`. |
| `--json`           | off       | Print exactly one JSON document to stdout instead of the table.            |
| `--help`, `-h`     | —         | Print usage.                                                               |

Invalid arguments print a usage message to stderr and exit with code 1. A
match reaching the tick ceiling is a normal result (`timeout: true`), not an
error. Successful runs exit with code 0.

`--json` prints only JSON on stdout; keep stdout clean and write diagnostics
elsewhere if you pipe the report into another tool.

## How a run works

1. Build a fresh `TerritorySimulation` with the seed and growth mode. The
   versioned map generator rebuilds the atlas and 51 starts from the seed.
2. Read the tick-0 snapshot for the human's starting territory and rank.
3. Step the simulation until it ends (`snapshot.ended`) or `--ticks` is
   reached. After every tick, update peak/trough human territory, best human
   rank, peak active fronts, and accumulate elimination/razed-structure events.
4. At the final tick, read the final snapshot for standings, structures,
   fronts, and winner; read the read-only extras described below; compute the
   final authoritative checksum.
5. Reduce every per-seed record to a deterministic aggregate.

The harness issues **no player commands**. The human state is idle for the
whole match; the 50 bots run their normal deterministic AI (supply economy, fronts, build plans, personality targeting, threat-aware defensive spending, grievances). In-game JSON
growth switching, card play, and human clicks are not simulated.

## Metrics

### Per-seed record

| Field                      | Definition                                                                                            |
| -------------------------- | ----------------------------------------------------------------------------------------------------- |
| `seed`                     | Unsigned 32-bit seed passed to `TerritorySimulation`.                                                 |
| `growthMode`               | Growth layer used for all attacks in the run.                                                         |
| `humanId`                  | `snapshot.humanId` (currently 1 / `SABLE`).                                                           |
| `endTick`                  | `snapshot.tick` of the final simulated tick. For a timeout this equals `maxTicks`.                    |
| `ended` / `timeout`        | Whether the match ended by last-state-standing; `timeout === !ended`.                                 |
| `winnerId` / `winnerName`  | Winner of a finished match; `null` when the tick ceiling was reached.                                 |
| `humanVictory`             | `winnerId === humanId`.                                                                               |
| `aliveCount`               | States still alive in the final snapshot.                                                             |
| `eliminatedCount`          | `players.length - aliveCount`.                                                                        |
| `human.id/name/alive`      | Final human identity and survival state.                                                              |
| `human.territory`          | Final owned land cells.                                                                               |
| `human.landShare`          | `territory / landCount` at the final tick (fraction, rounded to 6 dp).                                |
| `human.rank`               | Final leaderboard rank: alive first, then territory descending, then id ascending.                    |
| `human.peakTerritory`      | Highest human territory observed, including the tick-0 snapshot.                                      |
| `human.troughTerritory`    | Lowest human territory observed, including the tick-0 snapshot. Elimination reports `0`.              |
| `human.peakRank`           | Best (numerically lowest) human rank observed.                                                        |
| `fronts.active`            | Active attack fronts in the final snapshot.                                                           |
| `fronts.peak`              | Highest active-front count observed while stepping.                                                   |
| `activity.attacksLaunched` | Attacks created by every player over the run (final `nextAttackId - 1`).                              |
| `activity.eliminations`    | Elimination events emitted over the run.                                                              |
| `activity.structuresRazed` | Structure-destroyed events emitted over the run (captured structures).                                |
| `structures.total`         | Live structures in the final snapshot, including one State per living state.                          |
| `structures.byType`        | Live structure counts for `state`, `mine`, `barracks`, `defense-post`, `command-post`, `war-academy`. |
| `structures.levels[type]`  | `{ count, max, median }` of `stacks` (structure level) for that type; `0` max/median when empty.      |
| `districts`                | Live buildable structures that own at least one district coverage cell. States have no district.      |
| `grievances.total`         | Sum of per-defender grievance counters (one per captured cell, capped per pair).                      |
| `grievances.records`       | Number of nonzero defender → attacker grievance pairs.                                                |
| `grievances.max`           | Largest single grievance counter.                                                                     |
| `grievances.top`           | Pair holding the largest counter; ties resolve to the lowest defender id, then attacker id.           |
| `checksum`                 | `simulation.checksum()` at the final tick. Identical inputs must produce an identical value.          |

All structure types are always present in `byType`/`levels` in the fixed
declaration order `state`, `mine`, `barracks`, `defense-post`, `command-post`,
`war-academy`, even when the count is zero. This keeps JSON stable across runs.

### Aggregate record

| Field                     | Definition                                                                      |
| ------------------------- | ------------------------------------------------------------------------------- |
| `runs`                    | Seeds run (`--seeds`).                                                          |
| `growthMode` / `maxTicks` | Run configuration shared by every seed.                                         |
| `outcomes`                | Human wins, bot wins, timeouts, and `humanWinRate` (fraction, rounded to 4 dp). |
| `endTick`                 | Average, median, min, max of `endTick`; timeouts count at their ceiling.        |
| `alive`                   | Average/min/max final alive count.                                              |
| `eliminations`            | Average and total final eliminated count.                                       |
| `human`                   | Average final rank, average final land share, average peak territory.           |
| `fronts`                  | Average final active fronts and the highest single-seed peak.                   |
| `structures`              | Structure totals across seeds, overall and by type.                             |
| `districts`               | Average and total live districts.                                               |
| `activity`                | Total attacks launched and structures razed across seeds.                       |
| `grievances`              | Total grievance points, distinct pairs, and the largest single counter.         |

## Read-only extras and their limitations

Three values are not in `GameSnapshot`:

- `nextAttackId` (private) gives the launched-attack count.
- `botGrievance` (private `Uint16Array`) gives grievance counters.
- `districtStructureIds` is public and gives district coverage ids; only live
  buildable structures with at least one covered cell are counted as districts
  (State ids on capital cells and stale ids from razed structures are ignored).

The script accesses the two private members through a narrow read-only
`as unknown as { ... }` cast, matching how the simulation tests inspect
internals. These are not a public API: if the simulation's internals change,
update the script in the same change. The harness never writes through the cast.

## Determinism guarantees

- One fixed seed order: `startSeed`, `startSeed + 1`, ... (`uint32` wrap).
- Fixed structure-type iteration order; fixed object/field construction order.
- No wall-clock, `Date`, `performance`, locale, hostname, or random sampling in
  the report. No durations or timestamps appear in either output format.
- The text table and JSON are pure functions of `(seeds, startSeed, ticks, mode)`.
- Each seed records the final authoritative checksum, so CI can diff reports
  or checksums across commits to catch unintended simulation changes.

Verify determinism directly:

```sh
pnpm exec tsx scripts/telemetry.ts --seeds 2 --ticks 300 --json > /tmp/a.json
pnpm exec tsx scripts/telemetry.ts --seeds 2 --ticks 300 --json > /tmp/b.json
diff /tmp/a.json /tmp/b.json
```

## CI usage

The default run is intentionally modest (3 matches x 1200 ticks, no renderer),
which keeps it usable as a smoke job. For a fast gate, shrink the run; for a
longer soak, raise `--seeds` and `--ticks`:

```sh
# Fast smoke gate
pnpm exec tsx scripts/telemetry.ts --seeds 2 --ticks 300 --json > telemetry.json

# Victory-oriented soak (matches are allowed to finish; raise --ticks enough)
pnpm exec tsx scripts/telemetry.ts --seeds 8 --ticks 20000 --json
```

The harness itself does not assert thresholds; consumers decide what to check.
`--json` is designed for that: it is a single document with a stable `version`
field (`1`), a `seeds` array, and an `aggregate` object.

## Sample output

The table below is one captured run; rerun the command to reproduce current
numbers. The table format and JSON field order are stable. Counts move when
simulation behavior changes (for example, a new bot defense reserve), which is
exactly what the report is for.

`pnpm exec tsx scripts/telemetry.ts --seeds 2 --ticks 300`:

```text
TERRITORY TELEMETRY
runs=2  startSeed=1234  mode=organic  maxTicks=300  human=id 1 (idle)

PER SEED
seed             end winner              alive  elim    fronts  rank    share    peak  trough human
1234             300 TIMEOUT                51     0     27/61    51    0.08%     680     672 -
1235             300 TIMEOUT                51     0     28/66    51    0.09%     691     684 -

STRUCTURES BY SEED (count max/median level)
seed         state          mine           barracks       defense        command        academy        districts
1234         51 1/1         40 3/1         9 1/1          49 3/2         32 2/1         21 1/1               151
1235         51 1/1         41 3/1         7 1/1          48 3/2         34 2/1         20 1/1               150

WAR AND GRIEVANCE ACTIVITY
seed          launched  razed   grudges  pairs topGrudge
1234               221      1      1590      5 51->3 x760
1235               224      3      3252      8 11->42 x869

AGGREGATE
human win rate: 0.00% (0/2)  bot wins: 0  timeouts: 2
end tick: avg 300  median 300  min 300  max 300
alive: avg 51  min 51  max 51  eliminations: avg 0  total 0
active fronts: avg 27.5  peak 66  districts: avg 150.5  total 301
human: avg rank 51  avg share 0.09%  avg peak territory 685.5
structures: total 403  state 102  mine 81  barracks 16  defense-post 97  command-post 66  war-academy 41
war: launched 445  razed 4  grievances: total 4842  pairs 13  max 869
```

A trimmed per-seed JSON record (`--json`) has this shape:

```json
{
	"seed": 1234,
	"growthMode": "organic",
	"humanId": 1,
	"maxTicks": 300,
	"endTick": 300,
	"ended": false,
	"timeout": true,
	"winnerId": null,
	"winnerName": null,
	"humanVictory": false,
	"aliveCount": 51,
	"eliminatedCount": 0,
	"human": {
		"id": 1,
		"name": "SABLE",
		"alive": true,
		"territory": 680,
		"landShare": 0.000848,
		"rank": 51,
		"peakTerritory": 680,
		"troughTerritory": 672,
		"peakRank": 4
	},
	"fronts": { "active": 27, "peak": 61 }
}
```

## Caveats

- **Idle human:** the harness does not play the human's cards or issue human
  attacks, so the human usually declines and is eliminated. `humanWinRate`
  measures a passive-survival baseline, not game balance. Human `peakRank`,
  `peakTerritory`, and `troughTerritory` are still useful as soak metrics.
- **No command schedule:** because no commands are issued, battle telemetry
  shows bot-versus-bot and bot-versus-idle-human activity only.
- **Tick ceiling:** 1200 ticks is 120 seconds of game time (10 Hz). Most
  default runs time out; raise `--ticks` to observe victories and late-game
  elimination cascades. The loop stops early when the simulation reports a
  winner.
- **Snapshot-level metrics:** peaks are tracked per tick from snapshots, not
  from a full event timeline. The harness does not build replays.
- **No performance metrics:** timing is deliberately absent from the output.
  Use [scripts/benchmark.ts](../scripts/benchmark.ts) and
  [PERFORMANCE.md](PERFORMANCE.md) for performance work.
- **Not a balance oracle:** Frontage v1's attack model is an implementation
  experiment. See [EXPERIMENTS.md](EXPERIMENTS.md); do not tune final balance
  from these numbers.
