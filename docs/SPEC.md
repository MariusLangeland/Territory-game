# TERRITORY — Specification

**Version:** see generated [REFERENCE.md](REFERENCE.md) / `package.json`  
**Status:** Local Frontage implementation; online design target  
**Last synchronized with:** map version 4, protocol draft 38  
**Generated rules:** [REFERENCE.md](REFERENCE.md) is authoritative for constants, costs, formulas, structures, and match presets. This document owns intent and behavior.

This is the canonical description of what Territory is, what the current build does, and which technical contracts must hold. [ARCHITECTURE.md](ARCHITECTURE.md) explains the code; this document explains the intent and current rules. Temporary deviations are tracked in [EXPERIMENTS.md](EXPERIMENTS.md).

> **Important:** The build now implements Frontage v1: one supply resource, durable standing fronts, mutual strength attrition, cancellation/refunds, and instant victory at 70% land. See [COMBAT_DESIGN.md](COMBAT_DESIGN.md).

---

## 1. Product definition

### 1.1 One-line pitch

A fast, readable territory war played on a very large pixel atlas, where every pixel can change hands and outcomes can be replayed deterministically.

### 1.2 Reference point

OpenFront is the closest genre reference: a browser strategy game with a huge pixel territory map, real-time expansion, and rival states. Territory is not a clone and does not reuse OpenFront assets or code.

### 1.3 Design pillars

1. **The map is the game.** Ownership is pixel-resolution. Growth must be satisfying at combat zoom and readable at world zoom.
2. **Determinism is a feature.** A seed plus ordered commands must reproduce a match. Networked clients and the server must agree bit-for-bit.
3. **Speed is a feature.** A tick must not stall rendering, and no single frame may synchronously upload the whole map. Heavy map resyncs are chunked across frames.
4. **Readable conflict.** A player should understand within a second who owns a region, where their frontier is, and what a click will do.
5. **Online-ready boundaries.** Simulation, rendering, and UI communicate through contracts a server can adopt without a rewrite.

### 1.4 Long-term match shape (target, not current)

- 8 human states (or configurable rooms), with bots filling empty seats.
- One shared procedural atlas; default 2048 × 1024 (about 38% land) with compact and clash presets.
- Fixed 10 Hz simulation.
- Land generates a resource; attacks cost resources and time.
- Final attack semantics are **undecided**. The current free flood-fill front is a stress-test stand-in; a concrete replacement proposal is in [COMBAT_DESIGN.md](COMBAT_DESIGN.md) and is not implemented.
- Victory by holding 70% of land, or last state standing.

---

## 2. Current build: attack stress experiment

### 2.1 Purpose

Exercise the attack pipeline in isolation:

- 50 AI states + one human all attacking continuously.
- Dense territory collision and simultaneous fronts.
- Hundreds of ownership changes per tick.
- Many dispersed texture upload regions.
- Large frontier-set and attack-queue workloads.

The user requested removing troops and adding 50 AI opponents, then approved Frontage v1: one supply resource, durable fronts, cancellation/refunds, 51 states, and instant 70% land victory.

### 2.2 Implemented

| Area                                                      | Status                   |
| --------------------------------------------------------- | ------------------------ |
| Seeded procedural atlas, 2048×1024 / 1536×768 / 1280×720  | ✅                       |
| Land/ocean mask and terrain relief                        | ✅                       |
| 8–51 states (1 human + N AI), default 51                  | ✅                       |
| Pixel ownership and incremental frontier tracking         | ✅                       |
| Resource-free local-front attacks (BFS)                   | ✅                       |
| Single supply economy, durable fronts, cancellation       | ✅                       |
| Bot expansion/attacks                                     | ✅                       |
| Elimination and last-state-standing victory               | ✅                       |
| Pause, camera pan/zoom/fit/focus                          | ✅                       |
| WebGPU renderer with adaptive dirty-tile/chunked uploads  | ✅                       |
| Circular / smooth / organic selectable growth layers      | ✅                       |
| State structures anchoring territory and projecting auras | ✅                       |
| Supply income, drag-and-drop build cards, 70% victory     | ✅                       |
| Minimap, virtualized state-count-aware leaderboard, perf  | ✅                       |
| Seed input, URL seed, new world, rematch                  | ✅                       |
| Intro, field manual, defeat, result, WebGPU error screens | ✅                       |
| Deterministic tests + attack stress tests + benchmark     | ✅                       |
| Troops, caps, launch costs                                | ❌ intentionally removed |
| Single supply/card economy                                | ✅                       |

### 2.3 Not implemented

| Area                                                    | Target                                         |
| ------------------------------------------------------- | ---------------------------------------------- |
| Final attack design                                     | Undecided; must replace the experimental model |
| Coordinated bot strategy/team play                      | Bots use individual profiles only              |
| Structure construction beyond cards, ownership transfer | State + seven buildables; design pending       |
| Authoritative game server, rooms, reconnect, prediction | [NETWORKING.md](NETWORKING.md)                 |
| Human-vs-human play, lobbies, spectating                | [ROADMAP.md](ROADMAP.md)                       |
| Accounts, progression, persistence                      | [ROADMAP.md](ROADMAP.md)                       |
| Replay viewer                                           | [DETERMINISM.md](DETERMINISM.md)               |
| Fog, diplomacy, audio, WebGL fallback                   | Backlog                                        |

---

## 3. Vocabulary

| Term                 | Meaning                                                                                |
| -------------------- | -------------------------------------------------------------------------------------- |
| **Cell / map pixel** | One element of the 2048 × 1024 ownership grid                                          |
| **Owner**            | State id `1..51`; `0` means unclaimed                                                  |
| **Territory**        | Count of land cells owned by a state                                                   |
| **Frontier**         | An owned land cell with an adjacent land cell owned by someone else (unclaimed counts) |
| **Front / attack**   | A deterministic BFS flood that captures connected target-owned cells                   |
| **Tick**             | One fixed simulation step, 100 ms                                                      |
| **Command**          | An attack intent applied at a tick boundary                                            |
| **Snapshot**         | Read-only UI view produced after a tick                                                |
| **Change batch**     | Packed owner/index words emitted for the renderer                                      |
| **Seed**             | 32-bit value that regenerates the exact map and starting positions                     |

---

## 4. Current rules

All numeric values come from `src/lib/game/constants.ts`. Outcome-affecting changes require a version bump and updated tests.

### 4.1 The world

- Default 2048 × 1024 cells (2,097,152 total); compact 1536 × 768 and clash 1280 × 720 presets.
- Generator targets 38% land.
- Static binary land mask, 8-bit terrain shade, and a discrete elevation tier (0–5).
- Elevation is derived from land-height quantiles, colored from lowland through peaks, and drives base defense.
- Ocean cannot be owned.
- Map and starts are deterministic from the seed and versioned by `MAP_VERSION`.
- `MAP_VERSION = 4`; `PROTOCOL_VERSION = 34`.

