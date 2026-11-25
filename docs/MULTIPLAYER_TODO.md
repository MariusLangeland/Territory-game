# Multiplayer Lockstep — TODO

Branch: `Multiplayer`

Schema: [MULTIPLAYER_SCHEMA.md](MULTIPLAYER_SCHEMA.md)
Schema validation: [MULTIPLAYER_SCHEMA_VALIDATION.md](MULTIPLAYER_SCHEMA_VALIDATION.md)

## Decisions already locked

- **One Spacetime database per room.**
- **No periodic tick sealing.** The server appends gameplay transaction rows only
  when transactions exist. It does not write a row every 100 ms; an idle room
  emits an empty liveness row only after 10 ticks without activity.
- Server assigns a tick from server time:
  `tick = floor((ctx.timestamp - startedAt) / 100ms)`.
- If the server sees no transaction for **10 ticks**, it appends an empty
  `heartbeat` transaction so connected clients can distinguish an idle room from
  a stale/disconnected link.
- Clients maintain a **safe time delta behind the estimated server clock**.
- Transaction order is canonical: `tick ASC, rowIndex ASC`.
- Same-tick conflicts are resolved by Spacetime transaction serialization and
  row order.
- Clients run their own deterministic simulation.
- Clients optimistically apply rows and flag illegal/divergent rows.
- A quorum appends an invalidation; clients roll back and replay.
- A privileged **arbiter decision is final** for disputes.
- **MVP scope is public rooms.**
- Anti-cheat is not ignored, but is secondary to functionality; the arbiter and
  quorum are the correction mechanisms.

## Chosen architecture

```text
Spacetime per-room database:
  identity/auth, room, seats, transaction rows,
  flags, disputes, invalidations, arbitrations, keyframes,
  subscriptions/event notifications

clients:
  local TerritorySimulation, transaction submission, optimistic apply,
  safe server-clock lag, validation, flags, rollback/replay, rendering
```

No blocks. No hash chain. No periodic seals. No server-side simulation.

Normal flow:

```text
client submits transaction
  -> Spacetime appends ordered row with server tick
  -> clients apply rows optimistically
  -> illegal/divergent rows are flagged
  -> quorum invalidates or arbiter makes final decision
  -> clients restore keyframe and replay canonical rows
```

## Phase 0 — Contracts and decisions

- [ ] Lock public-room trust model:
  - [ ] server orders rows but does not validate game legality;
  - [ ] clients and arbiter are the correctness mechanisms;
  - [ ] document the remaining collusion/cheat surface.
- [ ] Define server tick and head:
  - [ ] store `startedAt` once;
  - [ ] transaction tick is server-assigned from `ctx.timestamp`;
  - [ ] `rooms.headTick` updates only when a transaction is appended;
  - [ ] clients do not use their own wall clock as the authoritative tick.
- [ ] Define client server-clock estimation:
  - [ ] estimate server time from room start and Spacetime timestamps;
  - [ ] maintain a server-clock offset;
  - [ ] define behavior when the estimate is unavailable or jumps.
- [ ] Define idle heartbeats:
  - [ ] server tracks the last transaction tick;
  - [ ] after 10 ticks without a transaction, append an empty `heartbeat` row;
  - [ ] heartbeat rows are liveness only: no gameplay effect, no state-root
        change, no flag/quorum eligibility;
  - [ ] clients reset their staleness timer on any transaction, including a
        heartbeat;
  - [ ] client marks the link stale after two missed heartbeat windows (20 ticks);
  - [ ] heartbeat cadence is one second at 10 Hz, not a tick seal.
- [ ] Define the client frontier:
  - [ ] `serverHeadTick = floor((estimatedServerNow - startedAt) / 100ms)`;
  - [ ] `targetTick = serverHeadTick - safeDeltaTicks`;
  - [ ] `confirmedTick` = last locally applied tick;
  - [ ] never simulate beyond `targetTick`;
  - [ ] choose initial `safeDeltaTicks` (start with 2–3 ticks);
  - [ ] safe delta covers network, server processing, batching, and clock error.
- [ ] No periodic tick seal:
  - [ ] do not add `room_ticks` or a 10 Hz heartbeat table;
  - [ ] transactions themselves carry the authoritative tick;
  - [ ] clients may simulate idle ticks without rows.
- [ ] Define late-row behavior:
  - [ ] if a row arrives for `tick <= confirmedTick`, pause;
  - [ ] either resync from keyframe or roll back to the row’s tick;
  - [ ] never silently apply a late row to already-simulated state.
