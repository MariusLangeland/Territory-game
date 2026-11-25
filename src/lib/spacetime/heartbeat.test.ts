import { describe, expect, it } from 'vitest';
import {
	CLIENT_STALE_TICKS,
	HEARTBEAT_TRANSACTION_TYPE,
	heartbeatTransaction,
	isHeartbeatTransaction,
	isLinkStale,
	shouldSendHeartbeat
} from './heartbeat';

describe('multiplayer heartbeat policy', () => {
	it('emits after ten idle ticks and resets on the heartbeat row', () => {
		expect(shouldSendHeartbeat(9, 0)).toBe(false);
		expect(shouldSendHeartbeat(10, 0)).toBe(true);
		expect(shouldSendHeartbeat(19, 10)).toBe(false);
		expect(shouldSendHeartbeat(20, 10)).toBe(true);
	});

	it('identifies empty heartbeat transactions', () => {
		const heartbeat = heartbeatTransaction(40);
		expect(heartbeat).toEqual({ type: HEARTBEAT_TRANSACTION_TYPE, tick: 40 });
		expect(isHeartbeatTransaction(heartbeat)).toBe(true);
		expect(isHeartbeatTransaction({ type: 'attack' })).toBe(false);
	});

	it('marks the link stale after two missed heartbeat windows', () => {
		expect(isLinkStale(19, 0)).toBe(false);
		expect(isLinkStale(CLIENT_STALE_TICKS, 0)).toBe(true);
		expect(isLinkStale(CLIENT_STALE_TICKS - 1, 0)).toBe(false);
	});
});