### 4.2 Starting positions

- 51 start points are selected by farthest-point sampling over high-density land candidates, seeded deterministically.
- A preferred minimum spacing of 34 cells prevents initial beachheads from overlapping.
- The first start is near the map centre; subsequent starts maximize distance from existing starts.
- Starting territory is a ragged disc of radius approximately **16 cells**, clipped to land, with deterministic per-cell frontier wobble.
- A fallback guarantees every state begins with at least one owned pixel.
- Initial total claimed land is roughly 65K pixels (~8% of land). Each state starts with only territory; no resources exist.

### 4.3 Attack lifecycle

1. Player clicks a cell. `enqueueAttack` validates against current state for immediate UI feedback.
2. A valid click queues an attack command, applied at the start of the next tick.
3. The clicked cell's current owner becomes the **target owner** (neutral or rival).
4. The simulation searches a 34-cell radius for cells of the target owner adjacent to the attacker's territory. These become seeds.
5. Seeds are sorted by squared distance from the click, then by pixel index, and capped at 96.
6. The attack's geometric growth anchor is the **rounded centroid of the seed contact line**, not the clicked cell. The click chooses target/search area; growth always starts from the border contact.
7. Launching costs **supply** `30 + 40 × effective Barracks levels`. Effective levels are the attacker's live Barracks stacks minus the defender's live Jammer stacks (floor 0). Supply is the only resource and also pays for cards and upgrades.
8. Each front buys durable strength `1000 + 200 × effective levels`. Speed and defense piercing use `logTier = floor(log2(effective levels + 1))`: power `30 + 15 × logTier`, piercing `logTier`. Scaling is infinite, with logarithmic fall-off for speed/piercing. Repeated clicks create separate fronts; they never reinforce an existing one.
9. Each tick, the growth layer nominates candidates up to the front's power budget. Each capture costs `max(1, defense − piercing)` from **both** the per-tick power and the durable strength. The sampler takes the cheapest of up to 10 candidates; ties keep growth priority.
10. Before every capture, the cell must still share a land edge with territory owned by the attacker. A front can never create a detached enclave.
11. Mutual fronts trade strength simultaneously: each loses `100 + 50 × opponent logTier`, once per pair per tick. A front at 0 strength dies; the survivor pauses on the contact line. See section 4.13.
12. Capturing claims the cell for the attacker and pushes its four neighbours onto the growth layer if they remain target-owned land. If the cheapest sampled cell is unaffordable for either power or strength, all sampled cells requeue and the front pauses.
13. **No fixed lifetime:** fronts persist while they have strength and remain active. A front that captures nothing for 20 consecutive ticks dies. A clash pause resets the idle counter.
14. A front also ends when its strength reaches zero or its frontier is exhausted long enough to idle out.
15. Attacks are processed in creation-id order. If another front takes a cell first, the later front skips it.
16. A front continues only while it has at least one legal cell adjacent to the attacker's territory and its lifetime has not elapsed.

### 4.4 Valid attack clicks

An attack is valid only if:

- the match is not ended,
- the attacker is alive,
- the clicked coordinate is on land,
- the clicked cell is not owned by the attacker,
- the attacker has enough supply for the launch cost,
- at least one target-owned cell within 34 cells touches the attacker's territory.
- adjacency is checked again when the command executes and on every captured cell.

Failure reasons: ocean, own territory, no shared border, not enough supply, eliminated, match over, invalid coordinates.

### 4.5 Borders

- A frontier cell is owned land with at least one adjacent land cell owned by a different owner (including unclaimed).
- Each state's frontier is stored as a `Set<number>` derived cache.
- It is maintained incrementally on claim and rebuilt at spawn.
- Coastal-only owned pixels with no land neighbours are not frontier cells.
- The growth layer does not use this state frontier directly; it uses ownership plus attacker-adjacency checks when candidates are consumed. Border connectivity is revalidated at capture time, not just when a candidate is pushed.

### 4.6 Attack frontier storage

- Each attack owns a growth layer with its own candidate structure (heap, direction buckets, or random pool), plus a simulation-side least-resistance sampler over the top 10 candidates.
- There is no per-attack visited set. Once a cell is captured, its owner changes, so duplicate candidates fail the ownership check.
- Candidate storage is per-mode; circular uses a priority heap, smooth uses squared-distance bands, organic uses a random-access array.
- A front's candidate set can become large while consuming a large connected region. Its lifetime and per-tick capture cap bound retained work.
- If a candidate no longer touches the attacker's territory, it is skipped. If a whole tick captures nothing, the front is removed. This prevents fronts from phasing through opposing attacks and leaving enclaves.

### 4.7 Eliminations and victory

- After attacks resolve, a state with zero owned land is eliminated.
- Its frontier is cleared and its active attacks are dropped.
- A state holding at least **70% of land** wins immediately; otherwise the last living state wins. The tick loop stops advancing.
- If the human is eliminated, the UI pauses and offers spectate/rematch/new world. Spectating resumes the simulation.

### 4.8 Bots

- 50 AI states.
- Each bot derives a deterministic profile from the world seed:
  - aggression,
  - economy,
  - fortification,
  - command,
  - **vengeance** (retaliation drive),
  - **caution** (retaliation fear),
  - **conciliation** (avoid stronger opponents),
  - **opportunism** (join existing wars).
