# Multiplayer Lockstep — TODO

Branch: `Multiplayer`

Schema: [MULTIPLAYER_SCHEMA.md](MULTIPLAYER_SCHEMA.md)

## Chosen architecture

Use **Spacetime (SpacetimeDB)** as the room and ledger coordinator.

The server does **not** run the simulation. It timestamps and appends transaction
rows, seals ticks, stores flags/invalidations/keyframes, and broadcasts changes.
Connected clients run their own deterministic simulation.

```text
Spacetime module:
  identity/auth, rooms, seats, timer, transaction rows,
  tick seals, flags, invalidations, keyframes, subscriptions

clients:
  local TerritorySimulation, transaction submission, optimistic apply,
  validation, flags, rollback/replay, rendering
```

Transaction ordering is simple:

```text
row_index order = canonical transaction order
tick            = server-assigned tick bucket
```

Same-tick conflicts are resolved by Spacetime's serialized transactions and the
resulting `row_index` order. There are no block rows and no hash chain.

The server does not judge game legality. Clients optimistically apply the
ordered rows. Illegal or divergent transactions are flagged; a quorum appends an
invalidation, and clients roll back to a keyframe and replay the canonical ledger
excluding invalidated rows.

This prioritizes functionality and RTT over anti-cheat.

## Phase 0 — Contracts and decisions

- [ ] Lock the trust model:
  - [ ] private/co-op is the primary target;
  - [ ] cheating and majority collusion are accepted risks for now;
  - [ ] public/ranked anti-cheat is out of scope for this phase.
- [ ] Define the server tick:
  - [ ] store `startedAt` when the match starts;
  - [ ] server computes `tick = floor((receivedAt - startedAt) / 100ms)`;
  - [ ] clients never derive ticks from their own wall clock;
  - [ ] ticks are authoritative server-assigned buckets.
- [ ] Define tick sealing:
  - [ ] a scheduled 10 Hz reducer closes the open tick and inserts a
        `room_ticks` row/heartbeat;
  - [ ] room tracks an explicit `openTick` and `sealedThrough` watermark;
  - [ ] transactions append only to `openTick`, never to an already sealed tick;
  - [ ] define behavior when the scheduler skips/delays ticks;
  - [ ] clients apply a tick only after its seal.
- [ ] Define the client timing frontier:
  - [ ] `confirmedTick` = last locally applied tick;
  - [ ] `safeHead` = latest tick with a seal and all transaction rows;
  - [ ] render at display rate; consume whole simulation ticks at whatever rate
        data allows;
  - [ ] never use variable-dt simulation;
  - [ ] never simulate beyond `safeHead`;
  - [ ] pause at the frontier unless optional prediction/rollback is enabled.
- [ ] Define transaction identity:
  - [ ] explicit `row_index`/sequence;
  - [ ] room;
  - [ ] tick;
  - [ ] player/seat;
  - [ ] type;
  - [ ] data;
  - [ ] optional client sequence/idempotency key.
- [ ] Define state roots:
  - [ ] checksum after applying each tick;
  - [ ] how clients compare roots;
  - [ ] whether clients periodically submit tick checksums.
- [ ] Define flag/quorum policy:
  - [ ] active, connected, in-sync human seats only;
  - [ ] exclude bots/spectators/disconnected/stale clients;
  - [ ] threshold (majority of active in-sync humans);
  - [ ] single-human fallback.
- [ ] Define canonical replay:
  - [ ] order rows by `row_index`;
  - [ ] group by tick;
  - [ ] skip invalidated rows;
  - [ ] revalidate dependent later rows.
- [ ] Decide finality behavior:
  - [ ] optimistic apply with later invalidation/rollback;
  - [ ] or short provisional/challenge window.
  - Optimistic finality is preferred for responsiveness.
- [ ] Decide where matches live:
  - [ ] one Spacetime database per room;
  - [ ] or shared database with room-keyed tables.
