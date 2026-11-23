import type { BotDifficulty, GameSnapshot, SimEventKind } from '../simulation';

export interface OnlineRoomConfig {
	totalStates: number;
	maxHumans: number;
	seed: number;
	/** Online rooms default to a compact arena to keep many rooms in memory. */
	mapWidth?: number;
	mapHeight?: number;
	botDifficulty: BotDifficulty;
	timerMinutes: number;
	botCommandPostStacks: number;
}

export type OnlineRoomPhase = 'waiting' | 'running' | 'completed';

export interface OnlineSeat {
	playerId: number;
	name: string;
	host: boolean;
}

export interface OnlineRoomView {
	roomId: string;
	protocol: number;
	phase: OnlineRoomPhase;
	config: OnlineRoomConfig;
	seats: OnlineSeat[];
	hostPlayerId: number;
	tick: number;
	checksum: number | null;
	winnerId: number | null;
}

export type OnlineIntent =
	| { type: 'attack'; x: number; y: number }
	| { type: 'artillery'; x: number; y: number }
	| { type: 'naval'; x: number; y: number }
	| { type: 'build'; cardId: number; x: number; y: number }
	| { type: 'upgrade'; x: number; y: number; levels: number; merged: boolean }
	| { type: 'demolish'; structureId: number }
	| { type: 'cancel-attack' }
	| { type: 'alliance-request'; targetPlayerId: number }
	| { type: 'alliance-break'; targetPlayerId: number };

export interface OnlineIntentEnvelope {
	sequence: number;
	intent: OnlineIntent;
}

export interface OnlineIntentResult {
	ok: boolean;
	sequence: number;
	reason?: string;
	message: string;
	serverTick: number;
}

export interface OnlineOwnerRun {
	owner: number;
	count: number;
}

export interface OnlineBaseline {
	protocol: number;
	playerId: number;
	tick: number;
	config: OnlineRoomConfig;
	snapshot: GameSnapshot;
	ownerRuns: OnlineOwnerRun[];
	districtColorRuns: OnlineOwnerRun[];
	/** Legacy baseline placeholders retained for wire compatibility. */
	districtTileColors: number[];
	districtTiles: number[];
	checksum: number;
}

export interface OnlineWireEvent {
	tick: number;
	kind: SimEventKind;
	message: string;
	playerId?: number;
}

export interface OnlineTick {
	protocol: number;
	tick: number;
	changes: number[];
	changesOverflow: boolean;
	districtTiles: number[];
	districtTileColors: number[];
	snapshot: GameSnapshot;
	events: OnlineWireEvent[];
	checksum: number;
	/** Present on the final authoritative tick. */
	winnerId?: number | null;
}

export interface OnlineJoinResponse {
	roomId: string;
	playerId: number;
	token: string;
	room: OnlineRoomView;
}

export interface OnlineRoomListEntry {
	roomId: string;
	phase: OnlineRoomPhase;
	humanCount: number;
	maxHumans: number;
	totalStates: number;
}

/** RLE keeps the 2M-cell owner baseline compact enough for JSON. */
export function encodeOwnerRuns(owners: Uint16Array): OnlineOwnerRun[] {
	const runs: OnlineOwnerRun[] = [];
	let owner = owners[0] ?? 0;
	let count = 0;
	for (let index = 0; index < owners.length; index++) {
		const next = owners[index] ?? 0;
		if (next !== owner) {
			runs.push({ owner, count });
			owner = next;
			count = 0;
		}
		count++;
	}
	runs.push({ owner, count });
	return runs;
}

export function encodeByteRuns(values: Uint8Array): OnlineOwnerRun[] {
	const runs: OnlineOwnerRun[] = [];
	let owner = values[0] ?? 0;
	let count = 0;
	for (let index = 0; index < values.length; index++) {
		const next = values[index] ?? 0;
		if (next !== owner) {
			runs.push({ owner, count });
			owner = next;
			count = 0;
		}
		count++;
	}
	runs.push({ owner, count });
	return runs;
}

export function decodeByteRuns(runs: readonly OnlineOwnerRun[], length: number): Uint8Array {
	const values = new Uint8Array(length);
	let offset = 0;
	for (const run of runs) {
		const count = Math.max(0, Math.trunc(run.count));
		const owner = Math.max(0, Math.min(255, Math.trunc(run.owner)));
		const end = Math.min(length, offset + count);
		values.fill(owner, offset, end);
		offset = end;
		if (offset >= length) break;
	}
	return values;
}

export function decodeOwnerRuns(runs: readonly OnlineOwnerRun[], length: number): Uint16Array {
	const owners = new Uint16Array(length);
	let offset = 0;
	for (const run of runs) {
		const count = Math.max(0, Math.trunc(run.count));
		const owner = Math.max(0, Math.trunc(run.owner));
		const end = Math.min(length, offset + count);
		owners.fill(owner, offset, end);
		offset = end;
		if (offset >= length) break;
	}
	return owners;
}

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
				(candidate.levels as number) <= 5 &&
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