- **Common opening economy ramp:** every bot first alternates Command Posts and War Academies until it owns two of each (or the opening window expires). During this phase it prefers neutral expansion over opening state wars, but falls back to the best hostile border when no neutral ground is reachable. A 60-supply early reserve keeps cheap Fortifications and attacks from draining the next Command Post/War Academy.
- After the opening, every bot derives a **per-type affinity** (`structureBias`) with a per-type hash jitter, plus a display-oriented preference order. The order is not a fixed build script: economic actions are scored each build interval from affinity, threat response, income/cap pressure, novelty vs repeat penalty, efficiency, and affordability.
- **Income pressure:** every bot compares its supply income with its bordering neighbours. The income gap always raises Command Post and War Academy utility, so a bot behind its neighbours prioritizes income over other economy; the same gap reduces its attack appetite so it can rebuild its economy first.
- **Attack ground preference:** border candidates are scored by target utility minus a penalty proportional to that cell's defense, so bots favor the cheapest contact ground on their preferred target.
- **Strategic savings:** after two buildables, a bot reserves supply for its highest-scoring missing type. If that type's cost exceeds the stock cap, it saves for and prioritizes War Academy cap growth instead; the reserve releases as soon as the target is affordable. Attacks keep at most half the current stock (minimum 60) for that save and cap the next-purchase buffer at 40, taking the larger reserve instead of stacking both. This prevents aspiration savings from freezing expansion.
- **Expansion pressure:** if a missing type has no legal site because existing districts cover the bot's owned cells, expansion becomes the priority and attacks may draw from the economic reserve.
- **Utility attacks:** bots sample border targets, score them, then derive attack chance from target score, aggression, supply pressure, and held reserves. High-value retaliation/opportunity targets are attacked more often; low-value or expensive targets and threatened/saving bots hold supply.
- Bots act once per second (`BOT_DECISION_INTERVAL = 10`); economy decisions run every 30 ticks and may take up to two non-defensive actions per interval. A threatened bot takes at most one defensive action.
- Bots start with **90 supply** and follow the same income/cap rules, evaluating construction every 3 seconds (`BOT_BUILD_INTERVAL = 30`). Build ticks are staggered by player id, so only about two bots act per tick.
- Construction tries the next unbuilt type in the plan at its base cost, then upgrades the lowest-level existing plan structure when no new type is placeable or affordable. Artillery/Command Posts/War Academies/Jammers prefer capital-adjacent sites; Fortifications/Barracks prefer border sites. Upgrades use the normal level-scaled cost.
- **Threat posture:** once per decision tick, each bot computes an integer threat score:
  - `25` per active hostile front, capped at `50`;
  - `1` per hostile pixel touching its border, capped at `8`;
  - `2` per grievance captured since the previous refresh, capped at `20`;
  - up to `10` from **deterrence** when a bordering state's estimated strength exceeds the bot's own.
  - A bot enters defensive posture at threat `≥20` and leaves at `≤10` (hysteresis).
- **Deterrence:** a stronger bordering state raises Fortification utility even before it attacks, and increases the desired Fortification copies/levels; this is the bot's pre-war deterrent.
- **Defensive reserve:** a threatened bot withholds up to **60 supply** from non-defence plan spending while saving for a missing Fortification, missing Barracks, or the cheaper next defensive upgrade. A stall valve releases the reserve after 3 build intervals (9 seconds) with no affordable defensive action.
- **Defensive spending:** while threatened, the bot first builds a missing Fortification on the border cell with the most hostile neighbours, then upgrades the Fortification, then builds/upgrades a Barracks or Jammer. These actions may consume the reserve; non-defence spending cannot.
- **Rebuilding:** a destroyed plan structure is simply missing from the plan and is rebuilt when affordable and placeable; destroyed defensive structures are rebuilt first under threat.
- **Bot naval strategy:** coastal bots build a Port when a hostile/neutral shore target scores above the naval threshold or land expansion is blocked. With a Port they sample sea-connected shores, score low-supply/low-defense targets, and launch only when the landing cost fits their reserve and attack chance. They avoid wasting the Port-cost-inclusive landing on poor targets.
- **Strategic option layer:** every decision tick a bot commits to one option for 50–90 ticks: supply ramp, fortify front, expand, naval opportunity, exploit weakness, coalition strike, or conserve. Options bias economy, reserve, attack chance, target selection, and naval behavior; a switch requires a meaningful utility margin over the current option.
- **Blackboard memory:** bots remember the last attacker, the strongest bordering income/strength signals, active ally targets, and the selected option's target. These beliefs feed threat, target, and option scoring rather than being recomputed as isolated snapshots.
- **Target scoring:** each sampled border target is scored from neutral expansion, the attacker's grudge against that owner, target strength relative to self, the number of active attacks already hitting the target, and the target's available supply.
  - Vengeful bots strongly favor owners that have captured their land.
  - Cautious bots penalize stronger targets and targets holding enough supply to retaliate.
  - Conciliatory bots more strongly avoid stronger opponents, preferring neutral expansion.
  - Opportunistic bots gain a large bonus against states already under attack and against weaker states.
  - **Supply opportunity:** a stronger neighbour with supply below 25% of its cap, or below its own counterattack cost, is treated as an opportunity. The usual caution/conciliation penalty is reduced, the target gains a large score bonus, and its attack chance gets an extra bonus.
  - Aggression raises the baseline hostile score; low-aggression bots usually prefer neutral land.
  - While threatened, a grudge holder gets a large retaliation bonus, an active attacker gets a counterattack bonus, and unrelated neighbours are penalized so the bot defends or counterattacks instead of opening a new war.
- Capturing a pixel records one grievance for the defender against the attacking owner. Grievances persist, are capped, and are checksummed.
- Bots use the same attack-order, structure, district, aura, and clash rules as the human.
- Bots share one seeded PRNG for frontier sampling, processed in ascending player-id order; profiles, affinities, grievances, and utility decisions are deterministic. Behavior is replayable.

### 4.8b Evolution lab

- **Genomes** combine eight personality traits (`aggression`, `economy`, `fortification`, `command`, `vengeance`, `caution`, `conciliation`, `opportunism`), per-type structure affinities, and six evolvable behaviour modules: income, defence, deterrence, opportunity, expansion, and retaliation.
- Module weights are neutral at 50 and scale the corresponding bonus; default bots use 50 for every module, preserving the non-evolved AI.
- **Fitness** per match = land share (primary), final income, attack strength, win bonus, and survival bonus. Fitness is averaged across matches.
- Each generation seats genomes in deterministic all-bot matches. The bottom half is pruned; elites survive; offspring are produced by crossover and mutation. A module can mutate wholesale so behaviour presets remain mixable.
- Final genomes are bucketed into **poor**, **good**, and **top** (roughly 50/30/20%). Buckets persist locally and feed match difficulty: relaxed → poor, standard → good, ruthless → top.
- The headless CLI (`pnpm evolution`) writes a CSV spreadsheet with genome traits, module weights, bucket, fitness, land, income, attack, and wins. The client can import that spreadsheet to rerun those genomes or combine selected bucket genomes.
- **Spectator mode** at `/evolution` runs the same natural-selection loop in-client using paired bot-only simulations; `1×`–`1000×` controls fast-forward. It reuses the WebGPU renderer and shows live genome performance and buckets.
- **Explicit Duel Lab** at `/duel` is separate from population evolution: two named characters persist for the whole run, alternate seats each round, and begin close together near the map centre on a terrain-mirrored map. There is no culling and no POV privilege: both states use the normal bot supply pool and show supply banners. After every configurable block of rounds, the character with the lower block fitness must mutate; the result is shown as a mutation graph/path plus a round log.
- **Lineage duels (1v1):** each genome is tested against one parent in same-seed mirrored fights with seats swapped. The summed fitness margin across those fights decides the lineage result: positive is a win, negative is a loss. A lineage loser is excluded from the survivor pool and from new archive slots; the next generation is bred from the remaining half plus QD elites.
- **Team AI:** the Evolution Lab can assign cyclic teams. Teammates never attack one another and gain a coordination bonus when joining an ally's target. Team count 1 is free-for-all.
- **Qualitative genomes (v2):** each genome carries an optional semi-Markov strategic controller with 2–6 states. A state selects a strategic option, has per-state economy/attack/defense/naval/conserve biases and a dwell time, and leaves through observation-conditioned transitions (threat, income, supply, weak neighbour, ally pressure) with a deterministic chance roll. Mutation can add/remove/rewire states as well as tune them; crossover aligns states by option label. Genomes without a controller keep the utility-argmax option layer.
- **Quality-diversity archive:** genomes are also archived by strategy descriptor (`E` economy, `D` defense, `N` naval, `A` aggression bins). The archive preserves one best genome per descriptor, and those elites seed later generations alongside the fitness top half.
- **Balanced evaluation:** population matches rotate a single seat window by player count, so every genome is observed each generation with near-equal match counts; a genome cannot finish a generation with zero matches because of unlucky random offsets.
- **Reward metrics:** fitness combines land share, income, active attack strength, wins, survival, economy structures, Fortification levels, naval Ports/landings, launched attacks, allied support, state eliminations, attacks against weaker states, attacks repelled, and defense damage. Combat/defense credit only counts for a state that is still alive at scoring time. Descriptor metrics are reported in the lab, spreadsheet, and CSV. Every reward term has an editable weight in both labs; the default land weight is 60k (reduced from 120k). Headless runs expose the same values through `--weight-<name>` flags.
- **Post-match analysis:** the result modal includes the AI behavior counters (threatened fortifications, deterrence postures, income-gap economy, supply opportunities, Ports/landings), seed copy/replay, standings, and match summary.

