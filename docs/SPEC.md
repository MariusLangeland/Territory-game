# Territory Specification

Territory is a deterministic, WebGPU-rendered pixel territory war. One human
commander competes with AI states in a single seeded match, or plays in a
Spacetime-backed multiplayer room.

## Match

- 8–51 states, default 51.
- Map presets plus custom atlas dimensions up to 8192 px per side.
- Optional 0/10/20/30 minute timer.
- Three bot difficulties: relaxed, standard, ruthless.
- Locked organic growth.
- Victory at 70% of land, or the largest living state when the timer expires.
- Fixed 10 Hz deterministic simulation.

## Supply

- One resource: supply.
- Starting supply and all costs are defined in `constants.ts` and generated
  [REFERENCE.md](REFERENCE.md).
- Income: base income, territory, Command Posts, and eliminations.
- Cap: base cap, territory, and War Academy stacks. No global maximum.
- Seven permanent build cards. Cards are never consumed.
- Build costs, upgrade costs, and structure effects are defined by structure
  definitions and `docs/REFERENCE.md`.

## Territory

- Ownership is one owner id per pixel.
- Every owned component must connect to a State structure or a valid Port chain.
- Unreachable components become neutral; reachable detached components are
  annexed by the protected owner with the largest shared border.
- Neutral pockets of at most 96 cells are cleaned into the dominant bordering
  owner every 100 ticks.
- State structures are authoritative objects and are destroyed when captured.

## Fronts

- A click near a shared border launches a durable front.
- Launch cost and strength scale with effective Barracks levels.
- Effective levels are `max(0, attacker Barracks − defender Jammer)`.
- Each capture pays defense minus piercing.
- Mutual fronts damage each other once per pair per tick.
- A front with no capture for 20 ticks dies.
- Cancellation refunds proportionally to remaining strength.
- Repeated clicks create separate fronts.

## Structures and districts

- Buildable structures claim bounded owner-local districts.
- A structure's district is its aura area.
- Same-type drops inside a district stack; different types are rejected except
  Ports.
- Structures need minimum spacing; Shift-build may use a tight-spacing search.
- Captured buildables are razed.
- Artillery is an active siege structure with inaccurate deterministic shells
  and State immunity.
- Ports are shore anchors and enable deterministic naval landings.

## Diplomacy

- Player-only one-pair alliances.
- Bot acceptance, expiry, non-aggression, coordination, and betrayal cooldown.
- Bots never propose alliances to each other.

## Multiplayer

- One Spacetime database per room.
- Landing page reads the `territory-lobby` directory.
- Room lobby: join seats, ready up, host starts.
- Tick-0 broadcast locks participation and starts local simulations.
- Player input is validated against the local simulation before submission; invalid commands never reach the room ledger.
- Valid input is submitted as a compact intent row; the server assigns the tick.
- Clients apply accepted intents to their local simulation.
- 10 Hz is the normal gameplay target, not a stepping constraint: when an
  accepted row arrives at server tick `T`, the client immediately catches up to
  `T - 1`, then applies the intent on the next tick.
- Late join is rejected after start.
- Losing room authority pauses the local simulation.

## Rendering

- WebGPU full-screen territory shader.
- Dirty 32×32 tile uploads for normal updates.
- Heavy resyncs are chunked across frames.
- No fallback renderer.

## Determinism

- Seeded integer PRNG.
- Stable ordering for commands, attacks, RNG draws, and ownership scans.
- Checksums cover authoritative state and pending attack state.
- Simulation time is tick count, never wall-clock time.
