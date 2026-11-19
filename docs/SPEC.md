# TERRITORY — Specification

**Version:** 0.20.0 (attack stress experiment)  
**Status:** Local attack-focused stress build; online design target  
**Last synchronized with:** application 0.20.0, map version 3, protocol draft 27

This is the canonical description of what Territory is, what the current build does, and which technical contracts must hold. [ARCHITECTURE.md](ARCHITECTURE.md) explains the code; this document explains the intent and current rules. Temporary deviations are tracked in [EXPERIMENTS.md](EXPERIMENTS.md).

> **Important:** The troop economy has been temporarily removed, but a light human gold/card economy and terrain defense are now active. This is **not the intended final combat model**. See section 4.10 and [EXPERIMENTS.md](EXPERIMENTS.md).

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
- One shared 2048 × 1024 atlas, approximately 38% land.
- Fixed 10 Hz simulation.
- Land generates a resource; attacks cost resources and time.
- Final attack semantics are **undecided**. The current free flood-fill front is a stress-test stand-in.
- Victory by last state standing or a future objective system.

---

## 2. Current build: attack stress experiment

### 2.1 Purpose

Exercise the attack pipeline in isolation:

- 107 AI states + one human all attacking continuously.
- Dense territory collision and simultaneous fronts.
- Hundreds of ownership changes per tick.
- Many dispersed texture upload regions.
- Large frontier-set and attack-queue workloads.

The user explicitly requested removing troops and adding 100 AI opponents, then iteratively added terrain defense, structures, and a light human gold/card economy. This build is an engineering experiment, not a balance proposal.

### 2.2 Implemented

| Area                                                      | Status                   |
| --------------------------------------------------------- | ------------------------ |
| 2048 × 1024 seeded procedural atlas                       | ✅                       |
| Land/ocean mask and terrain relief                        | ✅                       |
| 108 states (1 human + 107 AI)                             | ✅                       |
| Pixel ownership and incremental frontier tracking         | ✅                       |
| Resource-free local-front attacks (BFS)                   | ✅                       |
| Attack orders: 3 human / 2 bots, +1 per 10 s up to cap    | ✅                       |
| Bot expansion/attacks                                     | ✅                       |
| Elimination and last-state-standing victory               | ✅                       |
| Pause, camera pan/zoom/fit/focus                          | ✅                       |
| WebGPU renderer with adaptive dirty-tile/chunked uploads  | ✅                       |
| Circular / smooth / organic selectable growth layers      | ✅                       |
| State structures anchoring territory and projecting auras | ✅                       |
| Human gold income and drag-and-drop build cards           | ✅                       |
| Minimap, virtualized 108-state leaderboard, perf readout  | ✅                       |
| Seed input, URL seed, new world, rematch                  | ✅                       |
| Intro, field manual, defeat, result, WebGPU error screens | ✅                       |
| Deterministic tests + attack stress tests + benchmark     | ✅                       |
| Troops, caps, launch costs                                | ❌ intentionally removed |
| Light human gold/card economy                             | ✅ experimental          |

### 2.3 Not implemented

| Area                                                    | Target                                         |
| ------------------------------------------------------- | ---------------------------------------------- |
| Final attack design                                     | Undecided; must replace the experimental model |
| Bot card economy/build AI                               | Human-only card loop for now                   |
| Structure construction beyond cards, ownership transfer | State + five buildables; design pending        |
| Authoritative game server, rooms, reconnect, prediction | [NETWORKING.md](NETWORKING.md)                 |
| Human-vs-human play, lobbies, spectating                | [ROADMAP.md](ROADMAP.md)                       |
| Accounts, progression, persistence                      | [ROADMAP.md](ROADMAP.md)                       |
| Replay viewer                                           | [DETERMINISM.md](DETERMINISM.md)               |
| Fog, diplomacy, audio, pinch zoom, WebGL fallback       | Backlog                                        |

---

## 3. Vocabulary

| Term                 | Meaning                                                                                |
| -------------------- | -------------------------------------------------------------------------------------- |
| **Cell / map pixel** | One element of the 2048 × 1024 ownership grid                                          |
| **Owner**            | State id `1..108`; `0` means unclaimed                                                 |
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