### 4.9 Tick order

1. Increment `tick`.
2. If a growth-mode switch is pending, apply it before any new attacks are created.
3. Accrue supply continuously for this tick.
4. Apply queued attack/build/upgrade commands sorted by `(sequence, playerId)`.
5. On decision ticks, refresh bot threat/posture/reserves, then run bot economy/build decisions every 30 ticks and bot attack decisions every 10 ticks.
6. Process active fronts in creation-id order.
7. Every 10 ticks (or immediately after a clash halts a front), annex detached territory into surrounding mainlands. Every 100 ticks, fill small neutral pockets.
8. Eliminate states with no territory and remove their fronts.
9. Check 70% / last-standing victory.
10. Build the public snapshot.

### 4.10 Frontage caveats

- Every launch costs supply; there is no refund unless the player cancels the front.
- Supply has no global maximum. Territory and War Academies raise the cap without an upper bound; gains clamp to the current cap.
- A front flood-fills connected target-owned land; the growth layer selects circular, smoothed, or organic shape.
- A front ends at zero strength or after 20 captureless ticks. There is no fixed lifetime.
- Mutual fronts trade strength; the survivor pauses on the contact line.
- Cancellation refunds a proportional strength share immediately and is not tick-queued in this build.
- Bots use profile-driven strategies rather than coordinated team play.
- Configurable 8–51 states can form a near-even patchwork; 70% victory, last-standing, or an optional timer decides the match.
- No match time limit exists.

### 4.11 Combat randomness

Combat has no combat-roll randomness, crits, spread, or morale. The organic growth layer uses a deterministic per-attack PRNG solely to choose frontier candidates; the sequence is reproducible. The least-resistance sampler is deterministic: it samples a fixed number of candidates in growth order, compares integer effective costs, and breaks ties by sample order. Given the same state, growth mode, and accepted commands, every pixel outcome is deterministic.

### 4.12 Growth layers

Every attack captures a `growthMode` at creation time and keeps it for its lifetime. The selected mode applies to all **new** fronts (human and bots); existing fronts are unchanged.

| Mode       | Frontier selection                                                                                              | Result                                                           |
| ---------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `circular` | Min-heap keyed by squared Euclidean distance from the attack anchor; ties by pixel index                        | Approximates a digital disc instead of a Manhattan diamond       |
| `smooth`   | Nearest radial band first; within the band prefer more attacker-owned neighbours, then nearer/lower-index cells | Fills concavities, suppresses thin spikes and long tangent wings |
| `organic`  | Uniform random pick from a frontier array using a per-attack deterministic PRNG                                 | Irregular organic lobes, fully replayable                        |

- The growth anchor is the rounded centroid of the initial border-contact seeds. The click is not the origin. This prevents a distance-based layer from sending a narrow tendril toward a click deep inside hostile territory before blooming.
- Defense only chooses among the candidates the growth layer already prioritizes; it does not scan the whole frontier. The front therefore keeps its overall shape while preferring cheaper local lanes.
- The shape is still clipped by coastlines, other states, and the attacker's own border.
- The **smooth** layer groups candidates into integer squared-distance bands around the anchor. It always serves the nearest non-empty band before farther bands, then uses attacker-neighbour count and distance/index tie-breaks inside the band. This radial bound is what prevents tangent wings along the initial border.
- The **organic** layer seeds its PRNG from the world seed, attack id, attacker id, and defender id.
- A growth-mode switch is applied at the next tick, before commands and bot decisions. It is currently a local test control; an online server must make it authoritative match configuration or a tick-stamped command.
- Candidate queues and per-attack PRNG state are part of checksums.

The HUD growth switcher selects the layer for new orders. It has no effect on orders already in flight.

### 4.13 Conflicting fronts

Each captured cell records the attack id that claimed it. When an attack is about to capture a cell adjacent to a cell claimed by an **opposing active attack**, and the two attacks target each other's owners, the pair is in direct conflict:

- both fronts use their launch-time `logTier` for contact strength;
- both fronts lose `100 + 50 × opponent logTier` durable strength simultaneously;
- damage applies once per pair per tick;
- if the incoming attack reaches 0, it halts;
- otherwise the clash pauses the incoming front for this tick.

A stronger or higher-Barracks front deals more contact damage and can break a weaker front. The survivor pauses on the contact line; thirds are unaffected.

### 4.14 Territory integrity

Every player begins with one **State structure** at their capital. A player's **protected mainland** is every connected land component containing a live State structure they own (4-neighbour, land only). Every `ANNEX_INTERVAL_TICKS` (10 ticks / 1 second), and promptly after a clash halts a front, the simulation labels components and annexes unprotected ones:

- a component is transferred only if it touches another player's **protected mainland**;
- the recipient is the adjacent protected-mainland owner with the greatest shared border;
- ties go to the lower player id;
- components touching only ocean, unclaimed land, another unprotected component, or an unprotected territory are left alone.

This restores dead pixels and severed pockets to the surrounding claim while guaranteeing that territory connected to a State structure is never annexed. Legitimate islands with no adjacent protected claimant are not deleted.

#### Neutral pocket cleanup

