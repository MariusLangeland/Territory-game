import { describe, expect, it } from 'vitest';
import { HUMAN_PLAYER_ID } from './constants';
import { TerritorySimulation, type AttackState } from './simulation';
import { STRUCTURE_DEFINITIONS } from './Structures';

function findShore(sim: TerritorySimulation, ownerId: number, maxDistance = 0) {
	const state = sim.structures.forOwnerType(ownerId, 'state');
	if (!state) return null;
	let best: { index: number; distance: number } | null = null;
	for (let index = 0; index < sim.owners.length; index++) {
		if (sim.owners[index] !== ownerId) continue;
		const x = index % sim.width;
		const y = Math.floor(index / sim.width);
		if (!sim.isShore(x, y)) continue;
		const distance = Math.abs(x - state.x) + Math.abs(y - state.y);
		if (maxDistance > 0 && distance > maxDistance) continue;
		if (!best || distance < best.distance || (distance === best.distance && index < best.index)) {
			best = { index, distance };
		}
	}
	return best;
}

describe('ports and naval landings', () => {
	it('requires a Port before launching a landing', () => {
		const sim = new TerritorySimulation({ seed: 1234 });
		let target = -1;
		for (let index = 0; index < sim.owners.length; index++) {
			if (sim.owners[index] === 2) continue;
			const x = index % sim.width;
			const y = Math.floor(index / sim.width);
			if (!sim.isShore(x, y)) continue;
			if (sim.structures.at(index)) continue;
			target = index;
			break;
		}
		expect(target).toBeGreaterThan(-1);
		const result = sim.validateNavalAttack(2, target % sim.width, Math.floor(target / sim.width));
		expect(result.ok).toBe(false);
		expect(result.reason).toBe('no-port');
	});

	it('lands a boat, claims a beachhead, and auto-builds a Port', () => {
		const sim = new TerritorySimulation({ seed: 1234 });
		const source = findShore(sim, 2);
		expect(source).not.toBeNull();
		if (!source) return;
		const port = sim.structures.create(
			'port',
			2,
			source.index % sim.width,
			Math.floor(source.index / sim.width),
			sim.width
		);
		expect(port.type).toBe('port');
		(sim as unknown as { botGold: number[] }).botGold[1] = 1000;

		let target = -1;
		for (let index = 0; index < sim.owners.length; index++) {
			if (sim.owners[index] === 2 || sim.structures.at(index)) continue;
			const x = index % sim.width;
			const y = Math.floor(index / sim.width);
			if (!sim.isShore(x, y)) continue;
			if (Math.abs(x - port.x) + Math.abs(y - port.y) > 8) continue;
			if (sim.validateNavalAttack(2, x, y).ok) {
				target = index;
				break;
			}
		}
		expect(target).toBeGreaterThan(-1);
		if (target < 0) return;
		const targetOwner = sim.owners[target];
		const cost = (
			sim as unknown as { navalSupplyCost: (playerId: number, targetIndex: number) => number }
		).navalSupplyCost(2, target);
		expect(cost).toBe(sim.getAttackStats(2, targetOwner).cost + STRUCTURE_DEFINITIONS.port.cost);

		const queued = sim.enqueueNavalAttack(2, target % sim.width, Math.floor(target / sim.width));
		expect(queued.ok).toBe(true);
		const internals = sim as unknown as { navalLandings: unknown[]; attacks: AttackState[] };
		sim.step();
		expect(internals.navalLandings.length).toBe(1);
		for (let tick = 0; tick < 400 && internals.navalLandings.length > 0; tick++) sim.step();
		expect(internals.navalLandings.length).toBe(0);
		expect(sim.owners[target]).toBe(2);
		const ports = sim.structures.forOwner(2).filter((structure) => structure.type === 'port');
		expect(ports.length).toBeGreaterThanOrEqual(2);
	});

	it('anchors a Port whose land component reaches the State', () => {
		const sim = new TerritorySimulation({ seed: 1234 });
		const source = findShore(sim, 2);
		expect(source).not.toBeNull();
		if (!source) return;
		const port = sim.structures.create(
			'port',
			2,
			source.index % sim.width,
			Math.floor(source.index / sim.width),
			sim.width
		);
		const anchors = (
			sim as unknown as {
				protectedPortAnchors: () => Array<{ index: number; ownerId: number }>;
			}
		).protectedPortAnchors();
		expect(anchors).toContainEqual({ index: port.index, ownerId: 2 });
	});

	it('rejects Port construction on inland ground', () => {
		const sim = new TerritorySimulation({ seed: 1234 });
		const capital = sim.structures.forOwnerType(HUMAN_PLAYER_ID, 'state');
		expect(capital).toBeDefined();
		if (!capital) return;
		const card = sim.hand.find((entry) => entry.type === 'port');
		expect(card).toBeDefined();
		if (!card) return;
		sim.gold = STRUCTURE_DEFINITIONS.port.cost;
		const result = sim.validateBuild(HUMAN_PLAYER_ID, card.id, capital.x + 1, capital.y + 1);
		expect(result.ok).toBe(false);
		expect(result.reason).toBe('not-shore');
	});
});