- [ ] Define transaction identity:
  - [ ] explicit `rowIndex`/sequence;
  - [ ] tick, seat/player, type, data, client sequence.
- [ ] Define state roots:
  - [ ] checksum after each applied tick;
  - [ ] flags carry expected/observed roots;
  - [ ] no periodic server-submitted tick checks in MVP.
- [ ] Define flag/quorum policy:
  - [ ] active, connected, in-sync human seats only;
  - [ ] exclude bots/spectators/disconnected/stale clients;
  - [ ] threshold: majority of active in-sync humans;
  - [ ] single-human/no-quorum fallback goes to arbiter.
- [ ] Arbiter policy:
  - [ ] privileged identity/role per room;
  - [ ] decision is final for the disputed row;
  - [ ] append-only decision, never rewrite history;
  - [ ] offline arbiter behavior;
  - [ ] whether arbiter runs continuously or only replays disputes.
- [ ] Canonical replay:
  - [ ] order by tick then `rowIndex`;
  - [ ] skip invalidated rows;
  - [ ] revalidate dependent later rows;
  - [ ] recompute tick state roots.
- [ ] Define version handshake:
  - [ ] module schema;
  - [ ] client SDK/bindings;
  - [ ] simulation rules;
  - [ ] map version;
  - [ ] bot policy/genome;
  - [ ] app/build fingerprint.
- [ ] Decide bots remain implicit deterministic participants.
- [ ] Define join/reconnect baseline:
  - [ ] latest keyframe + subsequent rows;
  - [ ] replay from genesis fallback.
- [ ] Define room database provisioning/discovery:
  - [ ] one database per room;
  - [ ] how room codes map to database names;
  - [ ] how databases are created/retired;
  - [ ] how clients discover a room.
- [ ] Define input behavior:
  - [ ] commands submitted to Spacetime at current server time;
  - [ ] no server validation round trip;
  - [ ] clients accept delayed feedback or add prediction later.

## Phase 1 — Spacetime coordinator

### Module and database lifecycle

- [ ] Add Spacetime project/module scaffolding when approved.
- [ ] Pin CLI/module/client versions.
- [ ] Define one-database-per-room naming/provisioning.
- [ ] Define room discovery/listing mechanism.
- [ ] Add local `spacetime start` development flow.
- [ ] Add publish/migrate/retire workflow.
- [ ] Add CI for module build and generated bindings.

### Schema

- [ ] `rooms`: room identity/config/version/start/headTick/arbiter requirement.
- [ ] `seats`: identity, player id, ready/connected/host.
- [ ] `ledger_transactions`: rowIndex, tick, seat/player, sequence, type, data,
      status.
- [ ] `transaction_flags`: rowIndex/tick/seat/state root/reason.
- [ ] `invalidations`: rowIndex, reason, quorum count, replacement tick.
- [ ] `arbiters`, `disputes`, `arbitrations`.
- [ ] `keyframes`: tick/root/version/RLE bytes/submitter.
- [ ] Event tables: new transaction, invalidation, arbitration.
- [ ] Public views for room/seat/ledger/invalidation/arbitration state.
- [ ] Access rules: only seats submit; only arbiters arbitrate; only host grants.
- [ ] Do **not** add `room_ticks`, tick-seal tables, or a 10 Hz heartbeat. A
      roughly once-per-second liveness reducer may emit an idle heartbeat row.

### Reducers

- [ ] `create_room`/provision database.
- [ ] `join_room`, `leave_room`, `ready`, `start_match`.
- [ ] `submit_transaction`:
  - [ ] authenticate seat;
  - [ ] validate schema/rate/sequence;
  - [ ] compute server tick;
  - [ ] insert ordered row;
  - [ ] update `headTick`;
  - [ ] update `lastTransactionTick`;
  - [ ] emit transaction event.
- [ ] `check_liveness` scheduled reducer (about once per second):
  - [ ] if `currentTick - lastTransactionTick >= 10`, insert an empty
        `heartbeat` row at `currentTick`;
  - [ ] update `lastTransactionTick`;
  - [ ] emit a transaction event.
- [ ] `flag_transaction`.
- [ ] `open_dispute`.
- [ ] `arbitrate_dispute` (final decision).
- [ ] `invalidate_transaction` (quorum or arbiter final).
- [ ] `grant_arbiter`, `revoke_arbiter`.
- [ ] `submit_keyframe`.
- [ ] Reject unauthenticated/non-seat/malformed/duplicate/rate-limited requests.

### Transport