Every `UNCLAIMED_CLEANUP_INTERVAL_TICKS` (100 ticks / 10 seconds), neutral land components of at most `UNCLAIMED_POCKET_MAX_AREA` (96 cells) are cleaned up:

- the component must border at least one owned cell;
- the recipient is the owner with the largest shared border, breaking ties by lowest owner id;
- ocean contact is allowed, because organic fronts often leave thin coastal gaps that look like holes;
- ownerless islands and larger neutral regions are left untouched for expansion.

This removes the small unclaimed specks and coastal slivers that organic growth leaves behind without closing off the main neutral landmass.

### 4.15 State structures

- Each state starts with one State structure on its start cell.
- The structure is part of the owning state's territory and can be captured by an attack.
- Every land component connected to a live State structure is protected from annexation.
- A live State structure projects a **16 px defense aura** adding **+20 defense** to land in range owned by that state. The structure cell itself is inside the aura. Auras never buff neutral or enemy land. Overlapping friendly auras do not stack; the strongest applies.
- Capturing the structure destroys it immediately and removes its aura. The owner keeps any remaining territory, but none of it is annexation-protected until another structure anchors it.
- State structures anchor protection. A Port also anchors its land component when that component reaches the owner's State, or when it shares a sea component with another friendly Port whose land component reaches the State. Other buildables do not prevent annexation.
- State structures are large owner-colored circles with a cream capital star (15 px human / 11 px AI radius). Buildables are 10 px dark badges with an owner-colored ring and a type-accent icon (orange cannon, red swords, cyan shield, teal jammer rings, green command mast, violet academy chevrons, blue anchor). Marker sizes are fixed in screen pixels and do not grow with camera zoom. Each rival capital also carries a supply banner scaled by that state's territory. The HUD shows the human state's `ANCHORED`/`NO ANCHOR` status and a war-feed event when a structure is destroyed.
- Structure placement, capture, and protection are deterministic and included in checksums.

State is the permanent anchor structure. Artillery, Barracks, Fortifications, Jammers, Command Posts, War Academies, and Ports are the player-built structures; construction beyond cards, more types, and ownership transfer are future work.

### 4.16 Elevation and defense

| Property                 | Value                                                                   |
| ------------------------ | ----------------------------------------------------------------------- |
| Elevation tiers          | 0 lowland, 1 plains, 2 hills, 3 highlands, 4 mountains, 5 peaks         |
| Base defense             | `1 + elevation`                                                         |
| Occupied bonus           | `+1` when the pixel has a nonzero owner                                 |
| State aura               | `+20` within 16 px; overlapping auras do not stack                      |
| Effective levels         | `max(0, attacker Barracks stacks − defender Jammer stacks)`             |
| Supply launch cost       | `30 + 40 × effective levels`                                            |
| Durable strength         | `1000 + 200 × effective levels`                                         |
| Speed tier               | `logTier = floor(log2(effective levels + 1))`                           |
| Power per front per tick | `30 + 15 × logTier`                                                     |
| Capture cost             | `max(1, defense − logTier)` from power and strength                     |
| Contact attrition        | `100 + 50 × opponent logTier` per pair per tick                         |
| Idle expiry              | 20 consecutive ticks without a capture                                  |
| Defense range            | 1–6 unowned, 2–7 occupied, up to 27 in a State aura; fortifications add |

- Elevation tiers are assigned by land-height quantiles; most land is lowland, peaks are rare.
- Elevation is static map data. Defense is derived from elevation plus current ownership, so capturing a pixel changes future defense there but not the map.
- A base front has 30 power and 1000 strength per launch. Each effective Barracks level adds 200 strength and 15 launch cost; each doubling tier adds 15 power and 1 piercing. Scaling never caps. Cheap neutral lowland with a base front can capture 30 points per tick; defended peaks and aura-covered high ground consume more power and strength.
- Pixel defense inspection was part of the old supply/front/defense panel; that panel is removed in favor of the supply bar.
- Elevation is rendered as a six-color terrain palette with boundary contours, tinting owner colors rather than replacing them.
- Aura circles are not rendered; district tint and boundaries communicate territorial structure.

### 4.17 Player economy and build cards

Supply is the only resource for the human and bots. Cards and upgrades consume supply directly; bots build their focus structure without cards.

- Start with **90 supply** and **all seven buildable cards** always available in the hand.
- Supply income is `3 + floor(territory/3000) + income structures` per second, with **no income cap**. This is +1/s per 3,000 owned pixels, plus Command Post stacks at **+1/s** each.
- Supply cap is `120 + floor(territory/1000) + 80 × War Academy stacks`, with **no global maximum**.
- Accrual is continuous: per-tick integer remainder at 10 Hz. Gains clamp to the cap, and losing a War Academy clamps current supply.
- Clicking any pixel of an owned buildable district queues a one-level upgrade costing `base cost + 15 × current level` (projected through queued upgrades). If the district is visually merged, the lowest projected level among its structures is upgraded first; five-level batches distribute across the lowest structures. Shift-click queues five levels atomically: the full total is quoted and charged before any command is queued. No card is consumed.
- Holding **Ctrl** hides merged districts: individual seams/icons return and the clicked structure is upgraded directly. Upgrade commands pinned to a merged structure survive its centre being assigned to a neighboring district cell.
- Hovering an upgradable district shows a cursor tooltip above the pointer with the total cost for 1 level, or 5 levels while Shift is held.
- Build and upgrade commands reserve supply against queued upgrades so rapid clicks cannot overspend.
- Playing a card requires dragging it onto **controlled land** outside every existing district, with no structure and at least **8 px from every other structure**.
- Dropping inside a same-type district upgrades that district's structure at `base cost + 15 × current level`; dropping the same type outside all districts creates another structure at its base cost.
- Cards are permanent actions: any affordable card can be bought again. No draw, deck, consumption, or reroll. Hand order is ascending card cost.
- Card costs and generated values live in [REFERENCE.md](REFERENCE.md).
- Captured buildable structures are razed and their effects disappear.
- **Defensive auras are friendly-only.** A Fortification or State aura modifies defense only on cells owned by the structure's owner. A Jammer never changes pixel defense.
- Structure placement has an **8 px centre-to-centre exclusion radius**.

| Card          | Effect                                                             |
| ------------- | ------------------------------------------------------------------ |
| Artillery     | Active: inaccurate, 300 supply/level, 140 px range, 64 px district |
| Barracks      | +1 effective attack level; cost +40, strength +200 per level       |
| Fortification | +1 defense to every friendly pixel in its 40 px district; stacks   |
| Jammer        | Global aura: −1 effective enemy Barracks level per stack           |
| Command Post  | +1 supply per second                                               |
| War Academy   | +80 supply cap                                                     |
| Port          | Shore-only naval landing port and sea-linked protection anchor     |

