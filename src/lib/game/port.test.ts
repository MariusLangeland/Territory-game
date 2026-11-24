import { describe, expect, it } from 'vitest';
import { HUMAN_PLAYER_ID } from './constants';
import { TerritorySimulation, type AttackState } from './simulation';
import { STRUCTURE_DEFINITIONS, type Structure } from './structures';

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

	it('snaps a naval click from nearby water to a valid shore', () => {
		const sim = new TerritorySimulation({ seed: 1234 });
		const source = findShore(sim, 2);
		expect(source).not.toBeNull();
		if (!source) return;
		sim.structures.create(
			'port',
			2,
			source.index % sim.width,
			Math.floor(source.index / sim.width),
			sim.width
		);
		(sim as unknown as { botGold: number[] }).botGold[1] = 1000;

		let target = -1;
		for (let index = 0; index < sim.owners.length; index++) {
			if (sim.owners[index] === 2 || sim.structures.at(index)) continue;
			const x = index % sim.width;
			const y = Math.floor(index / sim.width);
			if (!sim.isShore(x, y)) continue;
			if (!sim.validateNavalAttack(2, x, y).ok) continue;
			const waters = [
				[x - 1, y],
				[x + 1, y],
				[x, y - 1],
				[x, y + 1]
			].find(
				([wx, wy]) => wx >= 0 && wy >= 0 && wx < sim.width && wy < sim.height && !sim.isLand(wx, wy)
			);
			if (!waters) continue;
			target = index;
			const queued = sim.enqueueNavalAttack(2, waters[0] as number, waters[1] as number);
			expect(queued.ok).toBe(true);
			const command = (
				sim as unknown as { pendingCommands: Array<{ type: string; x: number; y: number }> }
			).pendingCommands.find((entry) => entry.type === 'naval');
			expect(command).toBeDefined();
			expect(sim.isLand(command?.x ?? -1, command?.y ?? -1)).toBe(true);
			expect(sim.isShore(command?.x ?? -1, command?.y ?? -1)).toBe(true);
			break;
		}
		expect(target).toBeGreaterThan(-1);
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

	it('lets a bot choose and launch a worthwhile naval opportunity', () => {
		const sim = new TerritorySimulation({ seed: 1234 });
		const source = findShore(sim, 2);
		expect(source).not.toBeNull();
		if (!source) return;
		sim.structures.create(
			'port',
			2,
			source.index % sim.width,
			Math.floor(source.index / sim.width),
			sim.width
		);
		const internals = sim as unknown as {
			tick: number;
			botGold: number[];
			botReserve: Uint8Array;
			chooseBotNavalTarget(
				player: (typeof sim.players)[number],
				usePorts?: boolean
			): { index: number; score: number } | null;
			runBotNaval(): void;
		};
		internals.botGold[1] = 1000;
		internals.botReserve[1] = 0;
		const target = internals.chooseBotNavalTarget(sim.players[1]);
		expect(target).not.toBeNull();
		if (!target) return;
		expect(
			sim.validateNavalAttack(2, target.index % sim.width, Math.floor(target.index / sim.width)).ok
		).toBe(true);
		// Player 2's staggered decision phase lands on ticks 9, 19, 29, ...
		for (let tick = 9; tick <= 1000; tick += 10) {
			internals.tick = tick;
			internals.botGold[1] = 1000;
			internals.runBotNaval();
			if (sim.getBotBehaviorTelemetry().botNavalLandings > 0) break;
		}
		expect(sim.getBotBehaviorTelemetry().botNavalLandings).toBeGreaterThan(0);
	});

	it('snaps Port placement from a nearby water tile to owned shoreline', () => {
		// A compact atlas keeps this fixture coastal without weakening the
		// arbitrary-size map contract.
		const sim = new TerritorySimulation({ seed: 2, width: 1024, height: 512 });
		const card = sim.hand.find((entry) => entry.type === 'port');
		expect(card).toBeDefined();
		if (!card) return;
		sim.gold = STRUCTURE_DEFINITIONS.port.cost * 4;
		let found = false;
		for (let index = 0; index < sim.owners.length && !found; index++) {
			if (sim.owners[index] !== HUMAN_PLAYER_ID) continue;
			const x = index % sim.width;
			const y = Math.floor(index / sim.width);
			if (!sim.isShore(x, y)) continue;
			const neighbours: Array<[number, number]> = [
				[x - 1, y],
				[x + 1, y],
				[x, y - 1],
				[x, y + 1]
			];
			for (const [wx, wy] of neighbours) {
				if (wx < 0 || wy < 0 || wx >= sim.width || wy >= sim.height) continue;
				const water = wy * sim.width + wx;
				if (sim.owners[water] !== 0 || sim.map.land[water] !== 0) continue;
				const result = sim.validateBuild(HUMAN_PLAYER_ID, card.id, wx, wy);
				if (!result.ok) continue;
				expect(result.targetX).toBe(x);
				expect(result.targetY).toBe(y);
				found = true;
				break;
			}
		}
		expect(found).toBe(true);
	});

	it('allows a Port inside another structure district', () => {
		const sim = new TerritorySimulation({ seed: 2, width: 1024, height: 512 });
		const card = sim.hand.find((entry) => entry.type === 'port');
		expect(card).toBeDefined();
		if (!card) return;
		sim.gold = STRUCTURE_DEFINITIONS.port.cost * 4;
		const shore = findShore(sim, HUMAN_PLAYER_ID);
		expect(shore).not.toBeNull();
		if (!shore) return;
		const shoreX = shore.index % sim.width;
		const shoreY = Math.floor(shore.index / sim.width);
		let fortification: Structure | null = null;
		for (let radius = 8; radius <= 30 && !fortification; radius++) {
			for (let dy = -radius; dy <= radius && !fortification; dy++) {
				for (let dx = -radius; dx <= radius; dx++) {
					if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
					const x = shoreX + dx;
					const y = shoreY + dy;
					if (x < 0 || y < 0 || x >= sim.width || y >= sim.height) continue;
					const index = y * sim.width + x;
					if (sim.owners[index] !== HUMAN_PLAYER_ID || sim.structures.at(index)) continue;
					if (sim.structures.hasWithinRadius(x, y, 8)) continue;
					fortification = sim.structures.create('fortification', HUMAN_PLAYER_ID, x, y, sim.width);
					break;
				}
			}
		}
		expect(fortification).not.toBeNull();
		if (!fortification) return;
		const internals = sim as unknown as {
			refreshDistrictsAround: (structure: Structure) => void;
			districtStructureIds: Uint16Array;
		};
		internals.refreshDistrictsAround(fortification);

		let validated = false;
		for (let index = 0; index < sim.owners.length && !validated; index++) {
			if (sim.owners[index] !== HUMAN_PLAYER_ID) continue;
			if (internals.districtStructureIds[index] === 0) continue;
			const x = index % sim.width;
			const y = Math.floor(index / sim.width);
			if (!sim.isShore(x, y)) continue;
			const result = sim.validateBuild(HUMAN_PLAYER_ID, card.id, x, y);
			if (!result.ok) continue;
			const targetX = result.targetX ?? x;
			const targetY = result.targetY ?? y;
			expect(internals.districtStructureIds[targetY * sim.width + targetX]).not.toBe(0);
			validated = true;
		}
		expect(validated).toBe(true);
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