- 2048 × 1024 cells (2,097,152 total).
- Generator targets 38% land.
- Static binary land mask, 8-bit terrain shade, and a discrete elevation tier (0–5).
- Elevation is derived from land-height quantiles, colored from lowland through peaks, and drives base defense.
- Ocean cannot be owned.
- Map and starts are deterministic from the seed and versioned by `MAP_VERSION`.
- `MAP_VERSION = 3`; `PROTOCOL_VERSION = 27`.

### 4.2 Starting positions

- 108 start points are selected by farthest-point sampling over high-density land candidates, seeded deterministically.
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
7. Launching consumes **1 attack order**. The human starts with 3 orders (cap 3) and bots with 2 (cap 2). Every **10 seconds**, each living player gains **1 order, up to the cap**; attacks do not refund an order when they end. Multiple active fronts are allowed while orders remain.
8. Every launched attack **embeds orders**: base 1, plus `min(5, ceil(live Barracks levels / 2))`. The launch still costs one inventory order. Repeated clicks create separate attacks; they never add orders to an existing attack.
9. Each tick, the front's selected **growth layer** nominates candidate frontier cells until its attack-point budget is spent or no candidates remain. Budget is `30 + 15 × (embeddedOrders − 1)`. For each capture, the simulation samples up to **10** of the highest-priority candidates and takes the one with the lowest current defense cost; ties keep growth priority. Capture cost is `max(1, defense − embeddedOrders + 1)`, so stronger attacks are less slowed by defense. Invalid/stale cells are skipped without consuming the budget. See sections 4.12 and 4.16.
10. Before every capture, the cell must still share a land edge with territory owned by the attacker. If another front severed the path back to the attacker, the queued cell is discarded. A front can never create a detached enclave.
11. Before claiming, the candidate checks whether a neighbour was captured by an opposing attack in a mutual war. If so, the defender spends `min(its attack strength, its remaining attack-order inventory, incoming embedded orders)` orders. Each spent order removes one embedded order from the incoming attack. If the incoming attack reaches 0 embedded orders it halts; otherwise the clash pauses that front for the tick. A defender with no spendable orders cannot reduce it, and the attack breaks through. See section 4.13.
12. Capturing a cell claims it for the attacker and pushes its four neighbours onto the growth layer's frontier if they are still owned by the target and are land. Duplicate candidates are tolerated; ownership is the visited check. If the remaining budget cannot afford even the cheapest sampled candidate, all sampled cells are queued again for the following tick.
13. **Orders are finite:** a front expires after `50 + 10 × (initialEmbeddedOrders − 1)` ticks. More embedded orders therefore take more ground before petering out.
14. The front also ends early when its frontier is empty, its embedded orders reach 0, or a non-clash tick produces **zero legal captures**. A clash pause does not end the front.
15. Attacks are processed in creation-id order. If another front takes a cell first, the later front skips it.
16. A front continues only while it has at least one legal cell adjacent to the attacker's territory and its lifetime has not elapsed.

### 4.4 Valid attack clicks

An attack is valid only if:

- the match is not ended,
- the attacker is alive,
- the clicked coordinate is on land,
- the clicked cell is not owned by the attacker,
- the attacker has at least one available attack order,
- at least one target-owned cell within 34 cells touches the attacker's territory.
- adjacency is checked again when the command executes and on every captured cell.

There is no troop/resource check. Failure reasons: ocean, own territory, no shared border, no attack orders, eliminated, match over, invalid coordinates.

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
- The last living state wins; the tick loop stops advancing.
- If the human is eliminated, the UI pauses and offers spectate/rematch/new world. Spectating resumes the simulation.

### 4.8 Bots

- 107 AI states.
- Bots act once per second (`BOT_DECISION_INTERVAL = 10`).
- A bot with at least one available attack order samples its frontier deterministically up to 8 times and launches one attack when it finds a valid adjacent target. Applying it spends one order.
- It attacks neutral neighbours whenever its sampled frontier has one, and only attacks a rival when no neutral option exists. This is a provisional stress-build policy, not final AI.
- Bots use the same attack-order rules, with a base cap of 2 and no cards.
- Bots share one seeded PRNG, processed in ascending player-id order, so behavior is replayable.
- With no troop economy, bots attack from the first decision tick; terrain defense, capital auras, and human build cards slow, but do not stop, expansion.

