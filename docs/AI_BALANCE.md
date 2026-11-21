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