- [ ] Replace custom HTTP/SSE with Spacetime subscriptions/generated bindings.
- [ ] Subscribe to transactions, flags, invalidations, arbitrations.
- [ ] Use event tables for immediate transaction/invalidation notifications.
- [ ] Define catch-up queries for rows after a keyframe.
- [ ] Measure subscription payload/egress.

## Phase 2 — Client simulation and timing

- [ ] Create a Spacetime-backed online session distinct from state replication.
- [ ] Start local simulation from seed/config or keyframe.
- [ ] Estimate server clock and maintain offset.
- [ ] Compute `targetTick = serverHeadTick - safeDeltaTicks`.
- [ ] Apply whole ticks only.
- [ ] Never use variable-dt simulation.
- [ ] Demand-driven loop:
  - [ ] while `confirmedTick < targetTick`, apply next tick;
  - [ ] if no rows for that tick, simulate idle tick deterministically;
  - [ ] if a row for that tick exists, apply rows by `rowIndex`;
  - [ ] skip `heartbeat` rows in simulation/replay/checksums;
  - [ ] otherwise wait/interpolate if at frontier.
- [ ] Link liveness:
  - [ ] record `lastServerActivityTick` on every row, including heartbeats;
  - [ ] show an “idle but connected” state while heartbeats arrive;
  - [ ] mark the link stale after 20 ticks with no row;
  - [ ] do not treat stale as a transaction rejection or rollback trigger.
- [ ] Never simulate beyond `targetTick`.
- [ ] Late row:
  - [ ] detect `tick <= confirmedTick`;
  - [ ] pause/rollback/resync;
  - [ ] never apply late rows silently.
- [ ] Variable client rates:
  - [ ] 8–12 Hz consumption only as whole-tick scheduling;
  - [ ] average must keep up or lag grows;
  - [ ] catch up after stalls/background tabs in whole ticks.
- [ ] Render from local simulation; no owner/pixel delta stream.
- [ ] Maintain recent keyframe for rollback.
- [ ] Input scheduling:
  - [ ] submit transaction;
  - [ ] track pending row/ack;
  - [ ] optional pending-intent UI;
  - [ ] no prediction for MVP unless proven necessary.

## Phase 3 — Flags, quorum, arbiter, rollback

- [ ] Flag payload:
  - [ ] rowIndex/tick;
  - [ ] expected pre-tick state root;
  - [ ] observed post-tick state root;
  - [ ] reason;
  - [ ] seat.
- [ ] Client validation:
  - [ ] local pre-root mismatch → resync, do not flag;
  - [ ] matching pre-root + illegal row → flag;
  - [ ] never crash on bad rows.
- [ ] Server flag handling:
  - [ ] dedupe by seat/row;
  - [ ] ignore stale-state flags;
  - [ ] count active/in-sync humans;
  - [ ] append invalidation on quorum.
- [ ] Dispute/escalation:
  - [ ] repeated/conflicting flags → open dispute;
  - [ ] no quorum/single human → arbiter;
  - [ ] admin can open dispute.
- [ ] Arbiter path:
  - [ ] fetch keyframe before disputed tick;
  - [ ] replay canonical rows;
  - [ ] append final arbitration decision;
  - [ ] optional certified keyframe;
  - [ ] clients apply decision.
- [ ] Canonical replay:
  - [ ] skip invalidated rows;
  - [ ] revalidate dependent rows;
  - [ ] recompute roots.
- [ ] Client rollback to nearest keyframe; verify root; continue.
- [ ] UX: pause on late row, dispute status, reorg notice.

## Phase 4 — Keyframes and versioning

- [ ] Wire keyframe format/version/checksum.
- [ ] Store keyframes in Spacetime.
- [ ] Keyframe source: host/arbiter/trusted client (define).
- [ ] Late join keyframe + rows + checksum.
- [ ] Reconnect/resync.
- [ ] Version compatibility checks.
- [ ] Keyframe budget/retention and tests.

## Phase 5 — UI, spectator, replay

- [ ] Replace online transport with Spacetime subscriptions.
- [ ] Reuse `ReplayViewer` for live/replay/spectator.
- [ ] Room UX: code/seat/ready/start/connection/reorg.
- [ ] Ledger viewer: rows/flags/invalidations/arbitrations.
- [ ] Spectator from transaction rows; no seat permissions.
- [ ] Explanation of optimistic correction.

## Phase 6 — Public-room trust and safety

- [ ] Server structural checks only: auth, schema, sequence, rate, room state.
- [ ] Seat ownership and arbiter privileges.
- [ ] Flag/invalidation/arbitration spam limits.
- [ ] Audit log for arbiter decisions.
- [ ] Document collusion/cheat surface.
- [ ] Keep anti-cheat as a future authoritative-validator option.

