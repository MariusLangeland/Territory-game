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

| Quantity                   | Representation                         |
| -------------------------- | -------------------------------------- |
| Territory count            | JS number, integer                     |
| Owner id                   | uint16 (`1..108` in the stress build)  |
| Tick                       | integer                                |
| PRNG state                 | uint32                                 |
| Growth layer               | one of `circular`, `smooth`, `organic` |
| Frontier candidate storage | layer-specific deterministic structure |
| Attack claim provenance    | attack id (uint32) per cell            |
| Structure identity         | integer id, type enum, owner, map cell |
| Attack seed distance       | squared integer distance               |
| Attack budget              | 30 points per front per tick           |
| Defense                    | `1 + elevation + occupied + aura`      |
| State aura                 | 12 px radius, +20, max once, friendly  |
| Elevation tier             | uint8, 0–5                             |

No floating-point resources, morale, speed, or distance influences outcomes. The only floats in the whole map pipeline are inside map generation, which is versioned and completed before any match commands are applied.

In this experiment there are no troop or production-cap values. Gold, card draws, attack orders, and attack-order caps are integer authoritative state; attacks spend 30 integer points per tick.

Pixel positions are integer; clicks are floored to cell coordinates before commands are queued.

---

## 4. Seed and PRNG

### 4.1 Map seed

- A 32-bit seed generates the entire world.
- The map UI accepts 1–8 hex characters; URLs store the decimal equivalent.
- `MAP_VERSION` is part of the map identity. Seed alone is insufficient across generator versions.

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

The stress-build bot policy always chooses neutral when available, so removing that rule changes PRNG draw counts and results.

Changing the number or order of these draws changes all subsequent bot behavior. A refactor that "just moves a random call" is a simulation change.

Bots are processed in ascending player id order, every 10 ticks. The random draws performed inside an earlier bot's decision affect later bots.

---

## 5. Command ordering

### 5.1 Current local model

- `enqueueAttack` validates against current orders minus queued attack commands and appends to `pendingCommands`.
- `step()` increments the tick, grants +1 order to each living player on 100-tick boundaries, applies Command Post pulses on 600-tick boundaries, pays income, drains pending commands, and sorts by `(sequence, playerId)`.
- Sequence numbers are assigned monotonically by the local simulation instance.
- Applying an attack command spends one order. Build/refresh commands are then applied before bot decisions and attack processing.
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

- ask its growth layer for the next candidate,
- skip candidates that are no longer owned by the expected target owner (without spending attack points),
- pay `1 + elevation + occupied bonus` attack points for each valid capture,
- requeue the next candidate and stop the tick if the remaining budget cannot afford it,
- skip candidates that no longer share a land edge with the attacker's territory,
- claim valid cells with a deterministic `claim()` operation,
- push still-target-owned neighbours onto the growth layer in the fixed order west, east, north, south,
- expire the front when `tick - createdAtTick >= ATTACK_LIFETIME_TICKS` (50 ticks / 5 seconds),
- stop when the budget reaches zero or the frontier is empty,
- drop the front if a tick captures zero cells.

Attack seeds are derived deterministically:

- search the 34-cell square around the click, filtered to land, same owner as clicked target, and adjacent to attacker;
- compute squared integer distance;
- sort by `(distance, index)`;
- cap at 96;
- set the growth anchor to the rounded centroid of the surviving seed cells. The click is not used as the growth origin.

Mutual front contact is deterministic: each capture records `claimedBy[index] = attack.id`; before a capture, neighbouring claims are checked against active mutual attacks. On contact all orders between the pair are marked done. The candidate is left uncaptured, so the border is the ownership state at contact.

Territory integrity runs after attacks every 10 ticks, or immediately after a cancellation subject to a 10-tick cooldown. Component labels are built in row-major seed order. A component is protected when it contains a live State structure owned by the same player (first structure in registry order marks it; duplicates have no further effect). Unprotected components touching a foreign protected component are annexed to the owner with the largest shared border, lower id on a tie. Components are applied in component order and cells in BFS order. Annexation uses `claim(..., 0)`, clearing attack provenance.

Structure effects are derived from the live registry. Defense auras are stamped into a `Uint16Array` only on cells owned by the aura's structure owner: max-stacking State auras first, then additive Defense Post auras. Rebuilding after destruction clears and restamps the whole overlay, so overlap results do not depend on history. Capturing a structure cell destroys that registry entry inside `claim` and rebuilds auras before later attacks see defense. Capturing an ordinary cell calls `updateAuraAt` for that cell, dropping the old owner's aura and applying the new owner's aura deterministically. Income, order gain, and order cap effects are read directly from live structures on their timer/cap calculation, so capture removes them immediately.