Every live Barracks level adds attack strength and launch cost linearly. Speed and piercing use integer `log2` tiers, so both scale without a cap but fall off. A defending Jammer subtracts one effective Barracks level per stack from every attacker, reducing their strength, cost, power, and piercing without raising pixel defense.

### 4.17b Artillery active ability

- The human toggles targeting with the HUD `FIRE` button or `A`, then clicks an aim point.
- The clicked aim point is used directly; there is no target snapping. At least one ready battery must be within **140 px**.
- Every ready battery in range fires **one shell per structure level**, costing **300 supply per level**. A battery then reloads for **6 seconds**.
- Shells take **2 seconds** to land, with deterministic spread up to **±36 px** around the aim point, so most shells miss small targets.
- Artillery cannot be built unless every district cell within **16 px** of its centre is absent; it needs a 16 px district-free clearance. Its own district covers **64 px**.
- Artillery cannot damage or destroy a State structure.
- On impact, the nearest hostile structure within **12 px** loses one level. A level-1 structure is destroyed; State destruction removes annexation protection.
- Artillery has no passive income. A volley costs **300 supply per level**; firing is rejected if the total cannot be paid. It has no front-cap interaction.
- Bots use the same cooldown and shell rules, ignore State targets, and aim at the strongest non-State structure in range.

### 4.17c Ports and naval landings

- **Port:** 200-supply card, no district, buildable only on owned shoreline cells (land with an orthogonally adjacent ocean pixel).
- With at least one Port, clicking a non-friendly shore that normal land attacks cannot reach attempts a **naval landing**.
- Validation: target must be a shore, not friendly, not occupied by a structure, and reachable by a 4-neighbour ocean path from a friendly Port.
- The launch costs a normal front launch **plus the 200-supply Port cost**, paid up front. Supply is spent at launch; the boat carries the landing.
- The boat follows the deterministic shortest sea route at **80 map px/s** and is rendered on the overlay with its owner color and wake.
- On arrival the target shore becomes a friendly beachhead, a **new Port is automatically built there**, and a regular inward front is opened against the lowest-defense adjacent land. If the target is no longer valid, the landing is cancelled.
- Ports anchor annexation protection when their friendly-owned land component reaches the owner's State, or when their sea component is shared with such a Port of the same owner.
- Naval landing state includes route, launch/arrival ticks, and the target beachhead in checksums and snapshots.

### 4.18 Districts and structure stacking

- Every **buildable** structure seeds a **district** for its owner. State capitals are special aura anchors and do not claim districts, so the starting territory remains buildable.
- Districts are computed as a constrained Voronoi map: an owned cell joins the nearest eligible structure of its owner, with ties broken by structure type code then structure id.
- A district cannot exceed its structure's nominal `districtRange` by more than a small noise margin, cannot leave the owner's borders, and cannot overlap another district. Cells outside every structure's range remain unassigned.
- District edges are perturbed by deterministic integer noise: coherent 8 px value noise plus a faint per-pixel jitter. This makes the outer edge grow or shrink by roughly 2 px and makes Voronoi split lines irregular. It is purely visual/geometric; all captures and auras still use the resulting district map.
- Multiple structures and districts of the same type are allowed. Dropping a matching type inside a district stacks onto **that district's** structure; dropping it outside all districts creates a new structure and district.
- Touching districts of the **same owner and type** merge visually: their internal district seams/fill variants disappear and one icon at their centre shows the combined stack count. The territory shader compares the type base instead of the per-district variant while merging is enabled.
- Merged groups are recomputed from the district map at a throttled cadence (at most every 5 ticks) and their level totals refresh on every read. This is a visual/upgrade convenience; gameplay districts and auras remain per-structure.
- A different structure type cannot be placed inside an existing district. A new type can only be placed on owned land outside all districts.
- Defensive auras apply to every owned cell in the owning structure's district; Fortifications cover their whole district. State auras use their radius around the capital. Barracks and Jammers are global attacker/defender modifiers, not pixel auras.
- Each stack increases the structure's effect: supply income, aura defense, attack levels, suppression, or supply cap.
- Capturing a structure destroys it and recomputes districts; capturing an ordinary cell reassigns just that cell.

| Structure     | District range | Stack effect                    |
| ------------- | -------------: | ------------------------------- |
| Artillery     |          64 px | active siege, no passive income |
| Barracks      |          44 px | +1 effective attack level       |
| Fortification |          40 px | +1 defense per stack            |
| Jammer        |          32 px | −1 enemy attack level per stack |
| Command Post  |          32 px | +1 supply/s per stack           |
| War Academy   |          32 px | +80 supply cap per stack        |

District cells receive a subtle tint, a per-district brightness variant, and a **sharp high-contrast cream/amber outline**, so adjacent districts remain distinguishable even when their fill resembles terrain. WebGPU control alpha packs 3 elevation bits and a 5-bit district palette code. The shader's merge uniform removes same-type internal seams and variants; Ctrl turns it off. While a card is being placed, the selected type's districts owned by the player pulse with a warm wash and amber outline. The 2D structure overlay draws one combined icon per multi-structure merged group.

Circular and smooth are both radial layers and can look similar. Circular uses exact global Euclidean priority; smooth uses banded distance plus local neighbour scoring, which rounds the edge but does not produce a different overall footprint. Organic is the visually distinct mode.

---

## 5. Player experience

### 5.1 Screen flow

1. **Boot/loading:** map, starts, and WebGPU initialisation.
2. **Intro / match setup:** seed load, state count (8/16/24/32/51), map preset (standard/compact/clash), bot difficulty (relaxed/standard/ruthless), growth layer, optional 10/20/30-minute timer, victory summary, saved defaults, rebuild, deploy. Simulation paused.
3. **Live match:** state-count-aware HUD, optional countdown, virtualized scrollable leaderboard, map, minimap, compact economy/orders/defense readout, perf readout.
4. **Paused:** fixed ticks stop; camera still works.
5. **Defeat:** human has no territory; spectate/rematch/new world.
6. **Result:** last state wins; final standings.
7. **Field manual:** explains the experiment, orders, camera, system.
8. **WebGPU unavailable:** actionable error screen.

### 5.2 HUD

