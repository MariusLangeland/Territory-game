import { describe, expect, it } from 'vitest';
import { TerritorySimulation } from './simulation';

describe('territory integrity', () => {
	it('skips integrity and pocket scans when ownership did not change', () => {
		const sim = new TerritorySimulation({ seed: 112233, playerCount: 2, allPlayersBots: true });
		const internals = sim as unknown as {
			players: Array<{ isBot: boolean }>;
			annexDisconnectedTerritory(): void;
			cleanupUnclaimedPockets(): void;
		};
		for (const player of internals.players) player.isBot = false;
		let annexCalls = 0;
		let cleanupCalls = 0;
		const annex = internals.annexDisconnectedTerritory.bind(internals);
		internals.annexDisconnectedTerritory = () => {
			annexCalls++;
			annex();
		};
		// Stub cleanup so its one-time startup pass cannot create an ownership
		// change that legitimately schedules a second annex scan.
		internals.cleanupUnclaimedPockets = () => {
			cleanupCalls++;
		};
		for (let tick = 0; tick < 150; tick++) sim.step();
		expect(annexCalls).toBe(1);
		expect(cleanupCalls).toBe(1);
	});

	it('annexes a detached pocket into the surrounding mainland', () => {
		const sim = new TerritorySimulation({ seed: 667788 });
		let pocket = -1;
		for (let y = 1; y < sim.height - 1 && pocket < 0; y++) {
			for (let x = 1; x < sim.width - 1; x++) {
				const index = y * sim.width + x;
				if (
					sim.owners[index] === 1 &&
					sim.owners[index - 1] === 1 &&
					sim.owners[index + 1] === 1 &&
					sim.owners[index - sim.width] === 1 &&
					sim.owners[index + sim.width] === 1
				) {
					pocket = index;
					break;
				}
			}
		}
		expect(pocket).toBeGreaterThan(-1);
		if (pocket < 0) return;

		sim.owners[pocket] = 2;
		(sim as unknown as { annexDisconnectedTerritory(): void }).annexDisconnectedTerritory();
		expect(sim.owners[pocket]).toBe(1);
	});

	it('queues annex transfers and applies them within a fixed budget', () => {
		const sim = new TerritorySimulation({ seed: 667788 });
		const internals = sim as unknown as {
			annexDisconnectedTerritory(queueTransfers?: boolean): void;
			applyAnnexTransfers(budget: number): void;
			annexTransferQueue: Array<{ index: number; from: number; to: number }>;
			annexTransferIndex: number;
		};
		let pocket = -1;
		for (let y = 1; y < sim.height - 1 && pocket < 0; y++) {
			for (let x = 1; x < sim.width - 1; x++) {
				const index = y * sim.width + x;
				if (
					sim.owners[index] === 1 &&
					sim.owners[index - 1] === 1 &&
					sim.owners[index + 1] === 1 &&
					sim.owners[index - sim.width] === 1 &&
					sim.owners[index + sim.width] === 1
				) {
					pocket = index;
					break;
				}
			}
		}
		expect(pocket).toBeGreaterThan(-1);
		if (pocket < 0) return;
		sim.owners[pocket] = 2;
		internals.annexDisconnectedTerritory(true);
		expect(internals.annexTransferQueue.length).toBeGreaterThan(0);
		expect(internals.annexTransferIndex).toBe(0);
		expect(sim.owners[pocket]).toBe(2);

		// Two one-cell transfers with a budget of one: the second must wait.
		const targets: number[] = [];
		for (let index = 0; index < sim.owners.length && targets.length < 2; index++) {
			if (sim.owners[index] !== 1 || sim.structures.at(index)) continue;
			targets.push(index);
		}
		expect(targets).toHaveLength(2);
		internals.annexTransferQueue = targets.map((index) => ({ index, from: 2, to: 1 }));
		internals.annexTransferIndex = 0;
		for (const index of targets) sim.owners[index] = 2;
		internals.applyAnnexTransfers(1);
		expect(sim.owners[targets[0]]).toBe(1);
		expect(sim.owners[targets[1]]).toBe(2);
		expect(internals.annexTransferIndex).toBe(1);
		internals.applyAnnexTransfers(1);
		expect(sim.owners[targets[1]]).toBe(1);
		expect(internals.annexTransferQueue).toHaveLength(0);
	});

	it('skips stale queued annex transfers whose owner changed', () => {
		const sim = new TerritorySimulation({ seed: 667788 });
		const internals = sim as unknown as {
			annexTransferQueue: Array<{ index: number; from: number; to: number }>;
			annexTransferIndex: number;
			applyAnnexTransfers(budget: number): void;
		};
		let index = -1;
		for (let candidate = 0; candidate < sim.owners.length; candidate++) {
			if (sim.owners[candidate] === 1 && !sim.structures.at(candidate)) {
				index = candidate;
				break;
			}
		}
		expect(index).toBeGreaterThan(-1);
		if (index < 0) return;
		internals.annexTransferQueue = [{ index, from: 2, to: 1 }];
		internals.annexTransferIndex = 0;
		sim.owners[index] = 3;
		internals.applyAnnexTransfers(1);
		expect(sim.owners[index]).toBe(3);
		expect(internals.annexTransferQueue).toHaveLength(0);
		expect(internals.annexTransferIndex).toBe(0);
	});
});