- [ ] Define version handshake:
  - [ ] Spacetime module version;
  - [ ] client SDK/generated bindings;
  - [ ] ledger schema;
  - [ ] simulation rules;
  - [ ] map generation;
  - [ ] bot policy/genome;
  - [ ] app/build fingerprint.
- [ ] Decide bots:
  - [ ] implicit deterministic participants from seed/config;
  - [ ] or explicit ledger transactions.
- [ ] Define late-join/reconnect baseline:
  - [ ] latest keyframe + subsequent transaction rows;
  - [ ] replay from genesis fallback.
- [ ] Define input delay:
  - [ ] client ticks wait for sealed ticks;
  - [ ] no per-request validation round trip;
  - [ ] buffer enough to survive normal jitter.

## Phase 1 — Spacetime coordinator

### Module setup

- [ ] Add Spacetime project/module scaffolding.
- [ ] Pin CLI, module, and client SDK versions.
- [ ] Add local `spacetime start` development flow.
- [ ] Document publish/migrate workflow for Maincloud/self-host.
- [ ] Add CI for module build, publish dry run, and binding generation.

### Schema

- [ ] `rooms`:
  - [ ] room id/code;
  - [ ] status (`waiting`, `running`, `completed`);
  - [ ] config/seed/map/bot identity;
  - [ ] startedAt/end tick;
  - [ ] version fingerprint.
- [ ] `seats`:
  - [ ] room;
  - [ ] Spacetime `Identity`;
  - [ ] player id;
  - [ ] ready/connected status;
  - [ ] host flag.
- [ ] `ledger_transactions`:
  - [ ] `rowIndex`/sequence, primary key;
  - [ ] room;
  - [ ] tick;
  - [ ] player/seat;
  - [ ] transaction type;
  - [ ] transaction data;
  - [ ] optional client sequence/idempotency key;
  - [ ] status (`provisional`, `final`, `invalidated`).
- [ ] `room_ticks`:
  - [ ] room;
  - [ ] tick;
  - [ ] sealedAt;
  - [ ] optional aggregate/state-root commitment.
- [ ] `flags`:
  - [ ] room;
  - [ ] invalid row/tick;
  - [ ] flagging identity;
  - [ ] state root evidence;
  - [ ] reason;
  - [ ] timestamp.
- [ ] `invalidations`:
  - [ ] room;
  - [ ] invalidated row;
  - [ ] reason;
  - [ ] flag count/threshold;
  - [ ] replacement head/tick.
- [ ] `tick_checks` (optional but recommended):
  - [ ] room/tick;
  - [ ] player identity;
  - [ ] resulting state root.
- [ ] `keyframes`:
  - [ ] room/tick;
  - [ ] checksum;
  - [ ] version;
  - [ ] RLE owner/claim/entity state;
  - [ ] submitter identity.
- [ ] Public views:
  - [ ] room list;
  - [ ] seat list;
  - [ ] ordered transaction rows;
  - [ ] tick seals;
  - [ ] invalidations;
  - [ ] current canonical head.
- [ ] Event tables:
  - [ ] `new_transaction`;
  - [ ] `tick_sealed`;
  - [ ] `new_flag`;
  - [ ] `new_invalidation`.
- [ ] Access rules:
  - [ ] only seated identities submit transactions/flags;
  - [ ] only host starts;
  - [ ] private tables for internal state;
  - [ ] public views expose only safe room/ledger data.

### Reducers

- [ ] `create_room`, `join_room`, `leave_room`, `ready`, `start_match`.
- [ ] `submit_transaction`:
  - [ ] authenticate seat;
  - [ ] validate schema/rate/sequence;
  - [ ] compute current tick from server time;
  - [ ] insert row; ordering is Spacetime transaction order.
- [ ] `seal_tick` scheduled reducer:
  - [ ] insert the next `room_ticks` row;
  - [ ] skip/handle delayed ticks;
  - [ ] no game simulation.
