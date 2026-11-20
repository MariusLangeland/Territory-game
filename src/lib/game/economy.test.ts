import { describe, expect, it } from 'vitest';
import {
	BASE_GOLD_INCOME,
	DISTRICT_NOISE_MARGIN,
	HUMAN_PLAYER_ID,
	INCOME_INTERVAL_TICKS,
	RENDER_TILE_SIZE,
	STARTING_GOLD,
	STRUCTURE_MIN_SPACING,
	TICK_RATE
} from './constants';
import { TerritorySimulation } from './simulation';
import {
	BUILDABLE_STRUCTURE_TYPES,
	DEFENSE_POST_DEFENSE,
	STRUCTURE_DEFINITIONS,
	STRUCTURE_TYPE_CODES,
	type BuildableStructureType
} from './Structures';

function findBuildCell(sim: TerritorySimulation): number {
	for (let i = 0; i < sim.owners.length; i++) {
		if (sim.owners[i] !== HUMAN_PLAYER_ID || !sim.terrain[i] || sim.structures.at(i)) continue;
		const x = i % sim.width;
		const y = (i - x) / sim.width;
		if (sim.getDistrictType(x, y) !== 0) continue;
		if (!sim.structures.hasWithinRadius(x, y, STRUCTURE_MIN_SPACING)) return i;
	}
	return -1;
}

