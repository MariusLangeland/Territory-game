# Multiplayer Lockstep — TODO

Branch: `Multiplayer`

Goal: make online play a ledger-only, deterministic lockstep mode while keeping
the server authoritative for ordering/validation. The server should not need to
stream per-tick owner snapshots/deltas in the steady state.

## Phase 0 — Decisions and contracts

- [ ] Define the multiplayer authority model:
  - [ ] Server validates every transaction (`authoritative validator`), or
  - [ ] Server is a relay only (`private co-op`), with a separate policy for
        public/ranked play.
- [ ] Decide whether bots are implicit (seed/config) or explicit ledger
      transactions. Current ledger assumes implicit deterministic bots.
- [ ] Define public vs private multiplayer scope:
  - [ ] Private / friends: acceptable cheat surface?
  - [ ] Public / ranked: server validation and anti-cheat requirements.
- [ ] Define the version contract:
  - [ ] ledger schema version;
  - [ ] simulation rules version;
  - [ ] map generation version;
  - [ ] bot policy/genome version;
  - [ ] app/build fingerprint;
  - [ ] network protocol version.
- [ ] Define a version-handshake rejection policy. Never silently run mismatched
      engines.
- [ ] Decide baseline strategy for joining:
  - [ ] replay from tick 0;
  - [ ] server keyframe/snapshot + blocks;
  - [ ] both, with keyframe preferred.
- [ ] Decide input-delay and prediction policy:
  - [ ] fixed input delay only;
  - [ ] client prediction + reconciliation;
  - [ ] no prediction (acceptable only if latency target allows).
- [ ] Define tick scheduling: who closes a tick, how late intents are treated,
      and how a slow client catches up without stalling the room.

## Phase 1 — Ledger transport

- [ ] Add a wire `LedgerBlockEnvelope`:
  - [ ] block index;
  - [ ] tick;
  - [ ] previous checksum;
  - [ ] accepted transactions (player id + intent + order);
  - [ ] block checksum;
  - [ ] optional bot/config fingerprint.
- [ ] Add a baseline wire payload:
  - [ ] ledger header/config;
  - [ ] seed/map/config identity;
  - [ ] optional keyframe snapshot;
  - [ ] starting tick/checksum;
  - [ ] player/seat mapping.
- [ ] Add server → client block stream:
  - [ ] ordered delivery;
  - [ ] missing-block detection/retransmission;
  - [ ] backpressure;
  - [ ] reconnect catch-up;
  - [ ] snapshot/keyframe delivery.
- [ ] Add client → server transaction envelopes:
  - [ ] player/seat identity;
  - [ ] intent;
  - [ ] client sequence/ack;
  - [ ] idempotency/replay protection.
- [ ] Choose transport for the lockstep path:
  - [ ] SSE + HTTP (current MVP);
  - [ ] WebSocket;
  - [ ] binary encoding;
  - [ ] optional compression.
- [ ] Add protocol metrics: block latency, missing blocks, resync count.

## Phase 2 — Server ledger agent

- [ ] Extract a server-side ledger authority interface shared with the local
      `LedgerAgent` where practical.
- [ ] Server tick loop:
  - [ ] accept intents for the next tick;
  - [ ] validate against the authoritative simulation;
  - [ ] append accepted transactions;
  - [ ] seal and broadcast blocks;
  - [ ] advance the simulation;
  - [ ] publish checksums/keyframes at cadence.
- [ ] Reject/strip:
  - [ ] unauthenticated seats;
  - [ ] invalid sequence;
  - [ ] rate-limited intents;
  - [ ] intents for non-running/ended rooms;
  - [ ] intents that fail rules validation.
- [ ] Make bot behavior deterministic and identical across clients:
  - [ ] same roster;
  - [ ] same genomes/config;
  - [ ] same bot RNG/decision cadence;
  - [ ] no wall-clock inputs.
- [ ] Add keyframe capture:
  - [ ] server-side `captureSnapshot` at configured tick cadence;
  - [ ] bounded snapshot budget;
  - [ ] block/snapshot indexing;
  - [ ] drop/restore policy.
- [ ] Add late-join support:
  - [ ] join window policy;
  - [ ] baseline at current head;
  - [ ] prior ledger blocks retained long enough for resync.
- [ ] Add reconnect support:
  - [ ] token/seat reattachment;
  - [ ] latest keyframe + block replay;
  - [ ] duplicate transaction protection.

## Phase 3 — Client lockstep engine

- [ ] Create a client online lockstep session distinct from the current
      state-replication session.
- [ ] Start a local `TerritorySimulation` from:
  - [ ] seed/config; or
  - [ ] server keyframe; then
  - [ ] apply blocks in exact tick order.
- [ ] Apply transactions at their target ticks, not on arrival.
- [ ] Do not apply state deltas in lockstep mode; the local simulation is the
      source of rendered state.
- [ ] Implement block buffering:
  - [ ] contiguous block requirement;
  - [ ] wait/catch-up when missing;
  - [ ] never apply a future block out of order.
- [ ] Implement input scheduling:
  - [ ] input delay window;
  - [ ] transaction send/ack;
  - [ ] local pending intent visualization;
  - [ ] if prediction is enabled, rollback/replay to reconciliation tick.
- [ ] Implement desync detection:
  - [ ] compare block checksums;
  - [ ] stop on mismatch;
  - [ ] request latest keyframe/blocks;
  - [ ] surface a resync/error state.
