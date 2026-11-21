# Determinism

Determinism is the referee of Territory. A match must be reproducible from:

```text
simulation build + map version + seed + ordered commands at ticks
```

For a local match, this is validated in unit tests. For online play, the server becomes the authority and every client must stay bit-for-bit aligned with it, or request a resync.

---

## 1. Guarantee

> Given the same simulation source, protocol version, map version, seed, and the same commands applied at the same ticks in the same order, `TerritorySimulation` produces the same owner map, players, attacks, winner, and `checksum()` result.

The current tests create two simulations from the same seed, enqueue the same attack, advance 120 ticks, and compare full player snapshots and checksums. They also verify that a queued cell disconnected from the attacker's border is never captured and its front is removed.

This guarantee does **not** cover:

- GPU rendering (presentation only),
- UI animation,
- frame rate or camera state,
- a different code build,
- a different map version,
- an untrusted client claiming its own outcomes.

---

## 2. Fixed timestep

- Rate: `TICK_RATE = 10`; one tick per 100 ms of simulated time.
- The driver accumulates actual elapsed time and calls `simulation.step()` in whole ticks.
- Maximum 4 catch-up ticks per render frame. If the budget is exceeded, the accumulator resets rather than running indefinitely.
- The simulation never reads `Date.now()` or `performance.now()`.
- Pausing stops tick advancement.
- A local game's tick count depends only on how many steps the driver ran, not on exactly when frames occurred. Command injection is tied to ticks, not wall-clock milliseconds.

Design consequence: a slow frame can cause two simulation steps in one frame, but all rules execute in the same deterministic order.

---

## 3. Integer arithmetic

All authoritative quantities are integers:

| Quantity                   | Representation                                 |
| -------------------------- | ---------------------------------------------- |
| Territory count            | JS number, integer                             |
| Owner id                   | uint16 (`1..51` in the stress build)           |
| Tick                       | integer                                        |
| PRNG state                 | uint32                                         |
| Growth layer               | one of `circular`, `smooth`, `organic`         |
| Frontier candidate storage | layer-specific deterministic structure         |
| Attack claim provenance    | attack id (uint32) per cell                    |
| Structure identity         | integer id, type enum, owner, map cell, stacks |
| District                   | per-cell structure type code (0 = none)        |
| Attack seed distance       | squared integer distance                       |
| Effective levels           | `max(0, attacker Barracks − defender Jammers)` |
| Power                      | `30 + 15 × logTier` per tick                   |
| Defense                    | `1 + elevation + occupied + aura`              |
| State aura                 | 16 px radius, +20, max once, friendly          |
| Elevation tier             | uint8, 0–5                                     |

No floating-point resources, morale, speed, or distance influences outcomes. The only floats in the whole map pipeline are inside map generation, which is versioned and completed before any match commands are applied.

There are no troop or production-cap values. Supply, supply accrual, fixed card ids, front strength, initial strength, power, piercing, effective levels, logTier, idle ticks, artillery cooldowns, and in-flight shell ticks are integer authoritative state. Shell impact spread (±36 px) uses `hash32` of seed, battery id, and shell index — never the shared PRNG.

Pixel positions are integer; clicks are floored to cell coordinates before commands are queued.

---

## 4. Seed and PRNG

### 4.1 Map seed

- A 32-bit seed generates the entire world.
- The map UI accepts 1–8 hex characters; URLs store the decimal equivalent.
- `MAP_VERSION` is part of the map identity. Seed alone is insufficient across generator versions.
- Match identity also includes map width/height, player count, growth mode, bot difficulty, and match timer.
- Sea components and naval routes derive from the static land mask; landing ids, owners, source Ports, routes, launch/arrival ticks, and target beachheads are checksummed. Protocol 38 adds `navalLandings` to snapshots.
- Strategic options are selected on decision ticks from integer utility scores, committed for a bounded duration, and checksummed with their expiry and target. Option selection and the QD descriptor archive use no wall-clock randomness.
- Evolution genomes are created, mutated, crossed, and matched only from `hash32`/seeded hashes in fixed order. Matches use all-bot simulations with fixed seat schedules and seeds; fitness and bucket ordering are integer/deterministic. The CSV round-trip does not introduce randomness. Two matches with the same seed but different setup are different worlds.
- Default generation (2048×1024, 51 states) remains byte-for-byte identical to the pre-configuration generator.

### 4.2 Simulation PRNG

`DeterministicRng` is mulberry32:

```text
state = (state + 0x6d2b79f5) | 0
t = state
t = imul(t ^ (t >>> 15), t | 1)
t ^= t + imul(t ^ (t >>> 7), t | 61)
return (t ^ (t >>> 14)) >>> 0
```

- Integer-only; no `Math.random`.
- One PRNG owned by the simulation, seeded `seed ^ 0x6a09e667`.
- Organic growth layers own a second deterministic PRNG seeded from the world seed, attack id, attacker id, and defender id.
- Draw order is part of the protocol.
- `nextInt(bound)` uses rejection sampling to avoid modulo bias. Rejection loops consume draws; the sequence remains deterministic.
- The PRNG state is included in every checksum.

### 4.3 Why draw order matters

Bots use the PRNG for:

- choosing a frontier cell,
- choosing the attack target among available neutral/hostile neighbours.

Bot profiles — aggression, economy, fortification, command, vengeance, caution, conciliation, opportunism, and the six per-type affinities (plus a display-only preference order) — are derived from `hash32` of the player id and world seed, not from the bot PRNG. Economy and attack utilities are integer/deterministic functions of profile, world state, reserves, and target scores. Removing or changing that derivation changes which structures bots build and which targets they choose. Border sampling for target scoring still consumes the shared PRNG, so changing the sample count or order changes draw counts and results.

Changing the number or order of these draws changes all subsequent bot behavior. A refactor that "just moves a random call" is a simulation change.

Bots are processed in ascending player id order. Economy/build checks run every 30 ticks before attack decisions every 10 ticks; the random draws performed inside an earlier bot's attack decision affect later bots.

---

## 5. Command ordering

### 5.1 Current local model

- `enqueueAttack` validates available supply minus queued front commands and appends to `pendingCommands`.
- `enqueueArtillery` validates the raw aim point (no snapping), ready batteries, range, supply, and pending barrage, then appends an artillery command. Impact resolution skips State structures entirely.
- `step()` increments the tick, accrues supply from territory and structures for this tick, drains pending commands, and sorts by `(sequence, playerId)`.
- Sequence numbers are assigned monotonically by the local simulation instance.
- Applying a front command spends launch supply; applying an artillery command spawns shells and starts per-battery cooldowns. Build and upgrade commands share the same queue.
- A command that fails validation when applied is dropped. This can happen if the world changed between click and tick; the immediate UI validation is advisory, not authoritative.

### 5.2 Online requirement

For multiplayer, the server must define and enforce ordering independently of arrival time. The target rule is:

```text
sort key = (authoritativeTick, playerId, clientSequence)
```

The server validates and applies commands at a specific tick. Clients receive the accepted sequence/tick. Arrival order must never affect outcome.

### 5.3 Implication

Do not make gameplay decisions in Svelte handlers or pointer callbacks. Input handlers may validate for UX, but all state changes happen inside `step()`.

---

## 6. Deterministic attack processing

Attacks have monotonically increasing ids. Each `step()` iterates active attacks in creation-id order.

For each attack:

- sample up to 10 candidates from its growth layer in deterministic priority order,
- skip candidates that are no longer owned by the expected target owner (without spending attack points),
- skip candidates that no longer share a land edge with the attacker's territory,
- compare integer effective costs and take the cheapest sampled candidate; ties keep sample order,
- requeue every unchosen sampled candidate in reverse sample order,
- pay `max(1, derived defense − piercing)` from both per-tick power and durable strength for each valid capture,
- requeue all sampled candidates and pause the front if the cheapest candidate exceeds power or remaining strength,
- claim valid cells with a deterministic `claim()` operation,
- push still-target-owned neighbours onto the growth layer in the fixed order west, east, north, south,
- on mutual contact, apply `100 + 50 × opponent logTier` strength damage to each side once per pair per tick,
- stop when power is spent, strength reaches zero, or the frontier is empty,
- increment `idleTicks` on a captureless non-clash tick; a clash resets it; the front dies after 20 idle ticks,
- remove a front when its strength reaches zero or idle expiry triggers.

Attack seeds are derived deterministically:

- search the 34-cell square around the click, filtered to land, same owner as clicked target, and adjacent to attacker;
- compute squared integer distance;
- sort by `(distance, index)`;
- cap at 96;
- set the growth anchor to the rounded centroid of the surviving seed cells. The click is not used as the growth origin.

Mutual front contact is deterministic: each capture records `claimedBy[index] = attack.id`; before a capture, neighbouring claims are checked against active mutual attacks. On contact both fronts lose `100 + 50 × opponent logTier` durable strength, once per pair per tick. At 0 strength the front dies; otherwise it pauses for the tick. The candidate is not captured during a clash.

