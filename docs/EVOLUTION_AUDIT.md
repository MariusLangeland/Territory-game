# Evolution audit

Headless runs use `pnpm evolution`. Configurations below were chosen to keep a
generation fast while giving every genome repeated observations.

## Bugs found and fixed

### 1. Random seat offsets skipped genomes

The old population schedule chose an independent random offset per match. With
16 genomes and 8 seats, four matches could repeatedly cover the same windows and
leave genomes unplayed. In the first audit, **6 of 16 final genomes had zero
matches and fitness 0**. Those rows then polluted the poor bucket and made the
result table meaningless.

The schedule now rotates one population window by `playerCount` each match. Every
genome appears at least once, and match counts differ by at most one. A regression
test asserts this and that no match contains a duplicate seat.

### 2. CSV hid reused elites

The spreadsheet deduplicated by genome id across all generations. A QD elite that
was reused in the final generation therefore appeared only under its older
evaluation, making the exported final population look incomplete.

The CSV now includes an `evaluation_generation` column and keeps one row per
genome evaluation. Re-importing still deduplicates by genome id.

### 3. All-bot player 1 had two supply pools

In spectated all-bot matches, player 1 was still hard-coded as the POV/human seat.
Economy spending used `botGold[0]`, while attacks and income used the separate
human `gold` pool. Player 1 could therefore bank one pool for structures and spend
the other on fronts forever, and the rival supply banner skipped it because it was
treated as the POV.

All-bot matches now route player 1 through `botGold` like every other bot,
credit its income once, set `snapshot.humanId = 0`, and show its supply banner.
Seat-1 win rate changed from 20/20 to roughly 8–12/20 in sampled runs.

## Results after the fixes

### Seed 2026 — 12 genomes, 6 players, 3,000 ticks, 2 matches/genome

| Generation | Best fitness | Median fitness | Winner genomes |
| ---------- | -----------: | -------------: | -------------: |
| 1          |      101,134 |         10,135 |              2 |
| 2          |      108,898 |          5,084 |              2 |
| 3          |      115,899 |          3,444 |              2 |
| 4          |      113,518 |          3,166 |              2 |
| 5          |      118,353 |          6,052 |              2 |

The best lineage improves from ~101k to ~118k, with a small dip in generation 4.
The final winner wins both matches, reaches 30.7% land, 39.5 supply/s, and is a
pure aggression descriptor `E0-D0-N0-A2`.

### Seed 2027 — same configuration, 4 matches/genome

| Generation | Best fitness |
| ---------- | -----------: |
| 1          |      105,862 |
| 2          |      105,402 |
| 3          |      106,955 |
| 4          |      107,656 |
| 5          |      101,610 |

Selection is stable, but single-run best fitness is not monotonic: changing
opponents and seats moves the score by several thousand points. This is normal
tournament noise, not a determinism failure.

### Short-match comparison

With 16 genomes, 8 players, 2 matches/genome and only 1,200 ticks, the best score
stayed around 88k–93k with no clear upward trend. Two matches per genome are too
few to distinguish strategies at that horizon. The 3,000-tick runs show a much
clearer selection signal.

## Fitness-weight update

The original land weight was 120k. It is now **60k** by default and every term is
editable in the Evolution Lab (and via `--weight-<name>` in headless runs).

Re-running seed 2026 with the new default:

| Generation | Best fitness | Top land share |
| ---------- | -----------: | -------------: |
| 1          |       90,380 |          17.9% |
| 2          |       94,722 |          23.6% |
| 3          |       98,162 |          28.4% |
| 4          |       98,018 |          27.9% |
| 5          |       97,694 |          27.7% |

The best lineage still improves, then plateaus. Lowering land did not change the
dominant phenotype: the top genomes remain aggressor builds (`E0-D0-N0-A2`). This
means the default weight change alone does not fix the concentration; it gives
the user a direct control to test alternatives.

## Attack and defense reward update

New fitness terms were added for state eliminations, attacks against materially
weaker states, attacks repelled, and defense damage. Combat/defense credit is
zeroed for eliminated states.

Re-running seed 2026 with the new defaults:

| Generation | Best fitness | Median fitness |
| ---------- | -----------: | -------------: |
| 1          |      115,190 |         12,924 |
| 2          |      105,027 |         15,385 |
| 3          |      121,774 |         16,014 |
| 4          |      125,447 |         10,026 |
| 5          |      124,192 |         12,932 |

The final top genome reaches 31.5% land, 40.5 supply/s, wins both matches, and
records one elimination. Winners still lead, but non-winners now separate
meaningfully by combat and defense behavior instead of clustering on raw land.
The top phenotype is still aggressive (`E0-D0-N0-A2`); defense scoring helps
explain and rank held positions but does not yet make a defensive archetype win.

## Qualitative genome v2 (semi-Markov controllers)

Genome v2 adds 2–6-state observation-conditioned controllers with structural
mutation/crossover. A first 12-genome, 6-player, 3,000-tick audit produced:

| Generation | Best fitness |
| ---------- | -----------: |
| 1          |       46,885 |
| 2          |       57,054 |
| 3          |       88,353 |
| 4          |       90,104 |
| 5          |       65,657 |

The best genome each generation had a different controller topology. Final
survivors included 2-, 3-, and 6-state graphs; the best used a three-state
coalition/naval/supply loop, while another survivor used a two-state supply loop.
This is the first audit where the population is meaningfully diverse at the
**structure** level rather than only in scalar weights. Fitness is noisier
because transition draws add match variance, so these numbers should be treated
as a smoke test, not a converged balance result.

## Interpretation

- Evolution is now mechanically sound: no genome is unobserved, fitness is
  comparable, and the best lineage generally improves over generations.
- The fitness distribution is strongly bimodal because a match winner receives a
  75,000-point bonus while a non-winner is scored near a few thousand. The top
  bucket is effectively "won a match"; the rest ranks land/income/activity.
- The strongest phenotype is consistently **max aggression / minimal economy and
  defense** (`E0-D0-N0-A2`). This may be a legitimate consequence of the current
  win bonus and 3,000-tick timer, but it is worth treating as a balance warning
  rather than proof that the intended strategy space is healthy.
- Best-of-generation is not a monotonic curve. Use multiple seeds and more
  matches per genome before drawing conclusions from one run.

## Recommendation

For meaningful evolution comparisons use at least:

```sh
pnpm evolution --population 12 --generations 5 --matches 4 --players 6 \
  --ticks 3000 --seed 2026 --out reports/evolution.csv
```

and repeat across several seeds. If the aggression collapse persists, the next
tuning target is the win bonus relative to continuous land/income fitness, not
the mutation operator.
