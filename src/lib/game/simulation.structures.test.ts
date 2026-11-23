import { describe, expect, it } from 'vitest';
import { HUMAN_PLAYER_ID, PLAYER_COUNT } from './constants';
import { TerritorySimulation } from './simulation';

describe('structure demolition', () => {
	it('demolishes only owned buildable structures', () => {
		const sim = new TerritorySimulation({ seed: 1234 });
		const state = sim.structures.forOwnerType(HUMAN_PLAYER_ID, 'state');
		expect(state).toBeDefined();
		let humanCell = -1;
		for (let index = 0; index < sim.owners.length; index++) {
			if (sim.owners[index] !== HUMAN_PLAYER_ID || sim.structures.at(index)) continue;
			humanCell = index;
			break;
		}
		expect(humanCell).toBeGreaterThanOrEqual(0);
		const x = humanCell % sim.width;
		const y = Math.floor(humanCell / sim.width);
		const structure = sim.structures.create('command-post', HUMAN_PLAYER_ID, x, y, sim.width);

		expect(sim.demolishStructure(HUMAN_PLAYER_ID, state!.id).ok).toBe(false);
		const result = sim.demolishStructure(HUMAN_PLAYER_ID, structure.id);
		expect(result.ok).toBe(true);
		expect(sim.structures.byId(structure.id)).toBeDefined();
		sim.step();
		expect(sim.structures.byId(structure.id)).toBeUndefined();

		let rivalCell = -1;
		for (let index = 0; index < sim.owners.length; index++) {
			if (sim.owners[index] !== 2 || sim.structures.at(index)) continue;
			rivalCell = index;
			break;
		}
		expect(rivalCell).toBeGreaterThanOrEqual(0);
		const rivalStructure = sim.structures.create(
			'command-post',
			2,
			rivalCell % sim.width,
			Math.floor(rivalCell / sim.width),
			sim.width
		);
		expect(sim.demolishStructure(HUMAN_PLAYER_ID, rivalStructure.id).ok).toBe(false);
	});
});

describe('state structures and auras', () => {
	it('projects a +20 State aura that disappears with the structure', () => {
		const sim = new TerritorySimulation({ seed: 135790 });
		const structure = sim.structures.all.find((entry) => entry.ownerId === 1);
		expect(structure).toBeDefined();
		if (!structure) return;

		expect(sim.getAuraDefense(structure.x, structure.y)).toBe(20);
		expect(sim.getDefense(structure.x, structure.y)).toBe(
			sim.getBaseDefense(structure.x, structure.y) + 1 + 20
		);

		const internals = sim as unknown as {
			claim(index: number, newOwner: number, attackId?: number): void;
		};
		internals.claim(structure.index, 2, 777);
		expect(sim.structures.at(structure.index)).toBeUndefined();
		expect(sim.getAuraDefense(structure.x, structure.y)).toBe(0);
	});

	it('places one State structure at every state start', () => {
		const sim = new TerritorySimulation({ seed: 778899 });
		expect(sim.structures.count).toBe(PLAYER_COUNT);
		expect(sim.getSnapshot().structures).toHaveLength(PLAYER_COUNT);
		for (let i = 0; i < PLAYER_COUNT; i++) {
			const start = sim.map.starts[i];
			const structure = sim.structures.at(start.index);
			expect(structure).toBeDefined();
			expect(structure?.type).toBe('state');
			expect(structure?.ownerId).toBe(i + 1);
			expect(sim.owners[start.index]).toBe(i + 1);
		}
	});

	it('destroys a State structure when its cell is captured', () => {
		const sim = new TerritorySimulation({ seed: 889900 });
		const structure = sim.structures.all.find((entry) => entry.ownerId === 2);
		expect(structure).toBeDefined();
		if (!structure) return;

		const internals = sim as unknown as {
			claim(index: number, newOwner: number, attackId?: number): void;
		};
		internals.claim(structure.index, 1, 999);
		expect(sim.structures.at(structure.index)).toBeUndefined();
		expect(sim.getSnapshot().structures.some((entry) => entry.id === structure.id)).toBe(false);
	});
});
