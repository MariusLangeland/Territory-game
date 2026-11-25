# Multiplayer Lockstep — TODO

Branch: `Multiplayer`

## Chosen architecture

Use **Spacetime (SpacetimeDB)** as the room and ledger coordinator.

The server does not run the simulation. Clients run their own deterministic
simulation and exchange transactions/ledger blocks. Connected clients optimistically
apply the ledger, and serious foul play or simulation errors are corrected through
client flags, a quorum, and a deterministic rollback.

```text
Spacetime module:
  identity/auth, rooms, seats, ordering, ledger, flags, keyframes

clients:
  local TerritorySimulation, transaction submission, optimistic apply,
  validation, flags, rollback/replay, rendering

correction path:
  bad transaction applied optimistically
    -> clients flag illegality/state mismatch
    -> server records a quorum invalidation
    -> clients restore the previous keyframe and replay the canonical ledger
```

This is intentionally **not** full BFT consensus. It prioritizes functionality
and low RTT for private/co-op play. Put bluntly: the server is a sequencer and
ledger, not a rules authority, and the lobby is trusted to police obvious errors.

## Phase 0 — Contracts and decisions

- [ ] Lock the trust model:
  - [ ] private/co-op is the primary target;
  - [ ] cheating is an accepted risk for now;
  - [ ] public/ranked anti-cheat is explicitly out of scope for this phase.
- [ ] Define the Spacetime module boundary:
  - [ ] room lifecycle;
  - [ ] seat/auth handling;
  - [ ] transaction ordering;
  - [ ] ledger block sealing;
  - [ ] flags/invalidations;
  - [ ] keyframe storage;
  - [ ] block/keyframe subscriptions.
- [ ] Decide whether each match is:
  - [ ] its own Spacetime database; or
  - [ ] one database with room-keyed tables.
  - Measure transaction/scheduling contention before choosing.
- [ ] Define the version handshake:
  - [ ] Spacetime module version;
  - [ ] client SDK/generated binding version;
  - [ ] ledger schema version;
  - [ ] simulation rules version;
  - [ ] map generation version;
  - [ ] bot policy/genome version;
  - [ ] app/build fingerprint.
  - [ ] Reject mismatched clients before they can submit transactions.
- [ ] Decide whether bots are:
  - [ ] implicit deterministic participants from seed/config (current model); or
  - [ ] explicit ledger transactions.
- [ ] Define flag threshold:
  - [ ] majority of active, connected, in-sync human seats;
  - [ ] exclude bots, spectators, disconnected clients, and stale-state voters.
- [ ] Decide the finality model:
  - [ ] optimistic finality with asynchronous invalidation/rollback;
  - [ ] short provisional/challenge window before finalization;
  - [ ] hybrid.
  - Optimistic finality is preferred for responsiveness.
- [ ] Define the single-human fallback. A one-player lobby has no majority;
      choose trust-the-player, disable invalidation, or retain a minimal server
      checker.
- [ ] Define baseline/keyframe strategy for join/reconnect:
  - [ ] latest stored keyframe + blocks;
  - [ ] replay from genesis as fallback.
- [ ] Define the client clock/input flow:
  - [ ] no per-transaction validation RTT;
  - [ ] optimistic local application;
  - [ ] optional input buffer/challenge window;
  - [ ] block ordering by server tick.

## Phase 1 — Spacetime coordinator

### Module setup

- [ ] Add Spacetime project/module scaffolding.
- [ ] Pin CLI/module/client SDK versions.
- [ ] Add `spacetime` config and local `spacetime start` development flow.
- [ ] Document publish/migrate workflow for Maincloud and self-host.
- [ ] Add CI checks for module build, publish dry run, and binding generation.

### Schema

- [ ] `rooms`:
  - [ ] room id/code;
  - [ ] state (`waiting`, `running`, `completed`);
  - [ ] config/seed/map/bot identity;
  - [ ] start/end tick;
  - [ ] version fingerprint.
- [ ] `seats`:
  - [ ] room;
  - [ ] Spacetime `Identity`;
  - [ ] player id;
  - [ ] ready/connected status;
  - [ ] host flag.