- Brand with attack-stress identification and the current state count.
- Human name/color, land share, rank, living-state count.
- War clock.
- Pause/resume, field manual, new world.
- Rival supply banners: map-anchored transparent name/supply text at each living rival's capital, updated from 5 Hz snapshots. Text scale is a deterministic function of the rival's territory relative to the largest living rival, so larger states have larger text. The banner must fit inside the state's on-screen footprint: it shrinks to fit, then hides if the footprint is too small to hold legible text. There is no plaque, background fill, or colored border. Offscreen rivals and the human are excluded; visible banners are clamped inside the viewport.
- World-control leaderboard: one logical row per state in a virtualized scroll container; only the visible window is mounted, sorted by alive, then territory, then id.
- Active fronts and alive state count.
- War feed for eliminations/victory.
- World claimed meter.
- Minimap with camera rectangle and start positions.
- Status console: hover coordinate/ownership and human active orders.
- Zoom/fit/focus tools; FPS, uploaded pixels/second, and texture write calls/second.
- Pointer drag pans and the wheel zooms. Touch supports one-finger pan/tap and two-finger pinch zoom anchored at the gesture midpoint; a pinch suppresses the follow-up tap.
- Keyboard navigation: arrow keys move a map cursor from the capital, Shift accelerates and makes Enter queue a five-level upgrade, Enter attacks or upgrades the cursor cell, and Escape clears it. A visually hidden live region announces owner, defense, and available action.
- Growth-layer switcher for circular / smooth / organic, affecting new orders only.
- State and buildable structure markers on the map and minimap; anchored status in the commander readout; structure-destroyed war-feed event.
- A free-floating CCG-style hand at the bottom center.
- A horizontal supply bar fills from `supply / cap`, with the current supply label inline on the left and the max label inline on the right. It sits just above the collapsed hand's peeking strip and below the card tray in z-order, so raising/interacting with the cards covers it. Hovering a valid click shows the impending cost as a striped red segment on the fill, a `-cost` chip, and a `NEED` state when unaffordable. Valid click previews cover front launches, district upgrades (including Shift ×5), and artillery barrages. The bar's meta row hosts income, FIRE, and CANCEL FRONT. The old supply/front/defense panel is removed.
- Number keys `1`–`6` select the corresponding card and enter placement mode without dragging; the player's existing districts of that structure type are highlighted until placement ends. A left-click on the map queues that card at the clicked cell; right-click cancels placement and the main shell suppresses the browser context menu. Escape and selecting another number also cancel/replace placement.
- First-match onboarding shows three contextual hints: launch a front, drag a card into territory (or press its number then click), then click a district to upgrade. Hints advance on success, can be skipped, and completion is stored locally.
- Cards have frame/art/rules layouts, animate in from below, lift on hover, and tilt/scale while dragged.
- The card hand sits above the bottom edge. When the pointer leaves it, the cards slide down to a semi-hidden peeking strip; moving the pointer back over that strip raises them again.
- The bottom center is reserved for the hand; the growth selector lives in the left rail above the minimap.
- The top-center status console was removed. Supply and cap now live in a horizontal fill bar above the hand; cost previews overlay the bar on hover. The old supply/front/defense panel is gone.
- While dragging, a curved accent arrow connects the raised card to the cursor, with no browser ghost card. The landing cell shows the 8 px exclusion radius: green when the build is legal, red when blocked.
- The ORDERS value updates as orders are spent or granted.
- HUD data refreshes at 5 Hz; territory rendering and simulation remain at 10 Hz.
- Leaderboard virtualization: only visible rows plus overscan exist in the DOM.

### 5.3 Controls

| Input           | Action                                   |
| --------------- | ---------------------------------------- |
| Left click/tap  | Issue a free attack if valid             |
| Left drag       | Pan; a drag does not fire an attack      |
| Wheel           | Zoom at pointer                          |
| Space           | Pause/resume                             |
| `F`             | Fit map                                  |
| `C`             | Focus human beachhead                    |
| `+` / `−`       | Zoom                                     |
| `H`             | Field manual                             |
| Minimap click   | Center camera                            |
| Growth switcher | Choose the frontier layer for new orders |

### 5.4 Camera

- Default: human start, 3.8× fit zoom.
- Range: 0.82×–18×.
- No edge pan clamp: the map can overscroll so edge states can be centered away from HUD panels; outside-map space renders as ocean/void.
- CSS-pixel input, DPR capped at 2.
- Pausing/UI interaction must not move the camera unexpectedly.

### 5.5 Feedback

- Valid/invalid orders do not open a floating last-action box; the map, HUD, and target feedback carry the result.
- Human attack targets drawn on minimap.
- Hover outline and ownership label.
- Human supply/cap in the horizontal supply bar, with FIRE and CANCEL FRONT at its right edge.
- State-count-aware leaderboard scrolls via virtualization; rank numbers are absolute and the human row is highlighted when visible.
- Paused clicks do not issue orders.

### 5.6 Accessibility/responsive

- Buttons have labels/focus states; reduced-motion support.
- Desktop: topbar, scrollable right rail, minimap, compact bottom economy/orders/defense panel, tool rail.
- Narrow: right rail/key hints collapse, topbar compresses, minimap/status shrink.
- Two-finger pinch zoom and a compact mobile hand layout are implemented; 320–430 px testing remains.

---

## 6. Technical contracts

### 6.1 Layer boundaries

| Layer            | May read                      | May mutate                              | Must not                             |
| ---------------- | ----------------------------- | --------------------------------------- | ------------------------------------ |
| Simulation       | constants, map, RNG           | owners, players, attacks, change buffer | DOM, clock, randomness, renderer, UI |
| Renderer         | sim arrays + change batch     | control texture, GPU resources, camera  | mutate sim state                     |
| UI               | snapshots, camera bridge      | UI state                                | mutate ownership                     |
| Network (future) | intents, snapshots, checksums | authoritative command queue             | trust client state                   |

### 6.2 Fixed-step driver

- rAF accumulator, 250 ms catch-up cap, max 4 simulation steps/frame.
- Paused/ended: no ticks.
- Simulation never reads wall-clock time.
- Camera and render loop are independent.

### 6.3 Snapshot and change batch

- Snapshot after each tick; no direct simulation arrays in UI.
- Snapshot includes the current growth mode used for new orders, live structures, public attacks with their creation layer, in-flight artillery, and naval landings with their sea routes/progress.
- Change batch: `(owner << 21) | pixelIndex`, `Uint32Array(16_384)`.
- Consumed before the next tick.
- Overflow triggers renderer full resync and never changes game state.

### 6.4 Player payload

Current public player fields:

```ts
{
	(id, name, isBot, alive, territory, landShare, supply);
}
```

No troop or production-cap economy exists. The human snapshot also carries cap, income, and hand cards. Bots carry parallel supply/accrual state internally and spend it on fronts and structures; every player's current supply is exposed for the rival supply banners.

---

## 7. Determinism contract (summary)

Full detail: [DETERMINISM.md](DETERMINISM.md).

1. Same build + map version + seed + ordered commands ⇒ same state and checksum.
2. No wall clock, frame rate, camera, device, UI, or unseeded randomness in decisions.
3. Ownership and positions are integer; attacks have no float math.
4. PRNG seeded; bot draw order fixed by ascending player id.
5. Commands apply at tick boundaries in stable order.
6. Attack ordering by creation id; queue processing FIFO; neighbour enqueue order W/E/N/S.
7. Checksums cover tick, RNG, growth modes, supply/accrual, front strength/power/pierce/idle state, owners, per-cell claim provenance, players, cards, and winner.
8. Any behavior change requires tests and a protocol-version decision.

