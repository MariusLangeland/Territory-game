# Networking

> **Status:** design target, not implemented. The local vertical slice has no server, accounts, rooms, matchmaking, or WebSocket transport. This document defines the architecture to build next so the simulation stays authoritative and deterministic.

---

## 1. Goals

1. **Server authority:** the server owns authoritative game state, including ownership, attacks, attack orders, gold/cards, structures, eliminations, and winners.
2. **Deterministic lockstep:** clients run the same simulation and can verify agreement via checksums.
3. **Responsive input:** a click should feel immediate even with 50–200 ms latency.
4. **Recoverability:** reconnect or desync must produce a clean resync, never a silently corrupted match.
5. **Operational clarity:** a server process must be observable, restartable, and versioned.
6. **Fairness:** no client can manufacture territory, skip costs, or change attack reach.

Non-goals for the first online milestone:

- cross-region matchmaking,
- voice/chat,
- long-term progression,
- tournaments,
- client-rendered fog of war.

---

## 2. Topology

```text
Browser clients ───── WebSocket ─────►  Game server (authoritative, 10 Hz)
                                             │
                                             ├─ deterministic TerritorySimulation
                                             ├─ command validation / queue
                                             ├─ snapshots + checksums
                                             └─ room lifecycle

Optional later:
  REST/HTTP API ── accounts, match history, static assets
  Redis / Postgres ── persistence, leaderboards, replay storage
  Object storage ── replay archives, map assets
  CDN ── SvelteKit client, static/media, versioned map files
```

Start with one Node.js process that can host multiple rooms. Do not split services until measurement demands it.

### Why Node

- The simulation is TypeScript and already runs in V8.
- No second implementation means no cross-language determinism drift.
- WebSocket libraries and operational tooling are mature.
- A single codebase can share simulation, constants, and protocol types between browser and server.

### Build boundaries

The simulation cannot import browser or Svelte code. It already complies. A future `packages/sim` or `src/lib/game` import from the server runtime must remain DOM-free. Consider splitting into a shared workspace package when the server is added.

---

## 3. Match and room model

A **room** contains one match.

Suggested room configuration:

| Field                | Default                         | Notes                                      |
| -------------------- | ------------------------------- | ------------------------------------------ |
| `maxHumans`          | 8                               | Online target; stress mode uses 108 states |
| `totalStates`        | 8                               | Configurable; 108 for stress tests         |
| `fillWithBots`       | true                            | Bots fill empty states                     |
| `tickRate`           | 10                              | Must equal `TICK_RATE`                     |
| `minPlayersToStart`  | 1                               | Bots allow immediate start                 |
| `seed`               | server-generated or host-chosen | Server records it                          |
| `commandBufferTicks` | 2                               | How far ahead clients may schedule intents |
| `checksumEveryTicks` | 50                              | 5 s at 10 Hz                               |
| `reconnectGraceMs`   | 30,000                          | Seat held for a disconnected human         |
| `idleTimeoutMs`      | 60,000                          | Close empty rooms                          |

Room states:

```text
CREATED → WAITING → RUNNING → COMPLETED → ARCHIVED
                ↘ ABORTED
```

### Joining a live match

A player joining mid-match needs:

- protocol version, map version, seed;
- current tick;
- full public player state;
- a baseline owner map at that tick;
- active attacks, live structures, human gold/income/hand, and available attack orders;
- the last event sequence and current checksum.

The owner map is 2M owner bytes. Options:

1. Compress a baseline ownership buffer (zstd/brotli) in the welcome payload.
2. Send an initial replay of changes from tick 0 (on-demand for small matches, expensive for long ones).
3. Generate the map and apply the server baseline.

For v1, compress and send the owner baseline with a content size cap. For later, host versioned baselines in object storage.

Bots are server-side and require no connection.

---

## 4. Tick and command lifecycle

Server tick at 10 Hz:

1. Acquire the room's command queue.
2. Drain all intents accepted for this tick.
3. Validate ownership, player, sequence, rate limit, attack orders, gold, and card constraints.
4. Sort accepted commands by `(playerId, clientSequence)` (or another fixed rule).
5. Apply them to the simulation at the tick boundary.
6. Grant base attack orders, accrue Mine gold and Command Post orders, run bot decisions/attacks, then eliminations and victory.
7. Broadcast a tick delta to all clients.
8. Every N ticks, broadcast checksum.
9. If the match ended, broadcast results and freeze tick advancement.