## Phase 7 — Testing and benchmarks

- [x] Static schema syntax/type validation without installing Spacetime.
- [ ] Schema validation against real Spacetime module once tooling approved.
- [ ] Module tests: seats, transactions, ordering, flags, arbiter, keyframes.
- [ ] Client tests:
  - [ ] server clock estimation/safe delta;
  - [ ] whole-tick application;
  - [ ] same-tick row order;
  - [ ] late-row pause/rollback;
  - [ ] variable rate/catch-up;
  - [ ] quorum and arbiter decisions;
  - [ ] dependent-row revalidation;
  - [ ] reconnect/keyframe.
- [ ] Network tests: latency, jitter, lost/reordered notifications, background tab.
- [ ] Spacetime capacity: transaction reducer, egress, storage, per-room DB lifecycle.
- [ ] Browser checksum parity.
- [ ] Soak/reconnect storms.
- [ ] Measure cost at public-room targets.

## Phase 7.5 — Local prototype before Spacetime

Build the client/coordinator protocol against an in-process fake before
installing or publishing Spacetime.

- [ ] Fake coordinator:
  - [ ] room start timestamp;
  - [ ] row append with server tick and sequence;
  - [ ] same-tick row ordering;
  - [ ] no periodic seals/heartbeats;
  - [ ] optional artificial latency/jitter.
- [ ] Fake client frontier:
  - [ ] server-clock offset estimation;
  - [ ] `headTick` and safe delta;
  - [ ] whole-tick application;
  - [ ] idle ticks without rows;
  - [ ] late-row detection and pause/rollback.
- [ ] Fake flag/quorum:
  - [ ] invalid row;
  - [ ] quorum invalidation;
  - [ ] keyframe restore/replay;
  - [ ] arbiter final decision.
- [ ] Determinism tests:
  - [ ] same rows → same checksums;
  - [ ] variable client consumption rates → same state at tick N;
  - [ ] delayed/late rows → identical corrected state.
- [ ] Only after these pass, replace the fake coordinator with Spacetime.

## Phase 8 — Rollout

- [ ] Local prototype first: fake coordinator + client frontier/rollback tests.
- [ ] Then Spacetime module + two clients.
- [ ] Ship public rooms behind a flag.
- [ ] Keep existing authoritative state replication as fallback.
- [ ] Add telemetry: row latency, late rows, flags, invalidations, arbitrations,
      catch-up.
- [ ] Reassess cost before scaling.
- [ ] Update architecture/network docs after implementation.

## Acceptance criteria

- [ ] One Spacetime database per room.
- [ ] No periodic tick-seal rows; transactions are the only ledger rows.
- [ ] An idle room emits an empty heartbeat transaction after 10 ticks without
      activity.
- [ ] Heartbeats are skipped by simulation/replay and never affect state roots.
- [ ] Clients distinguish idle-and-connected from stale/disconnected.
- [ ] Same-tick rows apply in `rowIndex` order.
- [ ] Clients maintain a safe server-clock delta and never simulate beyond
      `targetTick`.
- [ ] Clients apply whole ticks; no variable-dt simulation.
- [ ] Late rows cause pause/rollback, never silent divergence.
- [ ] Public-room room lifecycle works through Spacetime.
- [ ] Deliberate invalid rows can be flagged; quorum invalidates.
- [ ] Arbiter decisions are final and applied identically by clients.
- [ ] Rollback from keyframe produces the same canonical state/checksum.
- [ ] Late join/reconnect uses keyframe + rows.
- [ ] Version-mismatched clients are rejected.
- [ ] Cost/latency/egress measured for public-room scale.
- [ ] Cheat/collusion surface documented.

## Open questions

- [ ] How are one-DB-per-room databases provisioned/discovered/retired?
- [ ] How is server clock estimated accurately on clients?
- [ ] What is the initial safe delta in ticks, and how is it adapted?
- [ ] What happens when a row is assigned to a tick older than a client’s
      `confirmedTick` due to network/server delay?
- [ ] Should clients ever submit state-root attestations without periodic seals?
- [ ] Exact flag quorum and single-human fallback.
- [ ] Should flags be event rows, persistent rows, or both?
- [ ] Does an arbiter continuously validate or only replay disputes?
- [ ] How long are rows/keyframes retained?
- [ ] Should stale clients pause simulation or keep simulating locally?
- [ ] Should heartbeat rows count toward `headTick`, or carry only a liveness tick?
- [ ] What is the client-visible timeout: 20 ticks, or adaptive by RTT/jitter?
- [ ] How does public-room anti-cheat evolve later?
