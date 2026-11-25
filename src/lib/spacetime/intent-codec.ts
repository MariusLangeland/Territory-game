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

export function encodeOnlineIntent(intent: OnlineIntent): Uint8Array {
	return new TextEncoder().encode(JSON.stringify(intent));
}

export function decodeOnlineIntent(data: ArrayLike<number>): OnlineIntent | null {
	try {
		const value = JSON.parse(new TextDecoder().decode(new Uint8Array(data))) as {
			type?: unknown;
		};
		if (typeof value?.type !== 'string' || !INTENT_TYPES.has(value.type as OnlineIntent['type'])) {
			return null;
		}
		return value as OnlineIntent;
	} catch {
		return null;
	}
}