### 4.9 Tick order

1. Increment `tick`.
2. If a growth-mode switch is pending, apply it before any new attacks are created.
3. Grant each living player +1 attack order, clamped to cap, on a 10-second boundary.
4. Accrue Mine gold and Command Post orders continuously for this tick.
5. Apply queued attack/build/upgrade commands sorted by `(sequence, playerId)`.
6. Run bot decisions (only on every 10th tick).
7. Process active attacks in creation-id order.
8. Every 10 ticks (or immediately after a clash halts a front), annex detached territory into surrounding mainlands.
9. Eliminate states with no territory and remove their attacks.
10. Check victory.
11. Build the public snapshot.

### 4.10 Experimental attack caveats

This attack model is intentionally provisional:

- Each launch consumes one attack order; players gain one order every 10 seconds rather than refunding when a front ends.
- The order cap is a hard cap. Command Post grants are clamped to it; War Academies raise the cap.
- It flood-fills through an arbitrarily large connected region; the chosen growth layer controls whether the shape is circular, radially smoothed, or organic.
- It ends when its frontier is exhausted, its embedded orders reach 0, its land connection is severed (zero legal captures on a non-clash tick), or its lifetime expires.
- Bots do not coordinate or defend strategically.
- The 108-state match may become a near-even patchwork.
- Attack-order limits are now part of the experimental economy, not only a stress guardrail.

The final design may introduce costs, supply, attack duration, cancellation, target selection, and different propagation rules. Do not build balance or progression on the current semantics. See [EXPERIMENTS.md](EXPERIMENTS.md).

### 4.11 Combat randomness

Combat has no combat-roll randomness, crits, spread, or morale. The organic growth layer uses a deterministic per-attack PRNG solely to choose frontier candidates; the sequence is reproducible. The least-resistance sampler is deterministic: it samples a fixed number of candidates in growth order, compares integer effective costs, and breaks ties by sample order. Given the same state, growth mode, and accepted commands, every pixel outcome is deterministic.

### 4.12 Growth layers

Every attack captures a `growthMode` at creation time and keeps it for its lifetime. The selected mode applies to all **new** attack orders (human and bots); existing orders are unchanged.

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

- the defender's attack strength is `1 + min(5, ceil(live Barracks levels / 2))`;
- it spends up to `min(attack strength, remaining attack-order inventory, incoming embedded orders)` inventory orders;
- each spent order removes one embedded order from the incoming attack;
- if the incoming attack reaches 0, it halts;
- otherwise the clash pauses the incoming front for this tick.

A defender with insufficient Barracks strength or too few remaining orders therefore only chips the incoming attack; it may require multiple clashes (multiple defensive attacks) to halt it. With no spendable orders, the incoming front breaks through. Third-party attacks and attacks against a common target are unaffected.

### 4.14 Territory integrity

Every player begins with one **State structure** at their capital. A player's **protected mainland** is every connected land component containing a live State structure they own (4-neighbour, land only). Every `ANNEX_INTERVAL_TICKS` (10 ticks / 1 second), and promptly after a clash halts a front, the simulation labels components and annexes unprotected ones:

- a component is transferred only if it touches another player's **protected mainland**;
- the recipient is the adjacent protected-mainland owner with the greatest shared border;
- ties go to the lower player id;
- components touching only ocean, unclaimed land, another unprotected component, or an unprotected territory are left alone.

This restores dead pixels and severed pockets to the surrounding claim while guaranteeing that territory connected to a State structure is never annexed. Legitimate islands with no adjacent protected claimant are not deleted.

### 4.15 State structures

