import { MAX_UPGRADE_BATCH } from '../constants';

/** Accepted player intent. The Spacetime row carries the kind and compact payload. */
export type OnlineIntent =
	| { type: 'attack'; x: number; y: number }
	| { type: 'artillery'; x: number; y: number }
	| { type: 'naval'; x: number; y: number }
	| {
			type: 'build';
			cardId: number;
			x: number;
			y: number;
			/** Shift-build flags; online currently sends neither. */
			newStructureOnly?: boolean;
			allowTightSpacing?: boolean;
	  }
	| { type: 'upgrade'; x: number; y: number; levels: number; merged: boolean }
	| { type: 'demolish'; structureId: number }
	| { type: 'cancel-attack' }
	| { type: 'alliance-request'; targetPlayerId: number }
	| { type: 'alliance-break'; targetPlayerId: number };

export function isOnlineIntent(value: unknown): value is OnlineIntent {
	if (!value || typeof value !== 'object') return false;
	const candidate = value as Record<string, unknown>;
	if (typeof candidate.type !== 'string') return false;
	switch (candidate.type) {
		case 'attack':
		case 'artillery':
		case 'naval':
			return Number.isFinite(candidate.x) && Number.isFinite(candidate.y);
		case 'build':
			return (
				Number.isSafeInteger(candidate.cardId) &&
				Number.isFinite(candidate.x) &&
				Number.isFinite(candidate.y)
			);
		case 'upgrade':
			return (
				Number.isFinite(candidate.x) &&
				Number.isFinite(candidate.y) &&
				Number.isSafeInteger(candidate.levels) &&
				(candidate.levels as number) >= 1 &&
				(candidate.levels as number) <= MAX_UPGRADE_BATCH &&
				typeof candidate.merged === 'boolean'
			);
		case 'demolish':
			return Number.isSafeInteger(candidate.structureId);
		case 'cancel-attack':
			return true;
		case 'alliance-request':
		case 'alliance-break':
			return Number.isSafeInteger(candidate.targetPlayerId);
		default:
			return false;
	}
}