- [ ] `flag_transaction`.
- [ ] `invalidate_transaction` (quorum path).
- [ ] `submit_keyframe`.
- [ ] `submit_tick_check` (optional).
- [ ] Reject/strip:
  - [ ] unauthenticated/non-seat identities;
  - [ ] malformed schema;
  - [ ] duplicate client sequences;
  - [ ] rate-limited submissions;
  - [ ] transactions for non-running/ended rooms;
  - [ ] flags from stale/disconnected clients.

### Transport

- [ ] Replace custom HTTP/SSE with Spacetime subscriptions/generated bindings.
- [ ] Subscribe clients to transactions, tick seals, flags, invalidations.
- [ ] Use event tables for immediate transaction/tick notifications.
- [ ] Define catch-up queries for missed rows/ticks.
- [ ] Measure subscription payload size and egress.

## Phase 2 — Client simulation and optimistic execution

- [ ] Create a Spacetime-backed online lockstep session distinct from the
      current state-replication client.
- [ ] Start a local `WorkerLocalSimulation`/`TerritorySimulation` from:
  - [ ] room seed/config; or
  - [ ] a keyframe; then
  - [ ] ordered transaction rows.
- [ ] Buffer rows by tick; apply only after the tick seal.
- [ ] Sort rows by `rowIndex` before applying.
- [ ] Apply accepted rows optimistically at their assigned tick.
- [ ] Never use client wall-clock for authoritative tick assignment.
- [ ] Render entirely from local simulation state; do not stream owner/pixel
      deltas.
- [ ] Detect gaps:
  - [ ] missing rows/tick seals;
  - [ ] out-of-order delivery;
  - [ ] reconnect catch-up.
- [ ] Input scheduling:
  - [ ] submit transaction;
  - [ ] receive row/order;
  - [ ] input-delay buffer;
  - [ ] optional pending intent visualization.
- [ ] Background tab catch-up:
  - [ ] cap fast-forward per frame;
  - [ ] coalesce visuals;
  - [ ] avoid blocking the render loop.
- [ ] Keep a recent local keyframe for rollback.

### Client timing and frontier rules

- [ ] Separate the two clocks:
  - [ ] authoritative simulation tick index is fixed at 10 Hz;
  - [ ] client rendering/consumption rate is independent and may vary;
  - [ ] the client never simulates a partial/variable-dt tick.
- [ ] Maintain `safeHead`:
  - [ ] latest tick whose seal has been received;
  - [ ] all `ledger_transactions` rows for that tick have been received;
  - [ ] rows apply in `rowIndex` order.
- [ ] Demand-driven simulation loop:
  - [ ] while `confirmedTick < safeHead`, apply the next complete tick;
  - [ ] otherwise wait and keep rendering/interpolating;
  - [ ] catch up in whole ticks after a stall/background tab.
- [ ] Target lag:
  - [ ] measure lag in ticks, not wall-clock milliseconds;
  - [ ] keep a small safety buffer such as `safeHead - 1` or `safeHead - 2`;
  - [ ] do not treat `RTT/2` as sufficient without jitter, seal delivery,
        server batching, and CPU safety;
  - [ ] lag does not make the server assign a command earlier.
- [ ] Running ahead:
  - [ ] never simulate unsealed ticks in the no-prediction mode;
  - [ ] if prediction is added later, track a speculative tick and roll back to
        `confirmedTick` on seal/row mismatch;
  - [ ] rollback/replay is a separate opt-in and not required for the MVP.
- [ ] Variable client rates:
  - [ ] 8–12 Hz local consumption is acceptable only as whole-tick scheduling;
  - [ ] average consumption must keep up with the server or lag grows;
  - [ ] 12 Hz clients should wait at the frontier rather than simulate ahead.
- [ ] Error handling:
  - [ ] missing seal/rows: wait, do not advance;
  - [ ] late row for an already-applied tick: halt and resync/rollback;
  - [ ] local state-root mismatch at a sealed tick: halt/resync.

## Phase 3 — Flags, quorum, invalidation, rollback

- [ ] Define flag payload:
  - [ ] invalid transaction row;
  - [ ] tick;
  - [ ] expected pre-tick state root;
  - [ ] observed post-tick state root;
  - [ ] reason;
  - [ ] flagging seat.
