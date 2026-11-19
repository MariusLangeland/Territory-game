import { describe, expect, it } from 'vitest';
import {
	BASE_GOLD_INCOME,
	HUMAN_PLAYER_ID,
	INCOME_INTERVAL_TICKS,
	REFRESH_COST,
	STARTING_GOLD,
	STRUCTURE_MIN_SPACING
} from './constants';
import { TerritorySimulation } from './simulation';
import {
	BUILDABLE_STRUCTURE_TYPES,
	DEFENSE_POST_DEFENSE,
	type BuildableStructureType
} from './Structures';

function findBuildCell(sim: TerritorySimulation): number {
	for (let i = 0; i < sim.owners.length; i++) {
		if (sim.owners[i] !== HUMAN_PLAYER_ID || !sim.terrain[i] || sim.structures.at(i)) continue;
		const x = i % sim.width;
		const y = (i - x) / sim.width;
		if (!sim.structures.hasWithinRadius(x, y, STRUCTURE_MIN_SPACING)) return i;
	}
	return -1;
}

function buildCard(
	sim: TerritorySimulation,
	type: BuildableStructureType
): { index: number; x: number; y: number } {
	const index = findBuildCell(sim);
	expect(index).toBeGreaterThan(-1);
	const x = index % sim.width;
	const y = (index - x) / sim.width;
	sim.hand = [{ id: 900 + index, type }];
	sim.gold = 10;
	const result = sim.playCard(HUMAN_PLAYER_ID, 900 + index, x, y);
	expect(result.ok).toBe(true);
	sim.step();
	return { index, x, y };
}