- Each state starts with one State structure on its start cell.
- The structure is part of the owning state's territory and can be captured by an attack.
- Every land component connected to a live State structure is protected from annexation.
- A live State structure projects a **16 px defense aura** adding **+20 defense** to land in range owned by that state. The structure cell itself is inside the aura. Auras never buff neutral or enemy land. Overlapping friendly auras do not stack; the strongest applies.
- Capturing the structure destroys it immediately and removes its aura. The owner keeps any remaining territory, but none of it is annexation-protected until another structure anchors it.
- Only State structures anchor protection. Mines, Barracks, Defense Posts, Command Posts, and War Academies do not prevent annexation.
- State structures are large owner-colored circles with a cream capital star (15 px human / 11 px AI radius). Buildables are 10 px dark badges with an owner-colored ring and a type-accent icon (amber pickaxe, red swords, cyan shield, green command mast, violet academy chevrons). Marker sizes are fixed in screen pixels and do not grow with camera zoom. The HUD shows the human state's `ANCHORED`/`NO ANCHOR` status and a war-feed event when a structure is destroyed.
- Structure placement, capture, and protection are deterministic and included in checksums.

State is the permanent anchor structure. Mines, Barracks, Defense Posts, Command Posts, and War Academies are the player-built structures; construction beyond cards, more types, and ownership transfer are future work.

### 4.16 Elevation and defense

| Property                         | Value                                                           |
| -------------------------------- | --------------------------------------------------------------- |
| Elevation tiers                  | 0 lowland, 1 plains, 2 hills, 3 highlands, 4 mountains, 5 peaks |
| Base defense                     | `1 + elevation`                                                 |
| Occupied bonus                   | `+1` when the pixel has a nonzero owner                         |
| State aura                       | `+20` within 16 px; overlapping auras do not stack              |
| Attack points per front per tick | `30 + 15 × (embedded orders − 1)`                               |
| Capture cost                     | `max(1, defense − embedded orders + 1)`                         |
| Lifetime                         | `50 + 10 × (initial embedded orders − 1)` ticks                 |
| Defense range                    | 1–6 unowned, 2–7 occupied, up to 27 in a State aura; posts add  |

- Elevation tiers are assigned by land-height quantiles; most land is lowland, peaks are rare.
- Elevation is static map data. Defense is derived from elevation plus current ownership, so capturing a pixel changes future defense there but not the map.
- A base front can spend 30 points per tick; each extra embedded order adds 15 points, one point of defense piercing, and 10 ticks of lifetime. Cheap neutral lowland with a base front can move 30 pixels per tick; defended peaks move 4, and aura-covered occupied high ground moves 1.
- The HUD hover readout exposes elevation tier, base defense, aura bonus, and total defense.
- Elevation is rendered as a six-color terrain palette with boundary contours, tinting owner colors rather than replacing them.
- Aura circles are not rendered; district tint and boundaries communicate territorial structure.

### 4.17 Player economy and build cards

The human commander has a small card economy; bots do not build cards yet.

- Start with **3 gold** and **all five buildable cards** always available in the hand.
- Earn **1 gold per 10 seconds** (`INCOME_INTERVAL_TICKS = 100`), plus **1 per live Mine stack**.
- Gold is accrued **continuously every tick**, not as a lump sum. A level-30 Mine contributes 30 gold over the next 100 ticks. An integer remainder accumulator keeps the total exact and deterministic.
- Clicking any pixel of an owned buildable district queues a one-level upgrade costing `base card cost + current level` (projected through any already-queued upgrades). No card is consumed.
- Build and upgrade commands reserve gold against other queued upgrades so rapid clicks cannot overspend.
- Playing a card requires dragging it onto **controlled land** outside every existing district, with no structure and at least **8 px from every other structure**.
- Dropping inside a same-type district upgrades that district's structure at `base card cost + current level`; dropping the same type outside all districts creates another structure at its base card cost.
- The build command is queued, applied at the next tick, deducts its cost, keeps the card, and either creates a new structure or adds a stack to the matching district.
- Cards are permanent actions, not a consumable hand: any affordable card can be bought again immediately. There is no draw, deck, or reroll.
- Costs: Mine **3**, Barracks **12**, Defense Post **2**, Command Post **4**, War Academy **6**.
- Command Posts accrue **+1 attack order per 60 seconds continuously**. A level-30 post therefore produces 30 orders over 60 seconds rather than a 30-order pulse. Grants are clamped to the cap and excess is lost.
- War Academies add **+1 to the attack-order cap** while alive; additional War Academy cards stack this cap bonus.
- Captured buildable structures are razed and their effects disappear.
- **Defensive auras are friendly-only.** A Defense Post or State aura modifies defense only on cells currently owned by the structure's owner; it never raises the cost of that owner's attacks into neutral or enemy territory.
- Structure placement has an **8 px centre-to-centre exclusion radius**. The existing cell and every other structure block a drop inside that radius.