---

## 8. Rendering contract (summary)

Full detail: [RENDERING.md](RENDERING.md).

1. One map-sized `rgba8unorm` control texture (default 2048 × 1024) and a 256 × 1 palette texture.
2. R = owner id, G = land, B = terrain shade, A = normalized elevation tier.
3. Per-tick changes normally upload 32 × 32 dirty tiles merged into strips. Above 96 dirty tiles, an adaptive full-texture resync is queued and uploaded in eight horizontal chunks, at most two per frame. No frame does a synchronous full-map upload.
4. One full-screen triangle and one fragment shader.
5. Renderer never mutates simulation state.
6. WebGPU failure is explicit; no silent blank map.
7. DPR capped at 2.
8. Shader differences across GPUs cannot affect simulation.

---

## 9. Networking target (summary)

Full detail: [NETWORKING.md](NETWORKING.md).

- Server-authoritative intents, deterministic 10 Hz simulation.
- Clients may run local prediction.
- Server stamps commands with authoritative ticks; deterministic ordering.
- Owner deltas/checksums/baseline resync.
- Growth mode must be authoritative (match config or a tick-stamped command), and per-attack layers part of the public state.
- No server exists yet.
- Wire types are in `src/lib/game/net/protocol.ts`; current player payload has no economy fields.

---

## 10. Performance requirements

| Area                                         | Target                                         |
| -------------------------------------------- | ---------------------------------------------- |
| Simulation tick, circular/organic, 51 states | < 4 ms p95 (10 Hz budget = 100 ms)             |
| Simulation tick, smooth, 51 states           | < 6 ms p95                                     |
| Render loop                                  | 60 fps at 1600 × 1000 under stress             |
| Input smoothness under full attack load      | no recurring 10 Hz hitch; p99 <8 ms at 144 fps |
| Tick-boundary upload work                    | < 2 ms; full resync must be chunked            |
| Map generation + 51 starts                   | < 500 ms                                       |
| Checksum                                     | On demand, < 25 ms (includes claim provenance) |
| Browser JS/GPU memory                        | < 300 MiB total for the stress build           |
| Input latency                                | Click-to-frontier update ≤ 2 ticks             |

See [PERFORMANCE.md](PERFORMANCE.md) for measured results and method.

---

## 11. Failure handling

| Failure                      | Behavior                                    |
| ---------------------------- | ------------------------------------------- |
| No WebGPU/adapter            | Error overlay                               |
| Shader compile error         | Error overlay with compiler text            |
| Device lost                  | Error callback/overlay                      |
| Change buffer overflow       | Renderer full resync; simulation unaffected |
| Invalid pixel index          | Skip; resync available                      |
| Map/start generation failure | Error state                                 |
| Tab suspended                | Catch-up capped at 4 ticks                  |
| Undefined palette id         | Falls back to neutral color                 |

---

## 12. Acceptance criteria — v0.2 attack stress

- [x] All 51 states spawn with nonzero territory.
- [x] Same seed and commands produce identical checksums with all bots attacking.
- [x] Ownership is always land-only; territory totals match owner counts.
- [x] Fronts resolve without corrupting frontier sets.
- [x] Change buffer does not overflow in stress runs.
- [x] Clicking a valid frontier creates a free attack with no economy check.
- [x] Circular, smooth, and organic growth layers are selectable and deterministic.
- [x] A growth-layer switch applies to new orders at the next tick; in-flight orders retain their layer.
- [x] Distance-based growth is anchored at the border contact, never at a deep click.
- [x] Mutual fronts trade durable strength simultaneously; a front at zero dies and the survivor pauses.
- [x] Detached pockets are annexed by the adjacent protected mainland with the largest shared border.
- [x] Small neutral pockets and coastal slivers are filled into the dominant adjacent owner every 10 seconds.
- [x] Each state has a capturable State structure anchoring its annexation-protected territory.
- [x] Six elevation tiers color the map and add base defense.
- [x] Occupied pixels add one defense; effective Barracks levels scale cost/strength linearly and power/piercing logarithmically.
- [x] A live State structure adds 20 defense within 16 px; the bonus disappears when the structure is destroyed.
- [x] The human starts with all seven cards and 90 supply, earns supply income, can build repeatedly, and never loses a card from the hand.
- [x] Artillery, Barracks, Fortification, Jammer, Command Post, and War Academy apply their active/economy/combat effects.
- [x] Fronts cost supply and buy durable strength; cancellation refunds the remaining strength share; holding 70% of land wins instantly.
- [x] Structures claim bounded, non-overlapping Voronoi districts within owner borders; aura effects are limited to their district.
- [x] Attacks sample the top frontier cells and prefer the cheapest local defense, flowing around strongpoints.
- [x] Same-type cards stack onto the existing structure; different types are rejected inside a district.
- [x] Command Posts accrue orders continuously, and War Academies raise the cap.
- [x] Clicking an owned district upgrades its structure without consuming a card; Shift-click queues five levels and the cursor tooltip shows the total cost. Touching same-type districts merge visually, merged upgrades prioritize the lowest structure, and Ctrl disables merging.
- [x] HUD and leaderboard scale to 51 logical rows and active counts, with DOM virtualization.
- [x] Panning stays smooth under full stress (p99 7.1 ms; isolated cleanup spikes only).
- [x] 51-state browser run stays interactive at 1600 × 1000; 7 s organic run measured p99 7.1 ms and 1/1008 frames >10 ms.
- [x] `pnpm check`, `pnpm test`, `pnpm build` pass.
- [x] Docs clearly state that current attack semantics are experimental.
- [ ] Final attack model decided and implemented.
- [ ] Economy restored or replaced.

---

## 13. Open questions

1. **Final attack model:** cost/resource, duration, cancellation, targeting, propagation shape, and limits?
2. **Economy:** what resource and generation model returns, and how it throttles attacks?
3. **Match size:** 51 is a stress mode. What is the shipping player/state count?
4. **Match duration/pacing:** unthrottled attacks saturate the map in ~10 seconds.
5. **Leaderboard scale:** scroll, pagination, or top-N with pinned player?
6. **Growth layer:** should shipping play use circular, smooth, organic, or a blend? Keep the test switch?
7. **Queue bounds:** apart from its embedded-order lifetime, should a front have a lower candidate/capture bound?
8. **Server tick buffer:** how much latency to absorb in online play?
9. **Map format:** procedural generation vs baked assets for cross-engine certainty?
10. **Simulation worker:** when to move off the main thread?
11. **WebGL fallback:** worth the maintenance cost?