- [ ] `ledger_headers` / `matches`:
  - [ ] ledger version;
  - [ ] simulation/map/bot versions;
  - [ ] initial checksum;
  - [ ] current tick/head.
- [ ] `ledger_blocks`:
  - [ ] block index;
  - [ ] tick;
  - [ ] previous checksum;
  - [ ] ordered transaction rows;
  - [ ] block checksum/state root;
  - [ ] validity status (`provisional`, `final`, `invalidated`).
- [ ] `ledger_transactions`:
  - [ ] player/seat;
  - [ ] intent payload;
  - [ ] order/sequence;
  - [ ] accepted tick;
  - [ ] hash/id.
- [ ] `transaction_flags`:
  - [ ] transaction/block id;
  - [ ] flagging identity/seat;
  - [ ] tick/state-root evidence;
  - [ ] reason;
  - [ ] timestamp/block reference.
- [ ] `invalidations`:
  - [ ] invalidated transaction/block;
  - [ ] canonical replacement head;
  - [ ] flag count/threshold;
  - [ ] reason/evidence;
  - [ ] tick.
- [ ] `keyframes`:
  - [ ] tick;
  - [ ] checksum;
  - [ ] RLE owner/claim and entity state;
  - [ ] submitter identity;
  - [ ] version fingerprint.
- [ ] `tick_state`:
  - [ ] last seq/tick;
  - [ ] block cadence;
  - [ ] finality watermark.
- [ ] Public views:
  - [ ] room list;
  - [ ] seat list;
  - [ ] ledger blocks;
  - [ ] invalidations;
  - [ ] current head/checksum.
- [ ] Event table:
  - [ ] `new_ledger_block`;
  - [ ] `new_flag`;
  - [ ] `new_invalidation`.
- [ ] Access rules:
  - [ ] only seated identities submit transactions/flags;
  - [ ] only host starts;
  - [ ] private tables for internal ledger state;
  - [ ] public views limited to safe room/ledger data.

### Reducers

- [ ] `create_room`, `join_room`, `leave_room`, `ready`, `start_match`.
- [ ] `submit_transaction`.
- [ ] `flag_transaction`.
- [ ] `invalidate_transaction` (quorum path).
- [ ] `submit_keyframe`.
- [ ] Tick/block sealing reducer driven by a schedule table.
- [ ] Reject:
  - [ ] unauthenticated/non-seat identities;
  - [ ] malformed transactions;
  - [ ] duplicate sequences;
  - [ ] rate-limited submissions;
  - [ ] transactions for non-running rooms;
  - [ ] flags from disconnected/stale clients.
- [ ] Keep the tick reducer cheap: it should sequence/seal ledger data, not
      simulate the game.
- [ ] Benchmark scheduled tick jitter and whether 10 Hz blocks fit the interval.

### Transport

- [ ] Replace custom HTTP/SSE with Spacetime subscriptions and generated bindings.
- [ ] Subscribe clients to room state, blocks, flags, and invalidations.
- [ ] Use event tables for immediate block/flag notifications.
- [ ] Define missing-block/reconnect catch-up from tables.
- [ ] Measure subscription payload size and egress.

## Phase 2 — Client simulation and optimistic execution

- [ ] Create a Spacetime-backed online lockstep session distinct from the
      existing state-replication client.
- [ ] Start a local `WorkerLocalSimulation`/`TerritorySimulation` from:
  - [ ] room seed/config; or
  - [ ] a certified keyframe; then
  - [ ] apply ledger blocks in order.
- [ ] Submit transactions through a Spacetime reducer; no separate API server.
- [ ] Apply accepted transactions optimistically at their target tick.
- [ ] Keep local rendering entirely from local simulation state; do not stream
      owner/pixel deltas.
- [ ] Buffer out-of-order/missing blocks and catch up without applying future
      blocks early.
- [ ] Implement local pending state for transactions not yet sealed in a block.
- [ ] Keep input delay minimal; no per-request validation round trip.
- [ ] Coalesce fast-forward/catch-up visuals rather than rendering every tick.

## Phase 3 — Flags, quorum, invalidation, rollback