| Card         | Cost | Effect                                                           |
| ------------ | ---- | ---------------------------------------------------------------- |
| Mine         | 3    | +1 gold per 10 seconds, paid continuously                        |
| Barracks     | 12   | +1 embedded order per 2 levels, capped at +5                     |
| Defense Post | 2    | +5 defense to every friendly pixel in its 40 px district; stacks |
| Command Post | 4    | +1 attack order per 60 seconds, paid continuously                |
| War Academy  | 6    | +1 attack-order cap                                              |

Every two live Barracks levels add one embedded order to the owner's attacks, rounded up and capped at +5. Embedded orders increase capture speed, defense piercing, and lifetime. Barracks also raises the owner's defensive clash strength because defense uses the same issued attack strength.

### 4.18 Districts and structure stacking

- Every **buildable** structure seeds a **district** for its owner. State capitals are special aura anchors and do not claim districts, so the starting territory remains buildable.
- Districts are computed as a constrained Voronoi map: an owned cell joins the nearest eligible structure of its owner, with ties broken by structure type code then structure id.
- A district cannot exceed its structure's nominal `districtRange` by more than a small noise margin, cannot leave the owner's borders, and cannot overlap another district. Cells outside every structure's range remain unassigned.
- District edges are perturbed by deterministic integer noise: coherent 8 px value noise plus a faint per-pixel jitter. This makes the outer edge grow or shrink by roughly 2 px and makes Voronoi split lines irregular. It is purely visual/geometric; all captures and auras still use the resulting district map.
- Multiple structures and districts of the same type are allowed. Dropping a matching type inside a district stacks onto **that district's** structure; dropping it outside all districts creates a new structure and district.
- A different structure type cannot be placed inside an existing district. A new type can only be placed on owned land outside all districts.
- Defensive auras apply to every owned cell in the owning structure's district; the old effect-radius clipping does not shrink a Defense Post's area. State auras use their radius around the capital. Barracks is not an aura: its order bonus applies globally to the owner's attacks.
- Each stack increases the structure's effect: income, aura defense, embedded attack orders, order gain, or order cap.
- Capturing a structure destroys it and recomputes districts; capturing an ordinary cell reassigns just that cell.

| Structure    | District range | Stack effect                     |
| ------------ | -------------: | -------------------------------- |
| Mine         |          32 px | +1 income per interval per stack |
| Barracks     |          44 px | +1 order per 2 levels, max +5    |
| Defense Post |          40 px | +5 defense per stack             |
| Command Post |          32 px | +1 order per 60s per stack       |
| War Academy  |          32 px | +1 cap per stack                 |

District cells receive a subtle tint, a per-district brightness variant, and a darker boundary, so adjacent same-type districts also remain distinguishable. WebGPU control alpha packs 3 elevation bits and a 5-bit district palette code.

Circular and smooth are both radial layers and can look similar. Circular uses exact global Euclidean priority; smooth uses banded distance plus local neighbour scoring, which rounds the edge but does not produce a different overall footprint. Organic is the visually distinct mode.

---

## 5. Player experience

### 5.1 Screen flow

1. **Boot/loading:** map, starts, and WebGPU initialisation.
2. **Intro:** seed load, deploy. Simulation paused. Copy identifies the attack stress build.
3. **Live match:** 108-state HUD, virtualized scrollable leaderboard, map, minimap, compact economy/orders/defense readout, perf readout.
4. **Paused:** fixed ticks stop; camera still works.
5. **Defeat:** human has no territory; spectate/rematch/new world.
6. **Result:** last state wins; final standings.
7. **Field manual:** explains the experiment, orders, camera, system.
8. **WebGPU unavailable:** actionable error screen.