### Intents, not commands

Clients submit intent:

```ts
interface AttackIntent {
	type: 'attack';
	sequence: number;
	x: number;
	y: number;
}
```

The server attaches:

- authoritative player id (from the socket/session),
- authoritative tick,
- server-side command id if needed,
- validation result.

The client cannot choose its player id for a command.

### Target tick

Clients may send a target tick within a small window (`currentTick + 1 .. currentTick + commandBufferTicks`). Arrival later than the window is rejected with a `LATE_COMMAND`-style reason. The server's tick is authoritative; never delay the whole simulation for one client.

The protocol draft currently uses `targetTick`; a production server should normalize and ack it.

### Ordering

Recommended deterministic order:

```text
(accepted tick, playerId asc, clientSequence asc)
```

Use sequence per player and enforce monotonicity. Arrival order must not influence gameplay. This is a protocol rule and must be covered by a server integration test.

---

## 5. Client prediction and reconciliation

The local simulation can keep the map responsive without waiting for the server.

### MVP strategy

1. Client simulates locally at 10 Hz for immediate feedback.
2. Client sends intents with target tick and local sequence.
3. Server accepts, applies, and broadcasts authoritative deltas/checksums.
4. Client treats its local state as provisional.
5. On each server tick:
   - if local tick < server tick, fast-forward or apply authoritative changes;
   - if checksums disagree, stop predicting, request a baseline, replace state.
6. Authoritative rejection removes/undoes the predicted order by resync.

### Simpler lockstep alternative

A deterministic lockstep model where clients do not simulate until they receive the command set for the next tick is easier to get correct but adds visible input latency. For a territory game with 100 ms ticks, prediction plus periodic authoritative correction is preferable.

### What not to interpolate

Ownership is discrete. Do not interpolate pixel owners. Camera pan/zoom may be smooth locally.

---

## 6. Wire protocol

The draft is in `src/lib/game/net/protocol.ts`. Core messages:

### Client → server

| Message       | Purpose                                                       |
| ------------- | ------------------------------------------------------------- |
| `hello`       | Protocol version, display name                                |
| `join`        | Enter a room/match                                            |
| `intent`      | One attack/build/upgrade intent with target tick and sequence |
| `growth-mode` | Select the growth layer for new orders (host/test policy)     |
| `ping`        | RTT probe                                                     |
| `leave`       | Voluntary departure                                           |

### Server → client

| Message      | Purpose                                                                                                                                                   |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `welcome`    | Identity, baseline snapshot, seed, map version, checksum                                                                                                  |
| `tick`       | Owner changes, public players, live structures, active attacks (including embedded/current orders and growth mode), current growth mode, events, checksum |
| `ack`        | Intent accepted                                                                                                                                           |
| `reject`     | Intent rejected with reason                                                                                                                               |
| `match-over` | Winner and final snapshot                                                                                                                                 |
| `pong`       | RTT response                                                                                                                                              |
| `error`      | Room/protocol/rate-limit errors                                                                                                                           |

### Encoding

Start with JSON over WebSocket for development visibility. Before production scale:

- encode ticks/deltas as binary frames (MessagePack, custom binary, or protobuf);
- compress baseline owner maps;
- avoid sending unchanged pixel data;
- send public player state every tick (small even at 108 stress states) or only on change with sequence numbers.

Owner changes:

- packed `(owner << 21) | index` numbers (already the internal format);
- binary as `Uint32Array` little-endian is ideal;
- include `changesOverflow` so clients know to request a baseline.

Growth mode:

- the current mode used for new orders must be server-authoritative, either fixed at match creation or changed by an accepted, tick-stamped command;
- each active attack carries the layer it was created with;
- client prediction must use the same per-attack layer and deterministic frontier ordering;
- mode changes must be replayed and checksummed like other commands.

Conflict and integrity state:

- per-cell attack-claim provenance determines when mutual fronts clash; clients must derive the defender spend and incoming embedded-order reduction identically from replayed attacks;
- detached-territory annexation is authoritative tick logic and must run on the same tick boundaries (every 10 ticks, plus the post-cancellation cooldown) on server and clients;
- claim provenance and cleanup scheduling are included in checksums, not sent as optional client visuals.