Territory integrity runs after attacks every 10 ticks, or immediately after a cancellation subject to a 10-tick cooldown. Component labels are built in row-major seed order. A component is protected when it contains a live State structure owned by the same player (first structure in registry order marks it; duplicates have no further effect). Unprotected components touching a foreign protected component are annexed to the owner with the largest shared border, lower id on a tie. Components are applied in component order and cells in BFS order. Annexation uses `claim(..., 0)`, clearing attack provenance.

Neutral-pocket cleanup runs when `tick % 100 === 0`, after annexation. It labels every neutral land component in row-major seed order with BFS cell order, skips components above 96 cells, counts direct owner borders, and fills eligible components into the largest-border owner (lowest id tie-break) in BFS cell order. Ocean adjacency does not block cleanup; zero-owner contact does. Fills use `claim(..., 0)` as well.

Structure effects are derived from the live registry. Defense auras are stamped into a `Uint16Array` only on cells owned by the aura's structure owner. A buildable defense aura fills **every cell in its own district**, ignoring the effect radius entirely; State auras use their fixed 16 px radius because State has no district. Max-stacking State auras are applied first, then additive Fortification auras. Effect magnitudes multiply by `structure.stacks`. Rebuilding after destruction clears and restamps the whole overlay, so overlap results do not depend on history. Capturing a structure cell destroys that registry entry inside `claim` and rebuilds districts and auras before later attacks see defense. Capturing an ordinary cell calls `updateDistrictAt` and `updateAuraAt` for that cell. Income/cap are read from the derived stack cache each tick; the cache refreshes from `StructureRegistry.version`, so capture/destruction changes accrual immediately without scanning every structure. Jammer stacks are read from the same cache for attack stats.

Districts are derived deterministically by a bounded Voronoi pass over each owner's cells. For every buildable structure-range bounding box (expanded by `DISTRICT_NOISE_MARGIN`), each owned cell chooses the nearest eligible owner structure after an integer noise offset; ties use type code and structure id. The offset is computed from `hash32` on 8 px value-noise corners plus per-pixel jitter, with no RNG draws. Multiple structures of the same type are allowed, so each cell also records the winning structure id; stacking targets that district's structure and does not alter geometry. State capitals have no district and keep their radius aura.

This is deterministic and part of the authoritative state. Effect definitions are versioned by structure type and protocol, not serialized as mutable per-cell state.

Human card economy has no RNG: the hand always contains all six buildable types with fixed ids. Build and upgrade commands share the command sequence order with attacks. A build revalidates card membership, supply, ownership, emptiness, land, district placement, and stack eligibility at execution. A card landing in a matching district pays `base card cost + 15 × current level`; a new structure pays base cost. A click upgrade resolves the district's structure and spends `base card cost + 15 × projected current level` without consuming a card; queued upgrade costs are reserved using their projected levels. The card is never removed. Supply accrues continuously: each tick adds `income × 10` to the integer remainder; whole 100-point chunks become supply, clamped to cap.

Supply is the only resource. Income is `3 + floor(territory/3000) + income structures` per second (+1/s per 3,000 owned pixels) with no income cap; cap is `120 + territory/1000 + 80 × War Academy stacks` with no global maximum. Gains clamp and losing a War Academy clamps current supply. Front launches spend `30 + 40 × effective Barracks levels`; cancellation refunds `floor(cost × remaining/initial strength)`.

Each attack has a growth-layer-specific frontier. There is **no separate visited set**: once a cell is captured its owner changes, so later duplicate candidates fail the ownership check. Duplicates are a deterministic product of the fixed W/E/N/S push order and the layer's deterministic selection, and are harmless to outcomes.

- **Circular:** a binary min-heap of packed `(distanceSq, index)` keys. The heap order is deterministic; no randomness.
- **Smooth:** integer squared-distance bands. The nearest non-empty band is served first; within it, selection uses integer neighbour counts, squared distance, and index as tie-breakers. Bands are enumerated in ascending numeric order for checksums.
- **Organic:** uniform random removal from an array using the attack's own seeded `DeterministicRng`. Its state and remaining entries are part of the checksum.

### Caution

Do not iterate a `Set` or `Map` whose insertion history depends on network arrival order, object identity, or UI timing. The current frontier sets are safe because all mutations are deterministic claims. Future state must maintain this property.

---

## 7. Ownership and frontiers

