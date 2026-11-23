import { describe, expect, it } from 'vitest';
import { OnlineRoom } from './online-room';
import { decodeOwnerRuns } from './online-protocol';

function room(): OnlineRoom {
	return new OnlineRoom('room-test', {
		totalStates: 4,
		maxHumans: 2,
		seed: 1234,
		botDifficulty: 'standard',
		timerMinutes: 0,
		botCommandPostStacks: 0
	});
}

describe('online room', () => {
	it('assigns human seats, waits for the host, and exposes per-player baselines', () => {
		const match = room();
		const first = match.join('SABLE', 'token-one');
		const second = match.join('AURELIA', 'token-two');
		expect(first.playerId).toBe(1);
		expect(second.playerId).toBe(2);
		expect(match.currentPhase).toBe('waiting');
		expect(match.start('token-two').ok).toBe(false);
		expect(match.start('token-one').ok).toBe(true);
		expect(match.currentPhase).toBe('running');

		const firstView = match.view();
		expect(firstView.seats).toHaveLength(2);
		expect(firstView.seats[0]?.host).toBe(true);
		const baseline = match.baselineFor('token-two');
		expect(baseline.playerId).toBe(2);
		expect(baseline.snapshot.humanId).toBe(2);
		expect(baseline.snapshot.hand).toHaveLength(7);
		const owners = decodeOwnerRuns(baseline.ownerRuns, 2048 * 1024);
		expect(owners).toHaveLength(2048 * 1024);
		const sim = (match as unknown as { simulation: { owners: Uint16Array } }).simulation;
		expect(owners).toEqual(sim.owners);
	});

	it('rejects joins after start and accepts monotonic intent sequences', () => {
		const match = room();
		match.join('SABLE', 'token-one');
		match.join('AURELIA', 'token-two');
		match.start('token-one');
		expect(() => match.join('LATE', 'token-three')).toThrow();

		const accepted = match.submit('token-one', {
			sequence: 1,
			intent: { type: 'alliance-request', targetPlayerId: 3 }
		});
		expect(accepted.ok).toBe(true);
		expect(accepted.serverTick).toBe(0);
		const stale = match.submit('token-one', {
			sequence: 1,
			intent: { type: 'alliance-request', targetPlayerId: 3 }
		});
		expect(stale.ok).toBe(false);
		expect(stale.reason).toBe('stale-sequence');
		const unauthorized = match.submit('missing-token', {
			sequence: 2,
			intent: { type: 'cancel-attack' }
		});
		expect(unauthorized.ok).toBe(false);
		expect(unauthorized.reason).toBe('unauthorized');
	});

	it('advances one authoritative tick and returns a viewer-specific snapshot', () => {
		const match = room();
		match.join('SABLE', 'token-one');
		match.join('AURELIA', 'token-two');
		match.start('token-one');
		const tick = match.tickOnce();
		expect(tick).not.toBeNull();
		expect(tick?.tick).toBe(1);
		expect(tick?.snapshot.humanId).toBe(1);
		const secondTick = match.tickFor('token-two');
		expect(secondTick.tick).toBe(1);
		expect(secondTick.snapshot.humanId).toBe(2);
		expect(secondTick.checksum).toBeGreaterThan(0);
	});

	it('serves a mid-match reconnect baseline in the viewer snapshot', () => {
		const match = room();
		match.join('SABLE', 'token-one');
		match.join('AURELIA', 'token-two');
		match.start('token-one');
		for (let tick = 0; tick < 60; tick++) match.tickOnce();
		const baseline = match.baselineFor('token-two');
		expect(baseline.tick).toBe(60);
		expect(baseline.snapshot.tick).toBe(60);
		expect(baseline.snapshot.humanId).toBe(2);
		const sim = (
			match as unknown as {
				simulation: { owners: Uint16Array; width: number; height: number };
			}
		).simulation;
		const owners = decodeOwnerRuns(baseline.ownerRuns, sim.width * sim.height);
		expect(owners).toEqual(sim.owners);
	});

	it('rejects invalid configuration', () => {
		expect(
			() =>
				new OnlineRoom('bad-room', {
					totalStates: 2,
					maxHumans: 3,
					seed: 1,
					botDifficulty: 'standard',
					timerMinutes: 0,
					botCommandPostStacks: 0
				})
		).toThrow();
	});
});