- [ ] Client validation:
  - [ ] if local pre-state root differs, request resync instead of flagging;
  - [ ] if local state matches and the transaction is illegal, flag it;
  - [ ] do not crash on illegal rows.
- [ ] Server flag handling:
  - [ ] dedupe by seat/row;
  - [ ] ignore stale-state flags;
  - [ ] count only active in-sync humans;
  - [ ] append invalidation on quorum;
  - [ ] broadcast immediately.
- [ ] Canonical replay:
  - [ ] invalidated rows remain in history;
  - [ ] canonical sequence skips invalidated rows;
  - [ ] all later rows revalidate;
  - [ ] invalidation can cascade through dependent rows.
- [ ] Client rollback:
  - [ ] find nearest keyframe before the invalidated tick;
  - [ ] restore;
  - [ ] replay canonical rows by tick/rowIndex;
  - [ ] verify state roots;
  - [ ] continue from corrected head.
- [ ] UI:
  - [ ] provisional vs final state if challenge window exists;
  - [ ] resolving/reorg notice;
  - [ ] explain rollback territory changes.
- [ ] Add a challenge window only if optimistic reorgs are too visible.

## Phase 4 — Snapshots and versioning

- [ ] Define wire keyframe format:
  - [ ] header/version;
  - [ ] room/tick/checksum;
  - [ ] RLE owner/claim state;
  - [ ] entity/command/bot/RNG state;
  - [ ] derived arrays rebuilt on restore.
- [ ] Store keyframes in Spacetime:
  - [ ] row/blob or documented object-store reference;
  - [ ] submitter identity;
  - [ ] checksum/version;
  - [ ] bounded retention.
- [ ] Late join:
  - [ ] latest finalized keyframe;
  - [ ] transaction rows after keyframe;
  - [ ] tick seals;
  - [ ] checksum verification.
- [ ] Reconnect:
  - [ ] reattach identity/seat;
  - [ ] fetch keyframe + rows;
  - [ ] dedupe transactions/flags;
  - [ ] revalidate canonical head.
- [ ] Version rules:
  - [ ] reject incompatible keyframes/rows;
  - [ ] archive old engine/module versions if required;
  - [ ] include bot/map/simulation fingerprints.
- [ ] Snapshot tests:
  - [ ] restore + replay checksum;
  - [ ] corruption rejected;
  - [ ] budget behavior.

## Phase 5 — UI, spectator, and replay

- [ ] Replace online transport/page state with Spacetime subscriptions.
- [ ] Reuse `ReplayViewer` for:
  - [ ] live match rendering;
  - [ ] reconnect/resync;
  - [ ] spectator from transaction rows;
  - [ ] completed-match replay.
- [ ] Room UX:
  - [ ] create/join by room code;
  - [ ] seat/identity display;
  - [ ] ready/start;
  - [ ] connection quality;
  - [ ] invalid/reorg notice.
- [ ] Compact ledger viewer:
  - [ ] row index/tick/player/type;
  - [ ] flags;
  - [ ] invalidations;
  - [ ] canonical head.
- [ ] Spectator policy:
  - [ ] receive rows and simulate locally;
  - [ ] no seat/transaction permissions;
  - [ ] optional delay.
- [ ] Add help/manual explanation of optimistic validation and rollback.

## Phase 6 — Trust, malformed input, fairness (deferred)

- [ ] Server structural checks only:
  - [ ] auth/seat;
  - [ ] schema;
  - [ ] sequence/rate limits;
  - [ ] room state.
- [ ] Do not claim anti-cheat.
- [ ] Collusion/majority abuse remains possible; document it.
- [ ] Prevent direct client mutation of ledger tables; reducers only.
- [ ] Rate-limit/spam-protect flags and invalidations.
- [ ] Decide public/ranked policy separately:
  - [ ] authoritative validator; or
  - [ ] no public lockstep mode.

## Phase 7 — Testing and benchmarks