- Owners are authoritative.
- Frontier sets are derived caches. They must not be serialized as authoritative state or trusted from clients.
- `claim()` updates sets in a fixed sequence: old cell removal, new cell refresh, west/east/north/south neighbour refresh.
- A full rebuild is used at spawn and can be used for debugging/resync.
- The tests compare incrementally maintained sets with a brute-force scan after combat.

Border set membership has no outcome effect by itself, but bot target selection consumes it. If frontier maintenance is wrong, bot behavior diverges even if owners match.

---

## 8. Checksums

`checksum()` uses FNV-1a over:

1. tick,
2. RNG state,
3. next attack id,
4. ended flag and winner,
5. current and pending growth mode, annexation request/cooldown state,
6. every owner cell and per-cell attack-claim provenance,
7. each player's id, alive flag, and territory,
8. live structure ids, type, owner, cell index, and stack count,
9. human and bot supply plus their accrual remainders, the capped per-defender grievance matrix, and bot threat/posture/reserve/stall/grievance-mark state;
10. each active front's id, attacker, defender, target/anchor, growth mode, creation tick, strength/initial strength, power, pierce, idle ticks, effective levels, logTier, capture count, and growth-layer frontier state;
11. each structure's artillery cooldown (`readyAtTick`) and each in-flight shell's id, owner, source, impact point, launch tick, and arrival tick.

It excludes frontier sets because they are derived. It excludes renderer/UI/camera state.

The hash is returned as an unsigned 32-bit number. For wire messages, encode as a stable hexadecimal string.

This is a debugging and lockstep-check tool, not a cryptographic hash. It is not suitable as an anti-cheat proof by itself because clients can lie; the server remains authoritative.

### Using it

- Unit tests: compare identical command logs.
- Replay: store seed, map version, commands, final checksum.
- Online: server can include a checksum every N ticks; clients compare and resync on divergence.
- Performance: ~18 ms for the full owner + claim-provenance arrays on the dev machine, so do not compute every tick in normal play.

---

## 9. Replay format (target)

A canonical replay should contain:

```json
{
	"format": 1,
	"appVersion": "0.1.0",
	"mapVersion": 1,
	"seed": 1234,
	"tickRate": 10,
	"growthMode": "circular",
	"commands": [{ "tick": 12, "playerId": 1, "sequence": 1, "type": "attack", "x": 100, "y": 200 }],
	"finalTick": 3000,
	"checksum": "8b3f21d0"
}
```

Not yet implemented: replay import/export UI, command log persistence, and a replay viewer. The simulation already supports deterministic re-execution if commands are applied at known ticks.

---

## 10. Map generation determinism

Map generation uses:

- integer hash functions,
- IEEE double arithmetic for normalisation/interpolation,
- no `Math.random`, `Date`, or locale-dependent operations.

It is deterministic on conforming JS engines for a fixed build. Because floating-point edge cases and generator changes are possible, the map is explicitly versioned:

- Any change to `generateMap`, hashing, octaves, threshold logic, start selection, or start painting must bump `MAP_VERSION`.
- The server and all clients must agree on both seed and version.
- Long-term, pre-baking maps into versioned assets with content hashes is an option (see [SPEC.md](SPEC.md) open questions).

### Start selection and paint

- 51 starts are selected by deterministic farthest-point sampling from a seeded candidate pool.
- A preferred 34-cell spacing keeps initial beachheads from overlapping.
- Start boundaries use an integer hash of `(x, y, seed ^ playerOffset)` and integer squared distance.
- The start count, candidate count, spacing, selection order, land threshold, shade, and elevation-tier quantiles are part of map version 4.

These do not add non-determinism to gameplay; they shape the initial territory. Changing any of them requires a `MAP_VERSION` bump.

---

## 11. Testing determinism

`src/lib/game/simulation.test.ts` covers:

1. Map generation is repeatable and lands near the target fraction.
2. Each `PLAYER_COUNT` (51) start is unique and on land across multiple seeds.
3. Every state spawns with nonzero territory and claimed land matches territory totals.
4. Identical seeds + commands produce identical checksums and player snapshots after 120 ticks.
5. Different commands diverge.
6. No ocean cell receives an owner after combat; ownership counts remain valid.
7. Frontier sets match a brute-force scan after combat under 51-bot load.
8. Free attacks resolve without any troop economy, and a sustained 80-tick multi-front run produces no buffer overflow or invalid ownership.
9. A fabricated attack frontier candidate that is not edge-connected to the attacker is neither captured nor kept as an active front.
10. A front whose strength reaches zero or whose idle counter exceeds 20 is removed.
11. Circular, smooth, and organic simulations are each deterministic across two identical runs.
12. A growth-mode switch applies at the next tick and is reflected in snapshots.
13. Growth-layer tests verify circular priority ordering, smooth radial-band priority/concavity filling, and organic seed reproducibility.
14. A deep click produces an attack anchor at the border contact, not at the click.
15. Mutual attacks trade strength on contact: each side loses `100 + 50 × opponent logTier` once per pair per tick; zero strength kills a front.
16. Detached territory is annexed only to a foreign protected mainland with the largest shared border; islands with no claimant are left. Small neutral pockets (≤96 cells) are filled into their dominant owner every 100 ticks.
17. Territory-integrity unit tests cover structure-anchored protection, unprotected larger components, no-claim islands, deterministic tie-breaks, small neutral/coastal pocket filling, ownerless-pocket skips, and the area threshold.
18. Each state has one State structure at its start; capturing that cell removes it from the registry and snapshot.
19. Every land pixel has an elevation tier 0–5 and base defense `1 + elevation`; occupied pixels add one.
20. An attack against a 20-pixel lowland owned border captures 15 pixels per tick; the same front against peaks captures 4.
21. A live State structure adds 20 defense within 16 px on land it owns (including its own cell); destroying it removes the aura. Defensive auras never buff neutral or enemy land.
22. The hand is a fixed six-card catalog; purchase keeps the card, and no card RNG exists. Repeat builds are valid whenever supply and placement rules allow.
23. Build commands spend supply only when applied; invalid or stale drops do nothing.
24. Supply is spent on cards, upgrades, and launches; repeated clicks create separate fronts.
25. Supply cap has no global maximum; it is derived from territory and live War Academy stacks, and a cap reduction clamps current supply. Effective attack levels are Barracks stacks minus defender Jammer stacks; strength/cost scale linearly and power/pierce by integer log2 tier.
26. District assignment is a deterministic bounded Voronoi pass over current owners; ties use type code then structure id, and stacking never changes geometry.
27. Dropping a type inside a same-type district increments that district's structure stacks; dropping it outside all districts creates another structure/district. A different type inside any district is rejected.
28. Least-resistance sampling uses a fixed 10 candidates in growth priority order, integer effective costs, and sample-order ties. It must not use randomness or mutate defense.

Commands to run:

```sh
pnpm test
pnpm bench
```

For a new determinism-sensitive feature, add at minimum:

- a two-simulation identical-sequence test;
- a test that the feature's derived caches match a brute-force expectation;
- a divergence test if the feature introduces randomness or ordering.

---

## 12. Contributor rules

### Must

- Keep authoritative state mutations inside `step()`.
- Use integer math for any value that affects outcomes.
- Draw from the simulation PRNG, in explicit order.
- Define stable ordering for collections that affect behavior.
- Update `checksum()` if you add authoritative state that can affect the future.
- Add tests for same-seed replay.
- Bump protocol/map versions when appropriate.
- Update this document and [SPEC.md](SPEC.md).

### Must not

- Use `Math.random()`, `Date.now()`, `performance.now()`, `crypto.randomUUID()`, or browser APIs in the simulation.
- Use frame delta or render state in a gameplay decision.
- Depend on object property order, network arrival order, or asynchronous callback order.
- Trust client-provided owner/territory values (or resource values when an economy returns).
- Treat the experimental free-attack model as final design; see [EXPERIMENTS.md](EXPERIMENTS.md).
- Change PRNG draw order as a "refactor".
- Run a checksum every tick without a performance update.
- Change a growth layer's ordering rules without a protocol bump and mode-specific replay tests.
- Let directional fairness pick a far tangent frontier cell while a nearer radial candidate exists.
- Add randomness to growth without a per-attack deterministic seed.

---

## 13. Known risks and mitigations

| Risk                                          | Mitigation                                                            |
| --------------------------------------------- | --------------------------------------------------------------------- |
| Map generation drifts across versions         | `MAP_VERSION`, versioned seed identity, future baked map assets       |
| JS engine float differences in map gen        | Versioned content; optional content-hash verification; pre-baked maps |
| Bot behavior changes with PRNG refactor       | Draw-order review + replay tests                                      |
| Network command order differs                 | Server-defined tick/player/sequence ordering                          |
| Frontier cache diverges                       | Brute-force invariant test, rebuild path                              |
| Checksum too expensive per tick               | On-demand/every-N-ticks, benchmarked                                  |
| Client prediction diverges                    | Server authority, checksum compare, baseline resync                   |
| Change buffer overflow changes rendering only | Explicit overflow flag + full texture resync; never blocks simulation |