Structures:

- live structure ids, types, owners, map cells, stack counts, and effect descriptors are part of the authoritative snapshot (`structures`);
- capturing a structure cell destroys it at the same tick, removes its aura, and changes annexation protection immediately;
- clients may draw structures and auras from the snapshot, but the server owns placement, destruction, effects, and protection;
- aura defense and district assignment are derived from live structure effects/positions and are not sent as per-pixel authoritative state; clients recompute them with the same Voronoi and ownership rules;
- future transfer commands must be tick-stamped and authorized.

Player economy and cards:

- gold, income, hand, and available attack orders / cap are authoritative snapshot fields (`gold`, `income`, `hand`, `attackOrders`, `attackOrderCap`);
- builds are tick-stamped commands, validated server-side against permanent-hand membership, gold, territory, occupied structure cells, the 8 px exclusion radius, district placement, and stack eligibility; a matching district build pays base cost + current level, while a new structure pays base cost;
- upgrades are tick-stamped commands targeting an owned district; the server resolves the district's structure, spends `base card cost + projected current level`, and increments stacks without consuming a card;
- the hand is the fixed five-card catalog; there are no draws, consumption, or reroll, and repeat purchases use the same fixed card id;
- base order grants, continuous Command Post order accrual, continuous Mine income, and War Academy caps are server-authoritative; clients only display the snapshot;
- a captured buildable is razed at the tick of capture and its aura/income/order effect disappears immediately;
- bots do not participate in the card economy in this build, so their snapshot economy is omitted.

- elevation tiers are deterministic map data gated by `MAP_VERSION`; they are not sent per tick;
- defense is derived identically from elevation and current owner (`1 + elevation + occupied`);
- attack costs are server-authoritative tick logic, so clients predicting a front must apply the same embedded-order budget, piercing, lifetime, and requeue rule;
- the handshake must reject mismatched map versions, not just protocol versions.

### Versioning

The welcome/handshake must include:

- `NET_PROTOCOL_VERSION`,
- `MAP_VERSION`,
- app/build version or simulation hash,
- tick rate.

Mismatch: reject with a clear error and do not enter the room. Determinism across deployments requires identical simulation code; version gating is mandatory.

---

## 7. Validation and anti-cheat

Never trust a client for:

- player id,
- territory,
- resource counts (when an economy exists),
- owner id,
- win state,
- tick authority,
- seed or map version,
- attack outcomes.

Server validation:

- socket/session maps to exactly one player id;
- attack coordinate is integer, inside map, on land;
- origin is owned by the player at the target tick;
- attack has a shared border;
- the player has an available attack order at the target tick;
- sequence numbers strictly increase;
- intents per second per player are rate-limited;
- rejected intents do not mutate state.

Additional protections:

- per-IP and per-account connection limits;
- payload size limits;
- WebSocket ping/pong timeouts;
- origin checks for browser connections;
- no client-provided checksum can force server state changes;
- server logs accepted/rejected intents with reasons.

### Bot policy

Bots run on the server. Their PRNG is part of the authoritative simulation. Clients may render bot activity but cannot control it.

### Cheating limitations

A client can still read the full map (no fog) and write automation. If competitive integrity matters:

- add rate limits and behavioral telemetry;
- add a server-side command cooldown per player;
- consider partial fog later;
- use replay review and account moderation.

---

## 8. Reconnect and resync

### Reconnect

- Server holds a disconnected human seat for `reconnectGraceMs`.
- The match continues without that player's input (no auto-pause).
- On reconnect, the client receives a fresh baseline and resumes.
- If grace expires, the seat can be filled by a bot or abandoned.

### Desync

Triggers:

- checksum mismatch,
- protocol/build mismatch,
- baseline validation failure.

Recovery:

1. Client stops applying local commands.
2. Client requests/resyncs a baseline from the server.
3. Client replaces its local simulation state.
4. Client resumes prediction only after a confirmed tick.
5. Server records the desync event for diagnostics.

Checksums are diagnostic, not cryptographic proof. The server always wins.

---

## 9. Snapshots and bandwidth

At 10 Hz with the online target of 8 human states:

- Public player state ~8 × ~100 bytes = < 1 KiB/tick in JSON.
- Owner changes are typically tens to hundreds of changed pixels/tick; binary is a few KiB.
- Active attacks: bounded by outstanding attack orders and per-attack lifetimes; usually well under 24 records per client.
- Checksum: 4 bytes (hex/string overhead in JSON).

Baseline join is the expensive payload (owner map). Compress it.

Do not stream the full owner texture or map art per tick.

### Client rendering of authoritative changes

Two implementation options:

1. Apply the server's packed owner deltas directly to the renderer's control texture.
2. Apply to a client-side shadow simulation, then feed its change batch to the renderer.

MVP recommendation: client runs the simulation for prediction; after server tick, authoritative deltas update the same control texture. Design this carefully so double-applying a delta cannot occur. An authoritative baseline plus tick IDs solves this.

---

## 10. Server deployment

### MVP

- One stateless Node process (plus match state in memory) per region.
- Rooms assigned round-robin by a gateway.
- Deploy behind a reverse proxy with WebSocket support.
- TLS termination at the proxy.
- Health endpoint: room count, tick lag, active players.
- Metrics: tick duration, commands/s, rejects/s, checksum mismatches, bytes/s, CPU, memory.

### Later scale

- Room manager service owns room placement.
- Game workers own rooms and tick loops.
- Redis pub/sub or NATS for placement/health.
- Periodic snapshots to Postgres/object storage for crash recovery and match history.
- Region selection and latency-based matchmaking.
- Replays archived from command logs + seed + checksums.

### Tick loop isolation

A room's simulation is small (~0.1 ms/tick measured). Do not create one OS process per room until necessary. A Node process with many rooms is likely sufficient at the start. Measure before distributing.

---

## 11. Protocol compatibility and deployment

- Server must advertise min/max client protocol.
- Deploying a simulation change invalidates in-flight matches unless replay-compatible.
- Safest: deploy to a new room pool; finish existing matches on old workers.
- Record `simBuild` hash in match metadata.
- Increment `MAP_VERSION` for map changes and `NET_PROTOCOL_VERSION` for wire changes.
- Never hot-swap simulation code inside an active room.

---

## 12. Testing plan

### Unit / simulation

- Already covered: deterministic ticks, command sequencing, border invariants.
- Add: server validation unit tests for each rejection reason.

### Integration

- Two headless clients plus server: both receive identical checksums for a command log.
- Reconnect mid-match and verify baseline resync.
- Forced desync triggers baseline refresh.
- Intent arriving at an already-committed tick is rejected.
- Command ordering stress test: random arrival delays, deterministic outcomes.
- Rate limit abuse.
- Server restart with active rooms (determine expected behavior: drop, or restore from snapshot).

### Load

- 100 rooms × target player count; also stress 108-state rooms with unthrottled attack load to measure tick time p95, event-loop lag, and memory growth.
- Simulate heavy attack activity to stress change batches and broadcast size.

### Security

- Malformed frames, huge payloads, spoofed player ids.
- Origin/CSRF policy for WebSocket.
- Flood controls.

---

## 13. Open decisions

1. Transport envelope: JSON now, binary later, or binary from day one?
2. Command target window and late-command policy.
3. Client prediction scope: full simulation or only attack previews?
4. Baseline compression and storage strategy.
5. Reconnect vs bot takeover policy.
6. Whether spectators receive the same owner deltas.
7. Single global region vs multi-region rooms.
8. Persistence requirements for ranked play.
9. Whether bots consume player slots after disconnect.
10. Whether checksums are signed/attested (probably not needed; server authority is enough).

---

## 14. First server milestones

### Milestone A — transport skeleton

- Node WebSocket server.
- `hello` / `welcome` handshake.
- One room with one human + bots.
- Server tick loop, no client prediction yet.
- Broadcast public state and owner deltas.
- Browser connects with a minimal client toggle.

### Milestone B — trusted intents

- Attack intents validated server-side.
- Acks/rejections shown in UI.
- Client applies server deltas.
- Two humans join one room.
- Basic reconnect.

### Milestone C — determinism verification

- Client-side simulation prediction.
- Periodic checksum comparison.
- Baseline resync on mismatch.
- Match history/replay records.

### Milestone D — operational scale

- Room manager, metrics, load tests, deploy pipeline.
- Matchmaking and accounts as a separate product track.

See [ROADMAP.md](ROADMAP.md) for sequencing and acceptance criteria.