- [ ] Define the exact flag payload:
  - [ ] transaction/block id;
  - [ ] claimed tick;
  - [ ] pre-state checksum;
  - [ ] post-state checksum;
  - [ ] reason/evidence;
  - [ ] flagging seat.
- [ ] On local validation failure:
  - [ ] do not crash;
  - [ ] verify the local state root matches the block’s pre-state root;
  - [ ] if mismatched, request resync instead of flagging;
  - [ ] if state matches and the move is illegal, emit a flag.
- [ ] Server-side flag handling:
  - [ ] dedupe by seat/transaction;
  - [ ] ignore flags from stale state roots;
  - [ ] count only active human seats;
  - [ ] append a quorum invalidation when threshold is crossed;
  - [ ] broadcast invalidation immediately.
- [ ] Threshold behavior:
  - [ ] majority of active in-sync humans;
  - [ ] single-human fallback;
  - [ ] disconnected/backgrounded clients excluded;
  - [ ] late flags after the block is final trigger a reorg path.
- [ ] Canonical replay semantics:
  - [ ] invalidated transaction remains in the historical ledger;
  - [ ] canonical replay skips it;
  - [ ] all dependent later transactions are revalidated;
  - [ ] invalidations can cascade only through explicit canonical replay.
- [ ] Client rollback:
  - [ ] find nearest keyframe before the invalidated tick;
  - [ ] restore;
  - [ ] replay canonical ledger skipping invalidated transactions;
  - [ ] verify resulting checksum;
  - [ ] continue from the corrected head.
- [ ] UI behavior:
  - [ ] show provisional vs final blocks if a challenge window exists;
  - [ ] show “resolving dispute” during reorg;
  - [ ] avoid hiding rollback state changes without explanation.
- [ ] Add a short optional challenge window if optimistic reorgs are too visible.

## Phase 4 — Snapshots and versioning

- [ ] Define a wire keyframe format:
  - [ ] header/version;
  - [ ] tick/checksum;
  - [ ] RLE owner/claim state;
  - [ ] entity/command/bot/RNG state;
  - [ ] derived state rebuilt on restore.
- [ ] Store keyframes in Spacetime:
  - [ ] row/blob or documented file/object-store reference;
  - [ ] submitter identity;
  - [ ] checksum/version;
  - [ ] bounded retention.
- [ ] Late join:
  - [ ] select latest finalized keyframe;
  - [ ] stream subsequent canonical blocks;
  - [ ] verify checksum.
- [ ] Reconnect:
  - [ ] reattach seat identity;
  - [ ] fetch latest keyframe + blocks;
  - [ ] dedupe transactions/flags;
  - [ ] revalidate current canonical head.
- [ ] Version rules:
  - [ ] reject incompatible keyframes/blocks;
  - [ ] preserve archived engine/module versions for old replays;
  - [ ] include bot/map/simulation fingerprints.
- [ ] Snapshot tests:
  - [ ] restore + replay checksum;
  - [ ] corruption rejected;
  - [ ] budget behavior.

## Phase 5 — UI, spectator, and replay

- [ ] Replace the online transport/page state with Spacetime subscriptions.
- [ ] Reuse `ReplayViewer` for:
  - [ ] live match rendering;
  - [ ] reconnecting/resyncing;
  - [ ] spectator mode from ledger blocks;
  - [ ] completed-match replay.
- [ ] Room UX:
  - [ ] create/join with room code;
  - [ ] seat/identity display;
  - [ ] ready/start;
  - [ ] connection quality;
  - [ ] invalid-block/reorg notice.
- [ ] Add a compact ledger viewer for online rooms:
  - [ ] blocks;
  - [ ] flags;
  - [ ] invalidations;
  - [ ] current canonical head.
- [ ] Spectator policy:
  - [ ] receive blocks and simulate locally;
  - [ ] no seat/transaction permissions;
  - [ ] optional delay to reduce cheating surface.
- [ ] Add a help/manual explanation of optimistic validation and rollback.

## Phase 6 — Trust, malformed input, and fairness (deferred)

- [ ] Structural validation only on the server:
  - [ ] seat/auth;
  - [ ] sequence/rate limits;
  - [ ] transaction schema;
  - [ ] flag schema.