### 5.2 HUD

- Brand with attack-stress identification and 108 states.
- Human name/color, land share, rank, living-state count.
- War clock.
- Pause/resume, field manual, new world.
- World-control leaderboard: 108 logical rows in a virtualized scroll container; only the visible window is mounted, sorted by alive, then territory, then id.
- Active fronts and alive state count.
- War feed for eliminations/victory.
- World claimed meter.
- Minimap with camera rectangle and start positions.
- Status console: hover coordinate/ownership and human active orders.
- Zoom/fit/focus tools; FPS, uploaded pixels/second, and texture write calls/second.
- Growth-layer switcher for circular / smooth / organic, affecting new orders only.
- State and buildable structure markers on the map and minimap; anchored status in the commander readout; structure-destroyed war-feed event.
- A free-floating CCG-style hand at the bottom center; gold and Refresh float at its sides with no enclosing tray and no empty-card placeholders.
- Cards have frame/art/rules layouts, animate in from below, lift on hover, and tilt/scale while dragged.
- The card hand sits above the bottom edge. When the pointer leaves it, the cards slide down to a semi-hidden peeking strip; moving the pointer back over that strip raises them again.
- The bottom center is reserved for the hand; the growth selector lives in the left rail above the minimap.
- The top-center status console was removed. Gold, attack orders/cap, and the hovered defense value now share a compact readout beside the hand. Grid reference and target-description text are gone.
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
- Clamped to the map at high zoom.
- CSS-pixel input, DPR capped at 2.
- Pausing/UI interaction must not move the camera unexpectedly.

### 5.5 Feedback

- Valid order → toast.
- Invalid order → specific reason toast.
- Human attack targets drawn on minimap.
- Hover outline and ownership label.
- Available human attack orders in the compact economy readout.
- 108-state leaderboard scrolls via virtualization; rank numbers are absolute and the human row is highlighted when visible.
- Paused clicks do not issue orders.

### 5.6 Accessibility/responsive

- Buttons have labels/focus states; reduced-motion support.
- Desktop: topbar, scrollable right rail, minimap, compact bottom economy/orders/defense panel, tool rail.
- Narrow: right rail/key hints collapse, topbar compresses, minimap/status shrink.
- Pinch zoom missing; mobile parity not claimed.

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
- Snapshot includes the current growth mode used for new orders, live structures, and public attacks with their creation layer.
- Change batch: `(owner << 21) | pixelIndex`, `Uint32Array(16_384)`.
- Consumed before the next tick.
- Overflow triggers renderer full resync and never changes game state.

### 6.4 Player payload

Current public player fields:

```ts
{
	(id, name, isBot, alive, territory, landShare);
}
```

No troop or production-cap economy exists. The human snapshot carries gold, income, and hand cards; bots have no economy yet.

---

## 7. Determinism contract (summary)

Full detail: [DETERMINISM.md](DETERMINISM.md).

1. Same build + map version + seed + ordered commands ⇒ same state and checksum.
2. No wall clock, frame rate, camera, device, UI, or unseeded randomness in decisions.
3. Ownership and positions are integer; attacks have no float math.
4. PRNG seeded; bot draw order fixed by ascending player id.
5. Commands apply at tick boundaries in stable order.
6. Attack ordering by creation id; queue processing FIFO; neighbour enqueue order W/E/N/S.
7. Checksums cover tick, RNG, growth modes, attack state/anchors, attack orders/timers, owners, per-cell claim provenance, players, cards, and winner.
8. Any behavior change requires tests and a protocol-version decision.

---

## 8. Rendering contract (summary)

Full detail: [RENDERING.md](RENDERING.md).

1. One 2048 × 1024 `rgba8unorm` control texture and a 256 × 1 palette texture.
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

