import { describe, expect, it } from 'vitest';
import { decodeOnlineIntent, encodeOnlineIntent } from './intent-codec';

describe('Spacetime intent codec', () => {
	it('round-trips accepted intent payloads', () => {
		const intent = { type: 'build', cardId: 3, x: 120, y: 80 } as const;
		const encoded = encodeOnlineIntent(intent);
		expect(encoded).toHaveLength(6);
		expect(decodeOnlineIntent(intent.type, encoded)).toEqual({
			...intent,
			newStructureOnly: false,
			allowTightSpacing: false
		});
	});

	it('keeps compact intents small', () => {
		expect(encodeOnlineIntent({ type: 'attack', x: 123, y: 456 })).toHaveLength(4);
		expect(encodeOnlineIntent({ type: 'cancel-attack' })).toHaveLength(0);
		expect(encodeOnlineIntent({ type: 'alliance-request', targetPlayerId: 3 })).toHaveLength(1);
	});

	it('rejects malformed or unknown payloads', () => {
		expect(decodeOnlineIntent('unknown', new Uint8Array())).toBeNull();
		expect(decodeOnlineIntent('build', new Uint8Array())).toBeNull();
	});
});
