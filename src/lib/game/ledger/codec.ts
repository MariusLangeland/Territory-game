import type { OnlineIntent } from '#lib/game/net/online-protocol';

const INTENT_TYPES = new Set<OnlineIntent['type']>([
	'attack',
	'artillery',
	'naval',
	'build',
	'upgrade',
	'demolish',
	'cancel-attack',
	'alliance-request',
	'alliance-break'
]);

const FLAG_NEW_STRUCTURE = 1;
const FLAG_TIGHT_SPACING = 2;

function u16(bytes: Uint8Array, offset: number, value: number): void {
	if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
		throw new RangeError('Intent coordinate is outside u16 range.');
	}
	new DataView(bytes.buffer).setUint16(offset, value, true);
}

function u8(bytes: Uint8Array, offset: number, value: number): void {
	if (!Number.isInteger(value) || value < 0 || value > 0xff) {
		throw new RangeError('Intent value is outside u8 range.');
	}
	bytes[offset] = value;
}

/**
 * Compact intent payload. The Spacetime row's `type` column carries the intent
 * kind, so the same byte is not repeated in `data`.
 */
export function encodeOnlineIntent(intent: OnlineIntent): Uint8Array {
	switch (intent.type) {
		case 'attack':
		case 'artillery':
		case 'naval': {
			const bytes = new Uint8Array(4);
			u16(bytes, 0, intent.x);
			u16(bytes, 2, intent.y);
			return bytes;
		}
		case 'build': {
			const bytes = new Uint8Array(6);
			u8(bytes, 0, intent.cardId);
			u16(bytes, 1, intent.x);
			u16(bytes, 3, intent.y);
			bytes[5] =
				(intent.newStructureOnly ? FLAG_NEW_STRUCTURE : 0) |
				(intent.allowTightSpacing ? FLAG_TIGHT_SPACING : 0);
			return bytes;
		}
		case 'upgrade': {
			const bytes = new Uint8Array(6);
			u16(bytes, 0, intent.x);
			u16(bytes, 2, intent.y);
			u8(bytes, 4, intent.levels);
			bytes[5] = intent.merged ? 1 : 0;
			return bytes;
		}
		case 'demolish': {
			const bytes = new Uint8Array(4);
			if (
				!Number.isInteger(intent.structureId) ||
				intent.structureId < 0 ||
				intent.structureId > 0xffffffff
			) {
				throw new RangeError('Structure id is outside u32 range.');
			}
			new DataView(bytes.buffer).setUint32(0, intent.structureId, true);
			return bytes;
		}
		case 'cancel-attack':
			return new Uint8Array(0);
		case 'alliance-request':
		case 'alliance-break': {
			const bytes = new Uint8Array(1);
			u8(bytes, 0, intent.targetPlayerId);
			return bytes;
		}
	}
}

export function decodeOnlineIntent(type: string, data: ArrayLike<number>): OnlineIntent | null {
	if (!INTENT_TYPES.has(type as OnlineIntent['type'])) return null;
	const bytes = new Uint8Array(data);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const read16 = (offset: number): number | null =>
		offset + 2 <= bytes.length ? view.getUint16(offset, true) : null;

	switch (type as OnlineIntent['type']) {
		case 'attack':
		case 'artillery':
		case 'naval': {
			const x = read16(0);
			const y = read16(2);
			const intentType = type as 'attack' | 'artillery' | 'naval';
			return x === null || y === null ? null : { type: intentType, x, y };
		}
		case 'build': {
			if (bytes.length < 6) return null;
			const cardId = bytes[0];
			const x = read16(1);
			const y = read16(3);
			if (x === null || y === null) return null;
			const flags = bytes[5];
			return {
				type: 'build',
				cardId,
				x,
				y,
				newStructureOnly: (flags & FLAG_NEW_STRUCTURE) !== 0,
				allowTightSpacing: (flags & FLAG_TIGHT_SPACING) !== 0
			};
		}
		case 'upgrade': {
			if (bytes.length < 6) return null;
			const x = read16(0);
			const y = read16(2);
			if (x === null || y === null) return null;
			return { type: 'upgrade', x, y, levels: bytes[4], merged: bytes[5] !== 0 };
		}
		case 'demolish':
			return bytes.length >= 4 ? { type: 'demolish', structureId: view.getUint32(0, true) } : null;
		case 'cancel-attack':
			return { type: 'cancel-attack' };
		case 'alliance-request':
			return bytes.length >= 1 ? { type: 'alliance-request', targetPlayerId: bytes[0] } : null;
		case 'alliance-break':
			return bytes.length >= 1 ? { type: 'alliance-break', targetPlayerId: bytes[0] } : null;
	}
}
