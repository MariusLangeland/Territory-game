# AI balance matrix

`pnpm ai:balance` runs the deterministic AI matrix: 8 seeds × 6,000 ticks for
standard/ruthless × organic/circular. It reports outcomes, elimination spread,
front activity, Fortification coverage, economy investment, and the behavior
counters added for the economy/deterrence/opportunity AI.

## 8 × 6,000 results

| Slice               | Alive | Eliminations | Avg fronts | Forts |   CP |   WA | Bot income | Fortified front share | Opportunity attacks | Deterrence postures | Ports | Landings |
| ------------------- | ----: | -----------: | ---------: | ----: | ---: | ---: | ---------: | --------------------: | ------------------: | ------------------: | ----: | -------: |
| standard / organic  |  33.3 |         17.8 |       20.5 |  85.4 | 56.4 | 63.6 |     14.9/s |                   29% |               3,500 |                 590 |    20 |       20 |
| standard / circular |  29.1 |         21.9 |       22.4 |  79.8 | 54.1 | 67.8 |     15.6/s |                   32% |               3,387 |                 528 |    40 |       57 |
| ruthless / organic  |  29.9 |         21.1 |       20.8 |  76.0 | 51.1 | 60.9 |     15.3/s |                   29% |               3,208 |                 558 |    29 |       20 |
| ruthless / circular |  29.3 |         21.8 |       22.5 |  75.0 | 47.5 | 67.6 |     15.2/s |                   33% |               3,366 |                 512 |    28 |       25 |

The matrix uses the 6,000-tick match cap; no run reached a natural 70%/last-state
victory before the cap. Elimination spread stayed at roughly 18–22 states per
run, so the AI is not stagnating.

## Reading the numbers

- **Defence:** ~75–85 Fortifications per 51-state run, but only ~30% of active
  fronts had a defender Fort within 40 px. The first tuning action was therefore
  placement, not more Fortification count: defensive cells now prioritize the
  incoming front's target area before ordinary hostile contact.
- **Supply:** ~15 supply/s average bot income with ~50 Command Posts and ~60 War
  Academies per run. Income-gap counters show economy investment responding to
  richer neighbours.
- **Opportunity attacks:** 3.2k–3.5k per eight-run slice, so stronger low-supply
  neighbours are actually being attacked.
- **Deterrence:** 512–590 defensive postures per slice were initiated while a
  stronger neighbour contributed deterrence.
- **Naval:** bots built 20–40 Ports and launched 20–57 landings across a slice at
  6,000 ticks, so naval expansion is occurring but remains opportunistic.

## Strategic option layer

The option layer was introduced after the original matrix. A one-seed, 3,000-tick check
selected: `naval-opportunity` 865 times, `fortify-front` 581, `expand` 322,
`exploit-weakness` 109, and `supply-ramp` 92. `coalition-strike` requires teams and
`conserve` was not selected in that short, relatively safe run. The same check showed
Fortified-front share at 53%, reflecting the incoming-front placement change.

After the option layer, the 8×1,800 balance sweep completed the early economy ramp for
**26.2%** of living bots at tick 1,800 (29.3% before options). This is a deliberate
trade-off for committed strategic behavior; options still include an explicit supply
ramp, and the layer should be re-tuned if future runs show economy starvation.

## Tuning decisions after measurement

- **Defensive placement:** defensive cells now prioritize the intended target area
  of incoming fronts before generic hostile contact. A 3,000-tick check raised
  Fortified-front share from ~30% to ~44% without adding a Fortification count
  constant.
- **Early economy reserve:** the opening Command Post/War Academy reserve rose
  from 40 to **60 supply**. The balance sweep's early-ramp completion at 1,800
  ticks rose from 19.5% to **29.3%**, while Fortifications at tick 600 fell from
  521 to 358 across eight runs. The reserve remains below a full Command Post so
  cheap defence can still respond to an immediate threat.
- No supply-income, opportunity, or deterrence weight was changed; the behavior
  counters show all three systems firing. Re-run `pnpm ai:balance` after any
  future AI constant change.

## 0.72.0 post-stagger and military-opening check

The 8 × 1,800 balance sweep was re-run after elimination income, staggered bot
decisions, the military opening, and annexation resolution:

- All 8 runs hit the 1,800-tick cap. Alive states were 49–51; cumulative
  eliminations were **0–2** per run (0.5 average). The +10 supply/s elimination
  reward therefore does **not** visibly snowball in this window.
- Active fronts recovered to **25 average** at tick 1,800 after the opening
  reserve was relaxed; this is back near the pre-change pacing.
- The early economy ramp reached **19.95%** of living bots at tick 1,800. The
  reduction from the previous 31.6% is the intentional cost of funding the first
  Barracks before further luxury economy.
- Bots now build **Barracks**: 15 across the eight runs by tick 1,800, versus
  zero before the military opening.
- A seed-1234, 6,000-tick regression check reaches both offensive types:
  **11 Barracks and 3 Artillery**, with 33 states still alive. Artillery is
  deliberately late because the 1,000-supply purchase requires cap growth.
- The three-seed, 1,200-tick telemetry pass still produced 0 eliminations and
  51/51 alive at timeout, with a passive human baseline.
- The elimination reward is implemented and checksummed; its pacing effect
  remains naturally limited by the small number of eliminations in the sweep
  window.