- [ ] Do not pretend this is anti-cheat.
- [ ] Collusion/majority abuse remains possible; document it.
- [ ] Prevent clients from mutating ledger tables directly; reducers only.
- [ ] Protect against flag spam and invalidation spam.
- [ ] Decide public/ranked policy separately:
  - [ ] authoritative validator service; or
  - [ ] no public lockstep mode.

## Phase 7 — Testing and benchmarks

- [ ] Spacetime module tests:
  - [ ] room/seat lifecycle;
  - [ ] transaction submission;
  - [ ] block sealing at tick cadence;
  - [ ] flag threshold/invalidation;
  - [ ] keyframe storage/lookup.
- [ ] Multi-client tests:
  - [ ] two clients apply identical blocks to identical simulation checksums;
  - [ ] a flag from a stale client is ignored;
  - [ ] quorum invalidation rolls back all clients identically;
  - [ ] dependent transactions replay correctly;
  - [ ] reconnect from keyframe reaches canonical head;
  - [ ] missing block recovery.
- [ ] Network tests:
  - [ ] latency;
  - [ ] jitter;
  - [ ] lost/reordered block notifications;
  - [ ] late flags;
  - [ ] background/throttled tab.
- [ ] Spacetime capacity tests:
  - [ ] 10 Hz scheduled block reducer;
  - [ ] transaction/flag reducer cost;
  - [ ] egress per client;
  - [ ] storage growth per match;
  - [ ] one-database-per-room vs shared-room database.
- [ ] Browser matrix and determinism:
  - [ ] checksum parity across supported browsers;
  - [ ] version handshake rejection.
- [ ] Soak:
  - [ ] long match with bots/humans;
  - [ ] reorgs/invalidations;
  - [ ] keyframe budget;
  - [ ] reconnect storms.

## Phase 8 — Rollout

- [ ] Prototype one room with Spacetime coordinator + two clients + local
      simulation.
- [ ] Measure RTT and block cadence; verify no validation round trip on the
      common path.
- [ ] Ship private co-op behind a flag.
- [ ] Keep the existing authoritative state-replication mode as fallback.
- [ ] Add telemetry:
  - [ ] block latency;
  - [ ] checksum mismatches;
  - [ ] flags;
  - [ ] invalidations/reorgs;
  - [ ] client catch-up time.
- [ ] Reassess Spacetime cost/limits before scaling beyond the private-co-op
      spike.
- [ ] Decide whether online/evolution spectating moves fully to the ledger.
- [ ] Update `docs/NETWORKING.md`, `docs/ARCHITECTURE.md`, and ADRs once the
      Spacetime contract is implemented.

## Acceptance criteria

- [ ] A room is created, joined, and started entirely through Spacetime.
- [ ] No server-side authoritative simulation is required for happy-path play.
- [ ] All clients apply the same blocks and reach identical checksums.
- [ ] A deliberately illegal transaction can be flagged by an in-sync quorum.
- [ ] The invalidation triggers an identical rollback/replay on every client.
- [ ] Dependent transactions are revalidated during rollback.
- [ ] Late join and reconnect use a stored keyframe plus canonical blocks.
- [ ] No per-tick owner/pixel snapshot stream is needed.
- [ ] Version-mismatched clients are rejected before play.
- [ ] Common-path RTT is one-way transaction + one-way block delivery, with no
      validation round trip.
- [ ] Spacetime tick cost, egress, storage, and pricing are measured for the
      target room/player counts.
- [ ] The trust limitations are documented: majority collusion and cheating are
      possible.

## Open questions

- [ ] One Spacetime database per room or one database for all rooms?
- [ ] What exact block cadence? Every tick, or batched blocks?
- [ ] Is a challenge window required, or is optimistic rollback acceptable?
- [ ] What does “active/in-sync” mean for flag quorum during lag/reconnect?
- [ ] How are keyframes produced and trusted when the server does not simulate?
- [ ] How long should blocks/flags/keyframes be retained?
- [ ] Do spectators vote? (Recommended: no.)
- [ ] Do spectating clients receive keyframes/blocks with a delay?
- [ ] Can the host override a blocked lobby or single-human fallback?
- [ ] How much Spacetime cost is acceptable at 25 rooms / 200 players?
