import { describe, expect, it } from 'vitest';
import { TerritorySimulation } from './simulation';

function createSimulation(): TerritorySimulation {
	return new TerritorySimulation({
		seed: 991122,
		width: 512,
		height: 256,
		playerCount: 8,
		humanPlayerIds: [1],
		botDifficulty: 'standard',
		matchDurationTicks: 0,
		botCommandPostStacks: 0
	});
}

describe('simulation snapshots', () => {
	it('restores an authoritative tick and continues identically', () => {
		const sim = createSimulation();
		for (let tick = 0; tick < 80; tick++) sim.step();
		const snapshot = sim.captureSnapshot();
		const capturedChecksum = sim.checksum();

		for (let tick = 0; tick < 40; tick++) sim.step();
		const expected = sim.checksum();

		sim.restoreSnapshot(snapshot);
		expect(sim.tick).toBe(80);
		expect(sim.checksum()).toBe(capturedChecksum);

		for (let tick = 0; tick < 40; tick++) sim.step();
		expect(sim.checksum()).toBe(expected);
	});

	it('preserves bot, structure, and pending-command state across a restore', () => {
		const sim = createSimulation();
		for (let tick = 0; tick < 120; tick++) sim.step();
		const card = sim.hand.find((entry) => entry.type === 'command-post');
		expect(card).toBeDefined();
		if (!card) return;

		// Find one owned non-structure cell and queue a build, then snapshot with
		// the command still pending.
		const land = (sim as unknown as { land: Uint8Array }).land;
		let target = -1;
		for (let y = 0; y < sim.height && target < 0; y++) {
			for (let x = 0; x < sim.width; x++) {
				const index = y * sim.width + x;
				if (sim.owners[index] !== 1 || !land[index] || sim.structures.at(index)) continue;
				if (sim.districtStructureIds[index] !== 0) continue;
				target = index;
				break;
			}
		}
		if (target < 0) return;
		const x = target % sim.width;
		const y = Math.floor(target / sim.width);
		sim.gold = 1000;
		sim.playCard(1, card.id, x, y);
		const snapshot = sim.captureSnapshot();

		for (let tick = 0; tick < 60; tick++) sim.step();
		const expected = sim.checksum();
		sim.restoreSnapshot(snapshot);
		for (let tick = 0; tick < 60; tick++) sim.step();
		expect(sim.checksum()).toBe(expected);
	});
});
