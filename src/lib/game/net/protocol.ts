/**
 * Wire protocol sketch for the authoritative multiplayer phase.
 *
 * This module is intentionally dependency-free. The current vertical slice is
 * local-only; these types fix the boundaries before a WebSocket server is added.
 * See docs/NETWORKING.md for the full authority and reconciliation model.
 */

import type { GrowthMode } from '../growth';
import type { AttackFailure, PublicAttack, PublicPlayer, SimEventKind } from '../simulation';
import type { PublicCard, PublicStructure } from '../Structures';

export const NET_PROTOCOL_VERSION = 21;

export type MatchId = string;
export type PlayerId = number;
export type Tick = number;

/** A player action without authority. The server stamps the owning player and tick. */
export interface AttackIntent {
	type: 'attack';
	/** Monotonic per client, used for acknowledgement and ordering. */
	sequence: number;
	x: number;
	y: number;
}

export type ClientMessage =
	| {
			t: 'hello';
			protocol: number;
			displayName: string;
	  }
	| {
			t: 'join';
			matchId: MatchId;
	  }
	| {
			t: 'intent';
			/** Client's best estimate; the server decides the authoritative tick. */
			targetTick: Tick;
			intent: AttackIntent;
	  }
	| {
			/** Host-controlled test mode; server must accept and broadcast it. */
			t: 'growth-mode';
			mode: GrowthMode;
	  }
	| {
			t: 'ping';
			nonce: number;
			clientTime: number;
	  }
	| {
			t: 'leave';
	  };

/** Compact per-tick player view. Sent in full because there are only eight states. */
export interface WirePlayer {
	id: PlayerId;
	name: string;
	isBot: boolean;
	alive: boolean;
	territory: number;
}

export interface WireSnapshot {
	tick: Tick;
	players: WirePlayer[];
	attacks: PublicAttack[];
	structures: PublicStructure[];
	gold: number;
	income: number;
	hand: PublicCard[];
	attackOrders: number;
	attackOrderCap: number;
	winnerId: PlayerId | null;
	claimedLand: number;
	landCount: number;
	/** Growth layer used for new attack orders. Must be server-authoritative. */
	growthMode: GrowthMode;
}

export interface BaselineSnapshot {
	seed: number;
	mapVersion: number;
	snapshot: WireSnapshot;
	/**
	 * Packed `(owner << 21) | pixelIndex` values for a mid-match join.
	 * Production should zstd/brotli this payload or send it out-of-band.
	 */
	owners: number[];
	/** FNV-1a checksum of the authoritative state at `snapshot.tick`. */
	checksum: string;
}

export interface WireEvent {
	tick: Tick;
	kind: SimEventKind;
	message: string;
	playerId?: PlayerId;
}

export type ServerMessage =
	| {
			t: 'welcome';
			protocol: number;
			matchId: MatchId;
			playerId: PlayerId;
			tickRate: number;
			baseline: BaselineSnapshot;
	  }
	| {
			t: 'tick';
			tick: Tick;
			/** Packed owner changes since the previous tick, as unsigned 32-bit numbers. */
			changes: number[];
			changesOverflow: boolean;
			players: PublicPlayer[];
			attacks: PublicAttack[];
			events: WireEvent[];
			/** FNV-1a state hash; clients compare it and request a resync on mismatch. */
			checksum: string;
	  }
	| {
			t: 'growth-mode';
			mode: GrowthMode;
			tick: Tick;
	  }
	| {
			t: 'ack';
			sequence: number;
			tick: Tick;
	  }
	| {
			t: 'reject';
			sequence: number;
			reason: AttackFailure;
			message: string;
	  }
	| {
			t: 'match-over';
			winnerId: PlayerId | null;
			finalSnapshot: WireSnapshot;
	  }
	| {
			t: 'pong';
			nonce: number;
			clientTime: number;
			serverTime: number;
	  }
	| {
			t: 'error';
			code: 'ROOM_FULL' | 'MATCH_NOT_FOUND' | 'PROTOCOL_MISMATCH' | 'RATE_LIMITED';
			message: string;
	  };

/** Helpers used by the future server and test clients. */
export function isAttackIntent(value: unknown): value is AttackIntent {
	if (!value || typeof value !== 'object') return false;
	const intent = value as Record<string, unknown>;
	return (
		intent.type === 'attack' &&
		typeof intent.sequence === 'number' &&
		Number.isSafeInteger(intent.sequence) &&
		typeof intent.x === 'number' &&
		Number.isFinite(intent.x) &&
		typeof intent.y === 'number' &&
		Number.isFinite(intent.y)
	);
}

/**
 * Chat is deliberately out of scope for v1. It needs rate limits, moderation,
 * and a persistence policy before it can join the authoritative channel.
 */
