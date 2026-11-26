import { describe, expect, it } from 'vitest';
import { HUMAN_PLAYER_ID, PLAYER_COUNT, STARTING_GOLD } from './constants';
import { TerritorySimulation } from './simulation';
import { STRUCTURE_DEFINITIONS } from './structures';

describe('snapshots and seats', () => {
	it('exposes current supply for every state in snapshots', () => {
		const sim = new TerritorySimulation({ seed: 424242 });
		for (let tick = 0; tick < 10; tick++) sim.step();
		const snapshot = sim.getSnapshot();
		const internals = sim as unknown as { botGold: number[] };
		expect(snapshot.players).toHaveLength(PLAYER_COUNT);
		expect(snapshot.players[HUMAN_PLAYER_ID - 1].supply).toBe(sim.gold);
		for (const player of snapshot.players) {
			expect(Number.isInteger(player.supply)).toBe(true);
			expect(player.supply).toBeGreaterThanOrEqual(0);
			expect(Number.isInteger(player.attacksAffordable)).toBe(true);
			expect(player.attacksAffordable).toBeGreaterThanOrEqual(0);
		}
		expect(snapshot.players[1].supply).toBe(internals.botGold[1]);
		const launchCost = sim.getAttackStats(2, HUMAN_PLAYER_ID).cost;
		expect(snapshot.players[1].attacksAffordable).toBe(
			Math.floor(snapshot.players[1].supply / launchCost)
		);
	});

	it('keeps independent human economies, hands, and viewer snapshots', () => {
		const sim = new TerritorySimulation({
			seed: 1234,
			playerCount: 6,
			humanPlayerIds: [1, 4]
		});
		expect(sim.humanPlayerIds).toEqual([1, 4]);
		expect(sim.players.map((player) => player.isBot)).toEqual([
			false,
			true,
			true,
			false,
			true,
			true
		]);
		const first = sim.getSnapshot(1);
		const fourth = sim.getSnapshot(4);
		expect(first.humanId).toBe(1);
		expect(fourth.humanId).toBe(4);
		expect(first.hand).toHaveLength(7);
		expect(fourth.hand).toHaveLength(7);
		expect(first.gold).toBe(STARTING_GOLD);
		expect(fourth.gold).toBe(STARTING_GOLD);
		expect(fourth.players[3].supply).toBe(STARTING_GOLD);

		const start = sim.map.starts[3];
		let buildIndex = -1;
		for (let index = 0; index < sim.owners.length && buildIndex < 0; index++) {
			if (sim.owners[index] !== 4 || sim.structures.at(index)) continue;
			const x = index % sim.width;
			const y = (index - x) / sim.width;
			if ((x - start.x) ** 2 + (y - start.y) ** 2 >= 9 * 9) buildIndex = index;
		}
		expect(buildIndex).toBeGreaterThan(-1);
		if (buildIndex < 0) return;
		const card = fourth.hand.find((entry) => entry.type === 'fortification');
		expect(card).toBeDefined();
		if (!card) return;
		const x = buildIndex % sim.width;
		const y = (buildIndex - x) / sim.width;
		expect(sim.playCard(4, card.id, x, y).ok).toBe(true);
		sim.step();
		expect(sim.getSnapshot(1).gold).toBe(STARTING_GOLD);
		expect(sim.getSnapshot(4).gold).toBe(STARTING_GOLD - STRUCTURE_DEFINITIONS.fortification.cost);
		expect(sim.structures.forOwner(4).some((structure) => structure.type === 'fortification')).toBe(
			true
		);
	});

	it('defaults to seat 1 when humanPlayerIds is omitted', () => {
		const sim = new TerritorySimulation({ seed: 1234, playerCount: 4 });
		expect(sim.humanPlayerIds).toEqual([1]);
		expect(sim.getSnapshot().humanId).toBe(1);
	});

	it('uses the configured viewer seat for default snapshots', () => {
		const sim = new TerritorySimulation({
			seed: 1234,
			playerCount: 4,
			humanPlayerIds: [1, 2],
			viewerPlayerId: 2
		});
		const snapshot = sim.getSnapshot();
		expect(snapshot.humanId).toBe(2);
		expect(snapshot.players[1].isBot).toBe(false);
		expect(snapshot.gold).toBe(snapshot.players[1].supply);
	});
});