function findDistrictCell(sim: TerritorySimulation, code: number): number {
	for (let i = 0; i < sim.owners.length; i++) {
		if (sim.owners[i] !== HUMAN_PLAYER_ID || !sim.terrain[i] || sim.structures.at(i)) continue;
		const x = i % sim.width;
		const y = (i - x) / sim.width;
		if (sim.getDistrictType(x, y) === code) return i;
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
	sim.gold = STRUCTURE_DEFINITIONS[type].cost + 20;
	const result = sim.playCard(HUMAN_PLAYER_ID, 900 + index, x, y);
	expect(result.ok).toBe(true);
	sim.step();
	return { index, x, y };
}

describe('player economy and cards', () => {
	it('starts with every buildable card and starting gold', () => {
		const sim = new TerritorySimulation({ seed: 246810 });
		expect(sim.gold).toBe(STARTING_GOLD);
		expect(sim.hand).toHaveLength(BUILDABLE_STRUCTURE_TYPES.length);
		expect(sim.getSnapshot().gold).toBe(STARTING_GOLD);
		expect(sim.getSnapshot().income).toBe(BASE_GOLD_INCOME);
		expect(sim.getSnapshot().hand.map((card) => card.type)).toEqual(BUILDABLE_STRUCTURE_TYPES);
	});

	it('pays base supply income every second and respects the cap', () => {
		const sim = new TerritorySimulation({ seed: 135791 });
		const cap = sim.supplyCap(HUMAN_PLAYER_ID);
		for (let i = 0; i < TICK_RATE; i++) sim.step();
		expect(sim.gold).toBe(Math.min(cap, STARTING_GOLD + BASE_GOLD_INCOME));
		for (let i = 0; i < INCOME_INTERVAL_TICKS; i++) sim.step();
		expect(sim.gold).toBe(cap);
	});

	it('artillery is an active ability, not passive income', () => {
		const sim = new TerritorySimulation({ seed: 135792 });
		buildCard(sim, 'artillery');
		const internals = sim as unknown as { goldAccrual: number };
		sim.gold = 0;
		internals.goldAccrual = 0;
		for (let i = 0; i < TICK_RATE; i++) sim.step();
		expect(sim.gold).toBe(BASE_GOLD_INCOME);
		expect(sim.income).toBe(BASE_GOLD_INCOME);
	});

	it('perturbs district edges with deterministic noise', () => {
		const sim = new TerritorySimulation({ seed: 864211 });
		const { index } = buildCard(sim, 'artillery');
		const structure = sim.structures.at(index);
		expect(structure).toBeDefined();
		if (!structure) return;
		const internals = sim as unknown as {
			claim(index: number, newOwner: number, attackId?: number): void;
		};
		let inside = 0;
		let outside = 0;
		for (let dy = -34; dy <= 34; dy++) {
			for (let dx = -34; dx <= 34; dx++) {
				const distanceSq = dx * dx + dy * dy;
				if (distanceSq <= 32 * 32 || distanceSq >= 34 * 34) continue;
				const x = structure.x + dx;
				const y = structure.y + dy;
				if (x < 0 || y < 0 || x >= sim.width || y >= sim.height) continue;
				const target = y * sim.width + x;
				if (!sim.terrain[target] || sim.structures.at(target)) continue;
				internals.claim(target, HUMAN_PLAYER_ID, 999);
				if (sim.getDistrictStructureId(x, y) === structure.id) inside++;
				else outside++;
			}
		}
		expect(inside).toBeGreaterThan(0);
		expect(outside).toBeGreaterThan(0);
	});

	it('upgrades a district by clicking anywhere inside it', () => {
		const sim = new TerritorySimulation({ seed: 246813 });
		const { index } = buildCard(sim, 'artillery');
		const structure = sim.structures.at(index);
		expect(structure?.stacks).toBe(1);
		const target = findDistrictCell(sim, STRUCTURE_TYPE_CODES.artillery);
		expect(target).toBeGreaterThan(-1);
		if (target < 0) return;
		sim.gold = 100;
		const result = sim.upgradeDistrict(
			HUMAN_PLAYER_ID,
			target % sim.width,
			Math.floor(target / sim.width)
		);
		expect(result.ok).toBe(true);
		sim.step();
		expect(sim.structures.at(index)?.stacks).toBe(2);
		expect(sim.gold).toBe(69);

		sim.gold = 100;
		expect(
			sim.upgradeDistrict(HUMAN_PLAYER_ID, target % sim.width, Math.floor(target / sim.width)).ok
		).toBe(true);
		sim.step();
		expect(sim.structures.at(index)?.stacks).toBe(3);
		expect(sim.gold).toBeGreaterThanOrEqual(68);
	});

	it('reserves the projected cost of multiple queued upgrades', () => {
		const sim = new TerritorySimulation({ seed: 246814 });
		const { index } = buildCard(sim, 'artillery');
		const target = findDistrictCell(sim, STRUCTURE_TYPE_CODES.artillery);
		expect(target).toBeGreaterThan(-1);
		if (target < 0) return;
		const x = target % sim.width;
		const y = Math.floor(target / sim.width);
		sim.gold = 40;
		expect(sim.upgradeDistrict(HUMAN_PLAYER_ID, x, y).ok).toBe(true);
		expect(sim.upgradeDistrict(HUMAN_PLAYER_ID, x, y).ok).toBe(false);
		sim.step();
		expect(sim.structures.at(index)?.stacks).toBe(2);
		expect(sim.gold).toBe(9);
	});

	it('reports district dirty tiles instead of forcing a full rebuild', () => {
		const sim = new TerritorySimulation({ seed: 864209 });
		const cell = findBuildCell(sim);
		const x = cell % sim.width;
		const y = (cell - x) / sim.width;
		sim.gold = 40;
		const artilleryCard = sim.hand.find((card) => card.type === 'artillery');
		expect(artilleryCard).toBeDefined();
		if (!artilleryCard) return;
		expect(sim.playCard(HUMAN_PLAYER_ID, artilleryCard.id, x, y).ok).toBe(true);
		const result = sim.step();
		expect(result.districtsChanged).toBe(true);
		expect(result.districtTiles.length).toBeGreaterThan(0);
		const tilesX = Math.ceil(sim.width / RENDER_TILE_SIZE);
		const tilesY = Math.ceil(sim.height / RENDER_TILE_SIZE);
		for (const tile of result.districtTiles) {
			expect(tile).toBeGreaterThanOrEqual(0);
			expect(tile).toBeLessThan(tilesX * tilesY);
		}
	});

	it('builds artillery, spends supply, keeps the card, and adds no passive income', () => {
		const sim = new TerritorySimulation({ seed: 975310 });
		const { index } = buildCard(sim, 'artillery');
		const structure = sim.structures.at(index);
		expect(structure?.type).toBe('artillery');
		expect(sim.gold).toBe(20);
		expect(sim.hand).toHaveLength(1);
		expect(sim.income).toBe(BASE_GOLD_INCOME);
	});

	it('forms bounded, non-overlapping owner districts', () => {
		const sim = new TerritorySimulation({ seed: 515151 });
		buildCard(sim, 'artillery');
		for (let i = 0; i < sim.districtTypes.length; i++) {
			const code = sim.districtTypes[i];
			if (code === 0) continue;
			const owner = sim.owners[i];
			expect(owner).toBeGreaterThan(0);
			if (owner !== HUMAN_PLAYER_ID) continue;
			const structureId = sim.districtStructureIds[i];
			expect(structureId).toBeGreaterThan(0);
			const structure = sim.structures.byId(structureId);
			expect(structure).toBeDefined();
			if (!structure) continue;
			expect(structure.ownerId).toBe(owner);
			expect(STRUCTURE_TYPE_CODES[structure.type]).toBe(code);
			const x = i % sim.width;
			const y = (i - x) / sim.width;
			const dx = x - structure.x;
			const dy = y - structure.y;
			const range = STRUCTURE_DEFINITIONS[structure.type].districtRange + DISTRICT_NOISE_MARGIN;
			expect(dx * dx + dy * dy).toBeLessThanOrEqual(range * range);
		}
	});

	it('stacks the same structure type inside its district', () => {
		const sim = new TerritorySimulation({ seed: 616161 });
		const { index } = buildCard(sim, 'artillery');
		const structure = sim.structures.at(index);
		expect(structure?.stacks).toBe(1);
		sim.hand = [{ id: 8801, type: 'artillery' }];
		sim.gold = 3;
		const tooPoor = sim.playCard(
			HUMAN_PLAYER_ID,
			8801,
			index % sim.width,
			Math.floor(index / sim.width)
		);
		expect(tooPoor.ok).toBe(false);
		expect(tooPoor.reason).toBe('no-gold');

		sim.gold = 40;
		const result = sim.playCard(
			HUMAN_PLAYER_ID,
			8801,
			index % sim.width,
			Math.floor(index / sim.width)
		);
		expect(result.ok).toBe(true);
		sim.step();
		expect(
			sim.structures.all.filter(
				(entry) => entry.type === 'artillery' && entry.ownerId === HUMAN_PLAYER_ID
			)
		).toHaveLength(1);
		expect(sim.structures.at(index)?.stacks).toBe(2);
		expect(sim.gold).toBe(9);
		expect(sim.income).toBe(BASE_GOLD_INCOME);

		const other = findDistrictCell(sim, STRUCTURE_TYPE_CODES.artillery);
		expect(other).toBeGreaterThan(-1);
		if (other < 0) return;
		const x = other % sim.width;
		const y = (other - x) / sim.width;
		sim.hand = [{ id: 8802, type: 'defense-post' }];
		sim.gold = 10;
		const blocked = sim.playCard(HUMAN_PLAYER_ID, 8802, x, y);
		expect(blocked.ok).toBe(false);
		expect(blocked.reason).toBe('inside-district');
	});

	it('keeps cards available for repeat purchases', () => {
		const sim = new TerritorySimulation({ seed: 864209 });
		const artilleryCard = sim.hand.find((card) => card.type === 'artillery');
		expect(artilleryCard).toBeDefined();
		if (!artilleryCard) return;
		const cell = findBuildCell(sim);
		const x = cell % sim.width;
		const y = (cell - x) / sim.width;
		sim.gold = 40;
		expect(sim.playCard(HUMAN_PLAYER_ID, artilleryCard.id, x, y).ok).toBe(true);
		sim.step();
		expect(sim.hand.map((card) => card.id)).toContain(artilleryCard.id);
		expect(sim.gold).toBe(10);
		sim.gold = 40;
		expect(sim.playCard(HUMAN_PLAYER_ID, artilleryCard.id, x, y).ok).toBe(true);
		sim.step();
		expect(sim.structures.at(cell)?.stacks).toBe(2);
		expect(sim.hand).toHaveLength(BUILDABLE_STRUCTURE_TYPES.length);
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

	it('applies a Defense Post aura across its entire district', () => {
		const sim = new TerritorySimulation({ seed: 642088 });
		const { index: postIndex } = buildCard(sim, 'defense-post');
		const postX = postIndex % sim.width;
		const postY = (postIndex - postX) / sim.width;
		let target = -1;
		for (let dy = -35; dy <= 35 && target < 0; dy++) {
			for (let dx = -35; dx <= 35; dx++) {
				const distance = dx * dx + dy * dy;
				if (distance < 20 * 20 || distance > 35 * 35) continue;
				const x = postX + dx;
				const y = postY + dy;
				if (x < 0 || y < 0 || x >= sim.width || y >= sim.height) continue;
				const index = y * sim.width + x;
				if (!sim.terrain[index] || sim.structures.at(index)) continue;
				target = index;
				break;
			}
		}
		expect(target).toBeGreaterThan(-1);
		if (target < 0) return;

		const internals = sim as unknown as {
			claim(index: number, newOwner: number, attackId?: number): void;
		};
		internals.claim(target, HUMAN_PLAYER_ID, 999);
		const x = target % sim.width;
		const y = (target - x) / sim.width;
		expect(sim.getDistrictStructureId(x, y)).toBe(sim.structures.at(postIndex)?.id);
		expect(sim.getAuraDefense(x, y)).toBe(DEFENSE_POST_DEFENSE);

		let outside = -1;
		for (let dy = -50; dy <= 50 && outside < 0; dy++) {
			for (let dx = -50; dx <= 50; dx++) {
				if (dx * dx + dy * dy < 48 * 48) continue;
				const ox = postX + dx;
				const oy = postY + dy;
				if (ox < 0 || oy < 0 || ox >= sim.width || oy >= sim.height) continue;
				const index = oy * sim.width + ox;
				if (!sim.terrain[index] || sim.structures.at(index)) continue;
				outside = index;
				break;
			}
		}
		expect(outside).toBeGreaterThan(-1);
		if (outside < 0) return;
		internals.claim(outside, HUMAN_PLAYER_ID, 1000);
		const outsideX = outside % sim.width;
		const outsideY = (outside - outsideX) / sim.width;
		expect(sim.getDistrictStructureId(outsideX, outsideY)).toBe(0);
		expect(sim.getAuraDefense(outsideX, outsideY)).toBe(0);
	});

	it('multiplies a Defense Post aura when stacked', () => {
		const sim = new TerritorySimulation({ seed: 727272 });
		const { index } = buildCard(sim, 'defense-post');
		const x = index % sim.width;
		const y = (index - x) / sim.width;
		const before = sim.getAuraDefense(x, y);
		sim.hand = [{ id: 9901, type: 'defense-post' }];
		sim.gold = 10;
		expect(sim.playCard(HUMAN_PLAYER_ID, 9901, x, y).ok).toBe(true);
		sim.step();
		expect(sim.structures.at(index)?.stacks).toBe(2);
		expect(sim.getAuraDefense(x, y)).toBe(before + DEFENSE_POST_DEFENSE);
	});

	it('rejects a different structure inside an existing district', () => {
		const sim = new TerritorySimulation({ seed: 424242 });
		buildCard(sim, 'artillery');
		const blocked = findDistrictCell(sim, STRUCTURE_TYPE_CODES.artillery);
		expect(blocked).toBeGreaterThan(-1);
		if (blocked < 0) return;
		sim.hand = [{ id: 7001, type: 'defense-post' }];
		sim.gold = 2;
		const result = sim.playCard(
			HUMAN_PLAYER_ID,
			7001,
			blocked % sim.width,
			Math.floor(blocked / sim.width)
		);
		expect(result.ok).toBe(false);
		expect(result.reason).toBe('inside-district');
	});

	it('allows another district of the same structure type outside the first', () => {
		const sim = new TerritorySimulation({ seed: 919191 });
		const first = buildCard(sim, 'artillery');
		const internals = sim as unknown as {
			claim(index: number, newOwner: number, attackId?: number): void;
		};
		let secondIndex = -1;
		for (let i = 0; i < sim.owners.length; i++) {
			if (!sim.terrain[i] || sim.structures.at(i)) continue;
			const x = i % sim.width;
			const y = (i - x) / sim.width;
			const dx = x - (first.index % sim.width);
			const dy = y - Math.floor(first.index / sim.width);
			if (dx * dx + dy * dy <= 40 * 40) continue;
			if (sim.getDistrictType(x, y) !== 0) continue;
			internals.claim(i, HUMAN_PLAYER_ID, 999);
			secondIndex = i;
			break;
		}
		expect(secondIndex).toBeGreaterThan(-1);
		if (secondIndex < 0) return;
		sim.hand = [{ id: 8803, type: 'artillery' }];
		sim.gold = 40;
		const result = sim.playCard(
			HUMAN_PLAYER_ID,
			8803,
			secondIndex % sim.width,
			Math.floor(secondIndex / sim.width)
		);
		expect(result.ok).toBe(true);
		sim.step();
		const artilleryCards = sim.structures.all.filter(
			(entry) => entry.type === 'artillery' && entry.ownerId === HUMAN_PLAYER_ID
		);
		expect(artilleryCards).toHaveLength(2);
		expect(
			sim.getDistrictStructureId(secondIndex % sim.width, Math.floor(secondIndex / sim.width))
		).not.toBe(sim.structures.at(first.index)?.id);
	});

	it('razes captured artillery', () => {
		const sim = new TerritorySimulation({ seed: 314159 });
		const { index } = buildCard(sim, 'artillery');
		const internals = sim as unknown as {
			claim(index: number, newOwner: number, attackId?: number): void;
		};
		internals.claim(index, 2, 999);
		expect(sim.structures.at(index)).toBeUndefined();
		expect(sim.income).toBe(BASE_GOLD_INCOME);
	});

	it('builds a barracks that adds an extra order to attacks', () => {
		const sim = new TerritorySimulation({ seed: 753198 });
		expect(sim.getAttackOrderStrength(HUMAN_PLAYER_ID)).toBe(1);
		const { index } = buildCard(sim, 'barracks');
		expect(sim.getAttackOrderStrength(HUMAN_PLAYER_ID)).toBe(2);
		sim.gold = 30;
		expect(
			sim.upgradeDistrict(HUMAN_PLAYER_ID, index % sim.width, Math.floor(index / sim.width)).ok
		).toBe(true);
		sim.step();
		expect(sim.getAttackOrderStrength(HUMAN_PLAYER_ID)).toBe(2);
		sim.gold = 30;
		expect(
			sim.upgradeDistrict(HUMAN_PLAYER_ID, index % sim.width, Math.floor(index / sim.width)).ok
		).toBe(true);
		sim.step();
		expect(sim.getAttackOrderStrength(HUMAN_PLAYER_ID)).toBe(3);

		const structure = sim.structures.at(index);
		if (structure) structure.stacks = 20;
		expect(sim.getAttackOrderStrength(HUMAN_PLAYER_ID)).toBe(6);
	});

	it('does not let a Defense Post buff enemy-owned pixels', () => {
		const sim = new TerritorySimulation({ seed: 808080 });
		const { index: postIndex } = buildCard(sim, 'defense-post');
		const postX = postIndex % sim.width;
		const postY = (postIndex - postX) / sim.width;
		let target = -1;
		for (let dy = -15; dy <= 15 && target < 0; dy++) {
			for (let dx = -15; dx <= 15; dx++) {
				const x = postX + dx;
				const y = postY + dy;
				const index = y * sim.width + x;
				if (index === postIndex) continue;
				if (sim.owners[index] !== HUMAN_PLAYER_ID) continue;
				if (sim.terrain[index] === 0 || sim.structures.at(index)) continue;
				if (sim.getDistrictType(x, y) !== STRUCTURE_TYPE_CODES['defense-post']) continue;
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

	it('raises the supply cap with a War Academy', () => {
		const sim = new TerritorySimulation({ seed: 112358 });
		const baseCap = sim.supplyCap(HUMAN_PLAYER_ID);
		buildCard(sim, 'war-academy');
		expect(sim.supplyCap(HUMAN_PLAYER_ID)).toBe(baseCap + 40);
	});

	it('clamps supply when a War Academy is razed', () => {
		const sim = new TerritorySimulation({ seed: 161803 });
		const baseCap = sim.supplyCap(HUMAN_PLAYER_ID);
		const { index } = buildCard(sim, 'war-academy');
		const raisedCap = sim.supplyCap(HUMAN_PLAYER_ID);
		expect(raisedCap).toBe(baseCap + 40);
		sim.gold = raisedCap;
		const internals = sim as unknown as {
			claim(index: number, newOwner: number, attackId?: number): void;
		};
		internals.claim(index, 2, 999);
		sim.step();
		expect(sim.supplyCap(HUMAN_PLAYER_ID)).toBe(baseCap);
		expect(sim.gold).toBeLessThanOrEqual(baseCap);
	});

	it('adds Command Post supply income continuously', () => {
		const sim = new TerritorySimulation({ seed: 132134 });
		buildCard(sim, 'command-post');
		const internals = sim as unknown as { goldAccrual: number };
		sim.gold = 0;
		internals.goldAccrual = 0;
		for (let i = 0; i < TICK_RATE; i++) sim.step();
		expect(sim.gold).toBe(BASE_GOLD_INCOME + 2);
	});
});