| Area                                          | Target                                         |
| --------------------------------------------- | ---------------------------------------------- |
| Simulation tick, circular/organic, 108 states | < 4 ms p95 (10 Hz budget = 100 ms)             |
| Simulation tick, smooth, 108 states           | < 6 ms p95                                     |
| Render loop                                   | 60 fps at 1600 × 1000 under stress             |
| Input smoothness under full attack load       | no recurring 10 Hz hitch; p99 <8 ms at 144 fps |
| Tick-boundary upload work                     | < 2 ms; full resync must be chunked            |
| Map generation + 108 starts                   | < 500 ms                                       |
| Checksum                                      | On demand, < 25 ms (includes claim provenance) |
| Browser JS/GPU memory                         | < 300 MiB total for the stress build           |
| Input latency                                 | Click-to-frontier update ≤ 2 ticks             |

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

- [x] All 108 states spawn with nonzero territory.
- [x] Same seed and commands produce identical checksums with all bots attacking.
- [x] Ownership is always land-only; territory totals match owner counts.
- [x] Fronts resolve without corrupting frontier sets.
- [x] Change buffer does not overflow in stress runs.
- [x] Clicking a valid frontier creates a free attack with no economy check.
- [x] Circular, smooth, and organic growth layers are selectable and deterministic.
- [x] A growth-layer switch applies to new orders at the next tick; in-flight orders retain their layer.
- [x] Distance-based growth is anchored at the border contact, never at a deep click.
- [x] Mutual fronts spend defender attack orders to strip embedded orders from the incoming attack; a 2-order attack needs two 1-order defensive clashes to halt.
- [x] Detached pockets are annexed by the adjacent protected mainland with the largest shared border.
- [x] Each state has a capturable State structure anchoring its annexation-protected territory.
- [x] Six elevation tiers color the map and add base defense.
- [x] Occupied pixels add one defense; embedded attack orders scale points, piercing, and lifetime.
- [x] A live State structure adds 20 defense within 16 px; the bonus disappears when the structure is destroyed.
- [x] The human starts with all five cards and 3 gold, earns income, can drag any affordable card onto owned land repeatedly, and never loses a card from the hand.
- [x] Mine, Barracks, Defense Post, Command Post, and War Academy apply their economy/combat effects.
- [x] Attack orders start full, are spent per launch, and grant +1 every 10 seconds up to the cap; bot orders use the same rules.
- [x] Structures claim bounded, non-overlapping Voronoi districts within owner borders; aura effects are limited to their district.
- [x] Attacks sample the top frontier cells and prefer the cheapest local defense, flowing around strongpoints.
- [x] Same-type cards stack onto the existing structure; different types are rejected inside a district.
- [x] Command Posts accrue orders continuously, and War Academies raise the cap.
- [x] Clicking an owned district upgrades its structure without consuming a card.
- [x] HUD and leaderboard scale to 108 logical rows and active counts, with DOM virtualization.
- [x] Panning stays smooth under full stress (p99 7.1 ms; isolated cleanup spikes only).
- [x] 108-state browser run stays interactive at 1600 × 1000; 7 s organic run measured p99 7.1 ms and 1/1008 frames >10 ms.
- [x] `pnpm check`, `pnpm test`, `pnpm build` pass.
- [x] Docs clearly state that current attack semantics are experimental.
- [ ] Final attack model decided and implemented.
- [ ] Economy restored or replaced.

---

## 13. Open questions

1. **Final attack model:** cost/resource, duration, cancellation, targeting, propagation shape, and limits?
2. **Economy:** what resource and generation model returns, and how it throttles attacks?
3. **Match size:** 108 is a stress mode. What is the shipping player/state count?
4. **Match duration/pacing:** unthrottled attacks saturate the map in ~10 seconds.
5. **Leaderboard scale:** scroll, pagination, or top-N with pinned player?
6. **Growth layer:** should shipping play use circular, smooth, organic, or a blend? Keep the test switch?
7. **Queue bounds:** apart from its embedded-order lifetime, should a front have a lower candidate/capture bound?
8. **Server tick buffer:** how much latency to absorb in online play?
9. **Map format:** procedural generation vs baked assets for cross-engine certainty?
10. **Simulation worker:** when to move off the main thread?
11. **WebGL fallback:** worth the maintenance cost?