- [ ] Spacetime module tests:
  - [ ] room/seat lifecycle;
  - [ ] tick assignment;
  - [ ] transaction ordering;
  - [ ] tick sealing;
  - [ ] flag threshold/invalidation;
  - [ ] keyframe storage/lookup.
- [ ] Multi-client tests:
  - [ ] same seed + rows → same tick checksums;
  - [ ] same-tick rows applied by rowIndex;
  - [ ] stale-state flags ignored;
  - [ ] quorum invalidation rolls back all clients identically;
  - [ ] dependent rows revalidated;
  - [ ] reconnect from keyframe reaches canonical head;
  - [ ] missing row/tick recovery.
- [ ] Network tests:
  - [ ] latency;
  - [ ] jitter;
  - [ ] lost/reordered notifications;
  - [ ] late flags;
  - [ ] background/throttled tab.
- [ ] Spacetime capacity:
  - [ ] 10 Hz tick-seal reducer;
  - [ ] transaction/flag reducer cost;
  - [ ] egress per client;
  - [ ] storage growth;
  - [ ] one DB per room vs shared DB.
- [ ] Browser matrix/determinism:
  - [ ] checksum parity;
  - [ ] version handshake rejection.
- [ ] Soak:
  - [ ] long match;
  - [ ] reorgs/invalidations;
  - [ ] keyframe budget;
  - [ ] reconnect storms.

## Phase 8 — Rollout

- [ ] Prototype one room with Spacetime coordinator + two clients + local simulation.
- [ ] Measure RTT/one-way latency and tick-seal delay.
- [ ] Ship private co-op behind a flag.
- [ ] Keep existing authoritative state replication as fallback.
- [ ] Add telemetry:
  - [ ] transaction/tick latency;
  - [ ] checksum mismatches;
  - [ ] flags;
  - [ ] invalidations/reorgs;
  - [ ] catch-up time.
- [ ] Reassess Spacetime cost/limits after the spike.
- [ ] Decide online/evolution spectator migration.
- [ ] Update `docs/NETWORKING.md`, `docs/ARCHITECTURE.md`, and ADRs once implemented.

## Acceptance criteria

- [ ] Room lifecycle and transactions work entirely through Spacetime.
- [ ] No server-side simulation is required for happy-path play.
- [ ] Clients apply same-tick rows in canonical `rowIndex` order.
- [ ] Clients apply a tick only after its seal.
- [ ] No client uses wall-clock-derived ticks.
- [ ] Clients never simulate beyond the complete sealed frontier (`safeHead`).
- [ ] Variable client rates consume whole ticks and catch up without variable-dt
      simulation.
- [ ] Transactions can never append to an already sealed tick.
- [ ] All clients reach identical tick checksums.
- [ ] A deliberate illegal transaction can be flagged by an in-sync quorum.
- [ ] Quorum invalidation triggers identical rollback/replay on all clients.
- [ ] Dependent rows are revalidated during rollback.
- [ ] Late join/reconnect uses keyframe + rows + tick seals.
- [ ] No per-tick owner/pixel snapshot stream is required.
- [ ] Version-mismatched clients are rejected.
- [ ] Common-path RTT is transaction delivery + tick seal, with no validation
      round trip.
- [ ] Spacetime tick/egress/storage/pricing measured.
- [ ] Trust limitations documented.

## Open questions

- [ ] One Spacetime database per room or one shared database?
- [ ] Does every tick need a row, or only ticks with transactions plus periodic
      heartbeats?
- [ ] How do clients handle transactions assigned to a tick whose seal already
      passed?
- [ ] How are state roots attested/stored without a server simulation?
- [ ] How many ticks of input delay are needed for usable responsiveness?
- [ ] What exact quorum and single-human fallback?
- [ ] Should transient flags be event-table rows or persistent table rows?
- [ ] How long are transaction rows, flags, invalidations, and keyframes kept?
- [ ] Do spectators receive delayed rows or a summarized feed?
- [ ] What Spacetime cost is acceptable at 25 rooms / 200 players?
