import { describe, expect, it } from 'vitest';
import { HUMAN_PLAYER_ID, TICK_RATE } from './constants';
import { TerritorySimulation } from './simulation';
import { findAttackablePixel } from './simulation.test-helpers';

describe('elimination rewards', () => {
	it('grants the eliminating player a permanent +10 supply/s', () => {
		const sim = new TerritorySimulation({ seed: 1234 });
		const internals = sim as unknown as {
			lastAttackerOf: Uint16Array;
			updateEliminations(): void;
		};
		const killer = 2;
		const victim = 3;
		internals.lastAttackerOf[victim - 1] = killer;
		sim.players[victim - 1].territory = 0;
		const before = sim.incomeOf(killer);
		internals.updateEliminations();
		expect(sim.players[victim - 1].alive).toBe(false);
		expect(sim.incomeOf(killer)).toBe(before + 10);
		expect(sim.incomeOf(killer)).toBeGreaterThan(0);
		sim.step();
		expect(sim.incomeOf(killer)).toBeGreaterThanOrEqual(before + 10);
	});

	it('shows the human elimination reward in the HUD income', () => {
		const sim = new TerritorySimulation({ seed: 1234 });
		const internals = sim as unknown as {
			lastAttackerOf: Uint16Array;
			updateEliminations(): void;
		};
		internals.lastAttackerOf[1] = HUMAN_PLAYER_ID;
		sim.players[1].territory = 0;
		const before = sim.incomeOf(HUMAN_PLAYER_ID);
		internals.updateEliminations();
		sim.step();
		expect(sim.getSnapshot().supplyIncome).toBe(before + 10);
	});
});

describe('front supply economy', () => {
	it('pays supply for each front and regenerates it from territory', () => {
		const sim = new TerritorySimulation({ seed: 271828 });
		const target = findAttackablePixel(sim, 1);
		expect(target).not.toBeNull();
		if (!target) return;

		const startSupply = sim.getSnapshot().supply;
		expect(startSupply).toBeGreaterThanOrEqual(90);
		for (let i = 0; i < 3; i++) {
			expect(sim.enqueueAttack(1, target.x, target.y).ok).toBe(true);
		}
		const blocked = sim.enqueueAttack(1, target.x, target.y);
		expect(blocked.ok).toBe(false);
		expect(blocked.reason).toBe('no-orders');

		for (let tick = 0; tick < TICK_RATE * 5; tick++) sim.step();
		expect(sim.getSnapshot().supply).toBeGreaterThan(0);
		expect(sim.getSnapshot().supply).toBeLessThanOrEqual(sim.supplyCap(HUMAN_PLAYER_ID));
	});

	it('cancels a front and refunds its remaining strength share', () => {
		const sim = new TerritorySimulation({ seed: 24681 });
		const target = findAttackablePixel(sim, 1);
		expect(target).not.toBeNull();
		if (!target) return;
		expect(sim.enqueueAttack(1, target.x, target.y).ok).toBe(true);
		sim.step();
		const supplyBefore = sim.getSnapshot().supply;
		const cancel = sim.cancelLatestAttack(1);
		expect(cancel.ok).toBe(true);
		expect(sim.getSnapshot().attacks.some((attack) => attack.attackerId === 1)).toBe(false);
		expect(sim.getSnapshot().supply).toBeGreaterThan(supplyBefore);
	});
});

describe('all-bot supply pool', () => {
	it('uses one supply pool for player 1 in all-bot matches', () => {
		const sim = new TerritorySimulation({
			seed: 77,
			width: 640,
			height: 360,
			playerCount: 2,
			allPlayersBots: true
		});
		const internals = sim as unknown as { botGold: number[] };
		const snapshot = sim.getSnapshot();
		expect(snapshot.humanId).toBe(0);
		expect(snapshot.players[0].supply).toBe(internals.botGold[0]);
		expect(snapshot.players[0].supply).toBe(snapshot.players[1].supply);
		for (let tick = 0; tick < 200; tick++) sim.step();
		expect(sim.getSnapshot().players[0].supply).toBe(internals.botGold[0]);
	});
});
