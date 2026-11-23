import { describe, expect, it } from 'vitest';
import { HUMAN_PLAYER_ID } from './constants';
import { GROWTH_MODES } from './growth';
import { TerritorySimulation } from './simulation';
import { findAttackablePixel, type BotDefenseInternals } from './simulation.test-helpers';

describe('deterministic checksums', () => {
	it('produces identical checksums for identical seeds and commands', () => {
		const left = new TerritorySimulation({ seed: 1337 });
		const right = new TerritorySimulation({ seed: 1337 });

		const target = findAttackablePixel(left, 1);
		expect(target).not.toBeNull();
		if (!target) return;

		expect(left.enqueueAttack(1, target.x, target.y).ok).toBe(true);
		expect(right.enqueueAttack(1, target.x, target.y).ok).toBe(true);

		for (let tick = 0; tick < 120; tick++) {
			left.step();
			right.step();
		}

		expect(left.checksum()).toBe(right.checksum());
		expect(left.getSnapshot().players).toEqual(right.getSnapshot().players);
	});

	it('diverges when players make different moves', () => {
		const left = new TerritorySimulation({ seed: 424242 });
		const right = new TerritorySimulation({ seed: 424242 });

		const target = findAttackablePixel(left, 1);
		expect(target).not.toBeNull();
		if (!target) return;
		left.enqueueAttack(1, target.x, target.y);
		for (let tick = 0; tick < 40; tick++) {
			left.step();
			right.step();
		}
		expect(left.checksum()).not.toBe(right.checksum());
	});

	it('keeps player territory deterministic and legitimate after combat', () => {
		const sim = new TerritorySimulation({ seed: 987654 });
		const target = findAttackablePixel(sim, 1);
		expect(target).not.toBeNull();
		if (!target) return;

		expect(sim.enqueueAttack(1, target.x, target.y).ok).toBe(true);
		for (let tick = 0; tick < 100; tick++) sim.step();

		let ownedLand = 0;
		for (let y = 0; y < sim.height; y++) {
			for (let x = 0; x < sim.width; x++) {
				const owner = sim.getOwner(x, y);
				if (owner === 0) continue;
				expect(sim.isLand(x, y)).toBe(true);
				ownedLand++;
			}
		}
		expect(ownedLand).toBe(sim.getSnapshot().claimedLand);
	});

	it('is deterministic for every growth layer', () => {
		for (const mode of GROWTH_MODES) {
			const left = new TerritorySimulation({ seed: 54321, growthMode: mode });
			const right = new TerritorySimulation({ seed: 54321, growthMode: mode });
			const target = findAttackablePixel(left, 1);
			expect(target).not.toBeNull();
			if (!target) continue;

			left.enqueueAttack(1, target.x, target.y);
			right.enqueueAttack(1, target.x, target.y);
			for (let tick = 0; tick < 25; tick++) {
				left.step();
				right.step();
			}

			expect(left.checksum()).toBe(right.checksum());
			for (const attack of left.getSnapshot().attacks) {
				expect(attack.growthMode).toBe(mode);
			}
		}
	}, 15_000);

	it('includes pending annex transfers in the checksum', () => {
		const left = new TerritorySimulation({ seed: 667788 });
		const right = new TerritorySimulation({ seed: 667788 });
		const leftInternals = left as unknown as { annexTransferQueue: Array<Record<string, number>> };
		const rightInternals = right as unknown as {
			annexTransferQueue: Array<Record<string, number>>;
		};
		leftInternals.annexTransferQueue = [{ index: 77, from: 2, to: 1 }];
		rightInternals.annexTransferQueue = [{ index: 77, from: 2, to: 1 }];
		expect(left.checksum()).toBe(right.checksum());
		rightInternals.annexTransferQueue[0].to = 3;
		expect(left.checksum()).not.toBe(right.checksum());
	});

	it('produces identical alliance state for identical runs', () => {
		const left = new TerritorySimulation({ seed: 1234, playerCount: 8 });
		const right = new TerritorySimulation({ seed: 1234, playerCount: 8 });
		expect(left.requestAlliance(HUMAN_PLAYER_ID, 2).ok).toBe(true);
		expect(right.requestAlliance(HUMAN_PLAYER_ID, 2).ok).toBe(true);
		for (let tick = 0; tick < 20; tick++) {
			left.step();
			right.step();
		}
		expect(left.getSnapshot().alliances).toEqual(right.getSnapshot().alliances);
		expect(left.checksum()).toBe(right.checksum());
	});

	it('includes bot threat state in the checksum and stays deterministic', () => {
		const left = new TerritorySimulation({ seed: 424242 });
		const right = new TerritorySimulation({ seed: 424242 });
		for (let tick = 0; tick < 200; tick++) {
			left.step();
			right.step();
		}
		expect(left.checksum()).toBe(right.checksum());

		const internals = left as unknown as BotDefenseInternals;
		const before = left.checksum();
		internals.botReserve[1] = internals.botReserve[1] + 1;
		expect(left.checksum()).not.toBe(before);
	});
});
