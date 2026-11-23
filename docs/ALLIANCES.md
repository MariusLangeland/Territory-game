# Alliances

**Status:** implemented in 0.72.0. The right-click `REQUEST ALLIANCE` item starts
a real proposal and `BREAK ALLIANCE` ends an active pair.

## Goal

Add a bounded, deterministic non-aggression/coordination mechanic that gives
players a diplomatic alternative to permanent war without replacing the
territory economy or front model.

## Implemented version

- The human can request an alliance with a living AI state from the rival
  context menu.
- A pending proposal resolves on that bot's next staggered decision phase and
  expires after 30 seconds.
- One active alliance or pending proposal per player.
- Active alliances last 3 minutes, block all hostile targeting between the pair,
  cancel existing fronts with the normal proportional refund, skip allies in
  naval/artillery targeting, and grant coordination credit against common foes.
- Either side can break an active alliance; breaking starts a 60-second pair
  cooldown and adds a betrayal grievance.
- Proposals/alliances are removed on expiry or elimination and are checksummed
  and included in snapshots (protocol 39).
- Bot-initiated requests, renewal, multi-party coalitions, shared vision/supply,
  and alliance victory remain deferred.

## Non-goals for the first version

- Shared vision, shared territory, or shared supply.
- Joint control of a single state.
- Alliance victory.
- Multi-party coalition chat or server-synchronized diplomacy.
- Any online/protocol claim; this is local-match design only for now.

## State model

Alliance state belongs to the simulation and is checksummed.

```ts
type AllianceStatus = 'pending' | 'active' | 'rejected' | 'broken' | 'expired';

interface AllianceProposal {
	id: number;
	fromPlayerId: number;
	toPlayerId: number;
	createdAtTick: number;
	expiresAtTick: number;
	outcome: AllianceStatus;
}

interface Alliance {
	id: number;
	playerA: number;
	playerB: number;
	startedAtTick: number;
	expiresAtTick: number;
	brokenBy?: number;
}
```

Rules:

- At most one active alliance per player in v1.
- Proposals expire after a fixed window (proposed **300 ticks / 30 s**).
- Active alliances expire after a fixed duration (proposed **1,800 ticks / 3 min**)
  unless renewed.
- A proposal has deterministic id order; queued proposals resolve in command
  order.
- Eliminating a player removes their proposals and alliances.
- Alliances do not alter ownership, annexation, districts, or checksums of
  territory except through the shared diplomacy state.

## Player flow

1. Right-click a rival state's territory or structure.
2. Choose **REQUEST ALLIANCE**.
3. The request becomes a pending proposal visible in the war feed and in a small
   diplomacy status line.
4. The target bot accepts or rejects at its next decision phase.
5. On acceptance, both states enter an active alliance:
   - Neither side may launch fronts, naval landings, or artillery at the other.
   - Existing fronts between them are cancelled with the normal proportional
     refund, or are allowed to finish? **Decision: cancel immediately** so the
     alliance state has one unambiguous meaning.
   - Teammates-style targeting bonus applies when both attack a common third
     state.
6. Either side may break the alliance from the context menu. Breaking:
   - ends the alliance immediately,
   - applies a betrayal grievance to the breaker,
   - starts a per-pair cooldown before another request can be accepted.
7. An attack from an allied state is impossible through normal commands; if a
   direct simulation call bypasses validation, the alliance is broken and the
   attacker takes the betrayal penalty.

## Bot acceptance policy

Acceptance is a deterministic integer score at the target's decision phase:

- `+` relative strength gap in the requester's favor (useful partner).
- `+` shared hostile neighbor / common threat.
- `+` requester is not currently bordering the target or has low grievance.
- `+` target is not already allied.
- `−` requester has recently captured the target's territory.
- `−` requester is much stronger and already winning (fear of being absorbed).
- `−` requester has a history of breaking alliances.
- `−` target has an active front or strong opportunity against the requester.

Add integer threshold and deterministic hash tie-break. No shared RNG.

## Effects

V1 effects are intentionally small:

- Non-aggression: attacks/artillery/naval landings cannot target an ally.
- Coordination: both allies gain the existing team coordination bonus when
  striking the same third-party target.
- Visibility: active/allied state shown on the banner and in the context menu.
- No resource sharing and no shared vision.

## UI

- Context menu: `REQUEST ALLIANCE`, disabled while a request is pending/active
  or when the target is already allied; label shows current status.
- War feed: proposal sent, accepted, rejected, expired, broken.
- Rival supply banner: small ally/pending marker, not a second large plaque.
- Optional diplomacy panel later; do not add a new modal for v1.

## Determinism and protocol

- Add `allianceProposals`, `alliances`, and `nextAllianceId` to snapshots and
  checksums.
- Proposal acceptance uses a checksummed decision epoch and fixed player/id
  ordering.
- No wall-clock expiry; ticks only.
- Protocol snapshot shape change requires a protocol version bump when
  implemented.

## Implementation notes

- Commands: `alliance-request` and `alliance-break`; the bot response is
  processed inside the simulation's staggered decision phase, not as a client
  command.
- Request/break validation is command-driven; no UI path mutates simulation state
  directly.
- Acceptance is integer utility plus a deterministic seeded tie-break.
- Tests cover acceptance, allied attack rejection, front cancellation, break
  cooldown, and identical checksums across identical request runs.

## Explicitly deferred

- Coalitions of more than two states.
- Shared vision, supply, or territory.
- Alliance victory conditions.
- Server-authoritative proposal delivery.
- Renewal and bot-initiated proposals.