describe('player economy and cards', () => {
	it('starts with three buildable cards and starting gold', () => {
		const sim = new TerritorySimulation({ seed: 246810 });
		expect(sim.gold).toBe(STARTING_GOLD);
		expect(sim.hand).toHaveLength(3);
		expect(sim.getSnapshot().gold).toBe(STARTING_GOLD);
		expect(sim.getSnapshot().income).toBe(BASE_GOLD_INCOME);
		expect(sim.getSnapshot().hand).toHaveLength(3);
		for (const card of sim.hand) {
			expect(BUILDABLE_STRUCTURE_TYPES).toContain(card.type);
		}
	});

	it('pays base income every 10 seconds', () => {
		const sim = new TerritorySimulation({ seed: 135791 });
		const startGold = sim.gold;
		for (let i = 0; i < INCOME_INTERVAL_TICKS; i++) sim.step();
		expect(sim.gold).toBe(startGold + BASE_GOLD_INCOME);
	});

	it('builds a mine, spends gold, removes the card, and raises income', () => {
		const sim = new TerritorySimulation({ seed: 975310 });
		const { index } = buildCard(sim, 'mine');
		const structure = sim.structures.at(index);
		expect(structure?.type).toBe('mine');
		expect(sim.gold).toBe(7);
		expect(sim.hand).toHaveLength(0);
		expect(sim.income).toBe(BASE_GOLD_INCOME + 1);
	});

	it('refreshes the whole hand for one gold', () => {
		const sim = new TerritorySimulation({ seed: 864209 });
		const previousIds = sim.hand.map((card) => card.id);
		sim.gold = 2;
		expect(sim.refreshCards(HUMAN_PLAYER_ID).ok).toBe(true);
		sim.step();
		expect(sim.gold).toBe(2 - REFRESH_COST);
		expect(sim.hand).toHaveLength(3);
		for (const card of sim.hand) expect(previousIds).not.toContain(card.id);
	});

	it('builds a defense post and adds its aura defense', () => {
		const sim = new TerritorySimulation({ seed: 642087 });
		const index = findBuildCell(sim);
		const x = index % sim.width;
		const y = (index - x) / sim.width;
		const before = sim.getAuraDefense(x, y);
		sim.hand = [{ id: 4567, type: 'defense-post' }];
		sim.gold = 2;
		expect(sim.playCard(HUMAN_PLAYER_ID, 4567, x, y).ok).toBe(true);
		sim.step();
		expect(sim.structures.at(index)?.type).toBe('defense-post');
		expect(sim.getAuraDefense(x, y)).toBe(before + DEFENSE_POST_DEFENSE);
	});

	it('rejects structures inside the minimum spacing radius', () => {
		const sim = new TerritorySimulation({ seed: 424242 });
		const start = sim.map.starts[HUMAN_PLAYER_ID - 1];
		let blocked: { x: number; y: number } | null = null;
		for (let dy = -7; dy <= 7 && !blocked; dy++) {
			for (let dx = -7; dx <= 7; dx++) {
				const x = start.x + dx;
				const y = start.y + dy;
				const index = y * sim.width + x;
				if (sim.owners[index] !== HUMAN_PLAYER_ID) continue;
				if (sim.structures.at(index)) continue;
				if (dx * dx + dy * dy >= STRUCTURE_MIN_SPACING * STRUCTURE_MIN_SPACING) continue;
				blocked = { x, y };
				break;
			}
		}
		expect(blocked).not.toBeNull();
		if (!blocked) return;
		sim.hand = [{ id: 7001, type: 'defense-post' }];
		sim.gold = 2;
		const result = sim.playCard(HUMAN_PLAYER_ID, 7001, blocked.x, blocked.y);
		expect(result.ok).toBe(false);
		expect(result.reason).toBe('too-close');
	});

	it('razes a captured Mine and drops its income', () => {
		const sim = new TerritorySimulation({ seed: 314159 });
		const { index } = buildCard(sim, 'mine');
		expect(sim.income).toBe(BASE_GOLD_INCOME + 1);
		const internals = sim as unknown as {
			claim(index: number, newOwner: number, attackId?: number): void;
		};
		internals.claim(index, 2, 999);
		expect(sim.structures.at(index)).toBeUndefined();
		expect(sim.income).toBe(BASE_GOLD_INCOME);
	});

	it('builds a barracks that grants attack strength inside its radius', () => {
		const sim = new TerritorySimulation({ seed: 753198 });
		const { x, y } = buildCard(sim, 'barracks');
		expect(sim.getAttackStrength(HUMAN_PLAYER_ID, x, y)).toBe(1);
		expect(sim.getAttackStrength(HUMAN_PLAYER_ID, x + 19, y)).toBe(0);
	});

	it('does not let a Defense Post buff enemy-owned pixels', () => {
		const sim = new TerritorySimulation({ seed: 808080 });
		const { index: postIndex } = buildCard(sim, 'defense-post');
		const postX = postIndex % sim.width;
		const postY = (postIndex - postX) / sim.width;
		let target = -1;
		for (let dy = -7; dy <= 7 && target < 0; dy++) {
			for (let dx = -7; dx <= 7; dx++) {
				const x = postX + dx;
				const y = postY + dy;
				const index = y * sim.width + x;
				if (index === postIndex) continue;
				if (sim.owners[index] !== HUMAN_PLAYER_ID) continue;
				if (sim.terrain[index] === 0 || sim.structures.at(index)) continue;
				target = index;
				break;
			}
		}
		expect(target).toBeGreaterThan(-1);
		if (target < 0) return;
		expect(sim.getAuraDefense(target % sim.width, Math.floor(target / sim.width))).toBeGreaterThan(
			0
		);
		const internals = sim as unknown as {
			claim(index: number, newOwner: number, attackId?: number): void;
		};
		internals.claim(target, 2, 999);
		expect(sim.getAuraDefense(target % sim.width, Math.floor(target / sim.width))).toBe(0);
	});

	it('raises the attack-order cap with a War Academy', () => {
		const sim = new TerritorySimulation({ seed: 112358 });
		expect(sim.getSnapshot().attackOrderCap).toBe(3);
		buildCard(sim, 'war-academy');
		expect(sim.getSnapshot().attackOrderCap).toBe(4);
		for (let tick = 0; tick < INCOME_INTERVAL_TICKS; tick++) sim.step();
		expect(sim.getSnapshot().attackOrders).toBe(4);
	});

	it('clamps attack orders when a War Academy is razed', () => {
		const sim = new TerritorySimulation({ seed: 161803 });
		const { index } = buildCard(sim, 'war-academy');
		const internals = sim as unknown as {
			claim(index: number, newOwner: number, attackId?: number): void;
		};
		(sim as unknown as { attackOrders: number[] }).attackOrders[HUMAN_PLAYER_ID - 1] = 4;
		internals.claim(index, 2, 999);
		sim.step();
		expect(sim.getSnapshot().attackOrderCap).toBe(3);
		expect(sim.getSnapshot().attackOrders).toBe(3);
	});

	it('grants a Command Post attack order on its 60-second pulse', () => {
		const sim = new TerritorySimulation({ seed: 132134 });
		buildCard(sim, 'command-post');
		const internals = sim as unknown as {
			nextOrderBonusTick: number;
			attackOrders: number[];
		};
		internals.attackOrders[HUMAN_PLAYER_ID - 1] = 0;
		internals.nextOrderBonusTick = sim.tick + 1;
		sim.step();
		expect(sim.getSnapshot().attackOrders).toBe(1);

		internals.attackOrders[HUMAN_PLAYER_ID - 1] = 3;
		internals.nextOrderBonusTick = sim.tick + 1;
		sim.step();
		expect(sim.getSnapshot().attackOrders).toBe(3);
	});
});