- [ ] Implement background-tab catch-up:
  - [ ] cap fast-forward per frame;
  - [ ] coalesce visuals;
  - [ ] avoid blocking the render loop.

## Phase 4 — State, snapshots, and checksums

- [ ] Define snapshot wire format:
  - [ ] header/version;
  - [ ] tick/checksum;
  - [ ] RLE owner/claim state;
  - [ ] entity/command/bot/RNG state;
  - [ ] derived arrays omitted and rebuilt.
- [ ] Add snapshot encode/decode tests:
  - [ ] round-trip at multiple ticks;
  - [ ] restore then step matches uninterrupted checksum;
  - [ ] corruption/incompatibility rejected.
- [ ] Add deterministic checksum verification:
  - [ ] client vs server;
  - [ ] client vs client (debug/spectator);
  - [ ] mismatch diagnostics.
- [ ] Add versioned compatibility rules:
  - [ ] reject old/new incompatible snapshots;
  - [ ] archive engine version for old replays/ranked matches.
- [ ] Add keyframe budget/retention tests across map sizes.

## Phase 5 — Online UI and UX

- [ ] Add a multiplayer mode selector/feature flag:
  - [ ] existing authoritative state replication;
  - [ ] ledger lockstep.
- [ ] Room UX:
  - [ ] ready/start flow;
  - [ ] seat identities;
  - [ ] ping/input-delay display;
  - [ ] connection quality/desync status;
  - [ ] reconnect notice.
- [ ] Replay integration:
  - [ ] reuse `ReplayViewer` for spectating;
  - [ ] load server ledger blocks;
  - [ ] optional live spectator via blocks;
  - [ ] timeline/ledger viewer for completed matches.
- [ ] Player feedback:
  - [ ] transaction pending/ack/rejected states;
  - [ ] delayed-input explanation;
  - [ ] desync/resync banner;
  - [ ] cannot start on version mismatch.
- [ ] Mobile/battery:
  - [ ] measure full simulation load;
  - [ ] choose default map/state counts;
  - [ ] degrade gracefully under throttling.

## Phase 6 — Security and fairness

- [ ] Server-side rule validation for public play.
- [ ] Seat/token ownership for every transaction.
- [ ] Sequence and rate-limit enforcement.
- [ ] Transaction idempotency.
- [ ] No client-controlled player ids/checksums/tick numbers.
- [ ] Cheat surface review for lockstep:
  - [ ] modified client simulation;
  - [ ] fabricated checksums;
  - [ ] state knowledge.
- [ ] Spectator authorization/privacy (if hidden state is ever added).
- [ ] Validate that client-supplied ledgers/replays cannot mutate live state.

## Phase 7 — Testing and hardening

- [ ] Multi-client integration tests:
  - [ ] two clients, same seed, same blocks → same checksum;
  - [ ] commands from both seats ordered identically;
  - [ ] rejoin at keyframe then catch up;
  - [ ] missing block recovery;
  - [ ] desync detection/resync.
- [ ] Simulated network tests:
  - [ ] latency;
  - [ ] jitter;
  - [ ] packet/block loss;
  - [ ] duplicate/reordered transaction envelopes;
  - [ ] slow client/background tab.
- [ ] Soak:
  - [ ] long match with bots + humans;
  - [ ] keyframe budget;
  - [ ] memory stability;
  - [ ] reconnect storms.
- [ ] Capacity:
  - [ ] measure client CPU per room/match;
  - [ ] measure server relay/validation cost;
  - [ ] compare with current `bench:online` targets.
- [ ] Browser matrix:
  - [ ] Chrome/Edge/Firefox/Safari where supported;
  - [ ] WebGPU support gates;
  - [ ] checksum parity.
- [ ] Determinism tests:
  - [ ] same seed and blocks across runs;
  - [ ] snapshot restore + remaining blocks;
  - [ ] bot version pinning.

## Phase 8 — Rollout

- [ ] Ship private co-op first behind a flag.
- [ ] Keep state replication as fallback for public rooms.
- [ ] Add telemetry for desyncs, resyncs, block latency, client tick rate.
- [ ] Add an explicit “how multiplayer works” help/manual note.
- [ ] Decide whether ranked/public play uses lockstep at all.
- [ ] Update `docs/NETWORKING.md` once the transport/authority model is final.
- [ ] Version bump and release checklist.

## Acceptance criteria

- [ ] Two clients with the same version/seed produce identical checksums after
      a command-heavy match with bots.
- [ ] A client joining from a keyframe reaches the server’s head checksum.
- [ ] A missing block is detected and recovered without silent divergence.
- [ ] A desync stops the match/surfaces an error and resyncs from a keyframe.
- [ ] A backgrounded/throttled tab catches up without stalling other clients.
- [ ] Incompatible app/sim/map/bot versions are rejected at handshake.
- [ ] No steady-state owner/delta snapshot stream is required for lockstep
      play.
- [ ] Memory and CPU stay within agreed client/server budgets.
- [ ] Public-play authority/cheat policy is explicitly chosen and tested.

## Open questions

- [ ] Is lockstep for private co-op only, or should public rooms use it?
- [ ] Can clients be trusted to render from local simulation in competitive
      play?
- [ ] How long must blocks/keyframes be retained for reconnect?
- [ ] Do spectators receive blocks and simulate locally, or a reduced stream?
- [ ] Is prediction worth the reconciliation complexity at the target ping?
- [ ] How are bots represented in the ledger long-term: implicit or explicit?
- [ ] Do we need cross-browser determinism waivers or a checksum-based fallback?
