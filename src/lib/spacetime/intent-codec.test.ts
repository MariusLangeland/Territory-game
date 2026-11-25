import { describe, expect, it } from 'vitest';
import { decodeOnlineIntent, encodeOnlineIntent } from './intent-codec';

describe('Spacetime intent codec', () => {
	it('round-trips accepted intent payloads', () => {
		const intent = { type: 'build', cardId: 3, x: 120, y: 80 } as const;
		expect(decodeOnlineIntent(encodeOnlineIntent(intent))).toEqual(intent);
	});

	it('rejects malformed or unknown payloads', () => {
		expect(decodeOnlineIntent(new Uint8Array())).toBeNull();
		expect(
			decodeOnlineIntent(new TextEncoder().encode(JSON.stringify({ type: 'unknown' })))
		).toBeNull();
	});
});
