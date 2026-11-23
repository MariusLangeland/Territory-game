# Alliances — design proposal

**Status:** designed, not implemented. The right-click `REQUEST ALLIANCE` item is
a placeholder only.

## Goal

Add a bounded, deterministic non-aggression/coordination mechanic that gives
players a diplomatic alternative to permanent war without replacing the
territory economy or front model.

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

## Implementation plan

1. Add command types `request-alliance`, `respond-alliance`, `break-alliance`.
2. Validate ownership, pending/active state, cooldowns, and self-targeting.
3. Resolve proposals in the bot decision phase; deterministic acceptance score.
4. Cancel conflicting fronts and block hostile target selection.
5. Add snapshot/checksum fields and war-feed events.
6. Replace the placeholder context item with real status/actions.
7. Add tests for acceptance/rejection, expiry, betrayal, front cancellation,
   ally targeting, elimination cleanup, and checksum determinism.
8. Re-run balance sweeps; alliances can reduce elimination pace, so tune only
   after observing them.

## Explicitly deferred

- Coalitions of more than two states.
- Shared vision, supply, or territory.
- Alliance victory conditions.
- Server-authoritative proposal delivery.