This is deterministic and part of the authoritative state. Effect definitions are versioned by structure type and protocol, not serialized as mutable per-cell state.

Human card economy uses a dedicated `cardRng` seeded from the world seed. Starting hand and every refresh draw three independent uniform choices from the five buildable types, with replacement. Build and refresh commands share the command sequence order with attacks. A build revalidates card, gold, ownership, emptiness, and land at execution; refresh revalidates gold. Income is paid at tick boundaries from live Mine count.

Attack orders are per-player integer charges. They are initialized to base caps (3 human / 2 bots). Every 100 ticks each living player gains 1 order, clamped to the cap; this is not a full refill. Command Posts add their grant on every 600-tick boundary, also clamped. War Academies add to the live cap, and losing one clamps that owner's current orders to the new cap. Attack order arrays and both timer values are checksummed.

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
8. live structure ids, type, owner, and cell index,
9. human gold, income tick, card RNG state, hand card ids/types, every player's attack orders, and order grant/bonus timers;
10. each active attack's id, attacker, defender, target/anchor, growth mode, creation tick, capture count, and growth-layer frontier state.

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

- 108 starts are selected by deterministic farthest-point sampling from a seeded candidate pool.
- A preferred 34-cell spacing keeps initial beachheads from overlapping.
- Start boundaries use an integer hash of `(x, y, seed ^ playerOffset)` and integer squared distance.
- The start count, candidate count, spacing, selection order, land threshold, shade, and elevation-tier quantiles are part of map version 3.

These do not add non-determinism to gameplay; they shape the initial territory. Changing any of them requires a `MAP_VERSION` bump.

---

## 11. Testing determinism

`src/lib/game/simulation.test.ts` covers:

1. Map generation is repeatable and lands near the target fraction.
2. Each `PLAYER_COUNT` (108) start is unique and on land across multiple seeds.
3. Every state spawns with nonzero territory and claimed land matches territory totals.
4. Identical seeds + commands produce identical checksums and player snapshots after 120 ticks.
5. Different commands diverge.
6. No ocean cell receives an owner after combat; ownership counts remain valid.
7. Frontier sets match a brute-force scan after combat under 108-bot load.
8. Free attacks resolve without any troop economy, and a sustained 80-tick multi-front run produces no buffer overflow or invalid ownership.
9. A fabricated attack frontier candidate that is not edge-connected to the attacker is neither captured nor kept as an active front.
10. An attack whose creation tick is at or beyond its 50-tick lifetime is removed before it can capture.
11. Circular, smooth, and organic simulations are each deterministic across two identical runs.
12. A growth-mode switch applies at the next tick and is reflected in snapshots.
13. Growth-layer tests verify circular priority ordering, smooth radial-band priority/concavity filling, and organic seed reproducibility.
14. A deep click produces an attack anchor at the border contact, not at the click.
15. Mutual attacks cancel when a front touches opposing claim provenance; the candidate is not captured and all pair orders disappear.
16. Detached territory is annexed only to a foreign protected mainland with the largest shared border; islands with no claimant are left.
17. Territory-integrity unit tests cover structure-anchored protection, unprotected larger components, no-claim islands, and deterministic tie-breaks.
18. Each state has one State structure at its start; capturing that cell removes it from the registry and snapshot.
19. Every land pixel has an elevation tier 0–5 and base defense `1 + elevation`; occupied pixels add one.
20. An attack against a 20-pixel lowland owned border captures 15 pixels per tick; the same front against peaks captures 4.
21. A live State structure adds 20 defense within 12 px on land it owns (including its own cell); destroying it removes the aura. Defensive auras never buff neutral or enemy land.
22. Starting hand and every refresh are deterministic from a dedicated card RNG and use independent pool draws with replacement.
23. Build commands spend gold/remove cards only when applied; invalid or stale drops do nothing.
24. Attack orders are spent only when an attack command or bot decision creates a front; the +1 grant and Command Post pulses are fixed tick-boundary events clamped to cap.
25. War Academy cap changes are derived from live structures; a cap reduction clamps current orders, and Command Post grants apply in registry order on the 60-second boundary.

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
