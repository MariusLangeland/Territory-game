import { describe, expect, it } from 'vitest';
import { createGrowthLayer, GROWTH_MODES } from './growth';
import { generateMap } from './map';
import { TerritorySimulation, type AttackState, type PlayerState } from './simulation';
import type { BuildableStructureType } from './Structures';
import {
	ATTACK_IDLE_TICKS,
	BOT_BUILD_INTERVAL,
	BOT_DECISION_INTERVAL,
	BOT_DEFENSE_RESERVE_MAX,
	BOT_DEFENSE_STALL_INTERVALS,
	BOT_THREAT_DEFENSIVE,
	ELEVATION_LEVELS,
	HUMAN_PLAYER_ID,
	LAND_FRACTION,
	MAP_HEIGHT,
	MAP_WIDTH,
	MAX_PLAYER_COUNT,
	PALETTE,
	PLAYER_COUNT,
	PLAYER_NAMES,
	STRUCTURE_MIN_SPACING,
	TICK_RATE
} from './constants';

function findAttackablePixel(
	sim: TerritorySimulation,
	playerId: number
): { x: number; y: number } | null {
	const start = sim.map.starts[playerId - 1];
	for (let radius = 1; radius < 80; radius++) {
		for (let dy = -radius; dy <= radius; dy++) {
			for (let dx = -radius; dx <= radius; dx++) {
				if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
				const x = start.x + dx;
				const y = start.y + dy;
				if (!sim.isLand(x, y)) continue;
				if (sim.getOwner(x, y) !== 0) continue;
				if (sim.validateAttack(playerId, x, y).ok) return { x, y };
			}
		}
	}
	return null;
}

function findDeepAttackablePixel(
	sim: TerritorySimulation,
	playerId: number
): { x: number; y: number } | null {
	const start = sim.map.starts[playerId - 1];
	let best: { x: number; y: number } | null = null;
	let bestDistance = 0;
	for (let dy = -55; dy <= 55; dy++) {
		for (let dx = -55; dx <= 55; dx++) {
			const x = start.x + dx;
			const y = start.y + dy;
			if (!sim.isLand(x, y)) continue;
			if (sim.getOwner(x, y) === playerId) continue;
			const distance = dx * dx + dy * dy;
			if (distance <= bestDistance) continue;
			if (!sim.validateAttack(playerId, x, y).ok) continue;
			best = { x, y };
			bestDistance = distance;
		}
	}
	return best;
}

/**
 * Synthetic front against a 20-cell border row. Each captured owned target
 * costs 1 + elevation + occupied bonus attack points.
 */
function runDefenseCapture(elevationLevel: number): number {
	const sim = new TerritorySimulation({ seed: 424242 });
	// Isolate the defense-budget curve from capital auras.
	(sim as unknown as { auraDefense: Uint16Array }).auraDefense.fill(0);
	const width = sim.width;
	let startX = -1;
	let rowY = -1;
	for (let y = 1; y < sim.height - 1 && startX < 0; y++) {
		let run = 0;
		for (let x = 0; x < width; x++) {
			const index = y * width + x;
			if (sim.terrain[index] && sim.terrain[index + width]) {
				run++;
				if (run >= 20) {
					startX = x - 19;
					rowY = y;
					break;
				}
			} else {
				run = 0;
			}
		}
	}
	expect(startX).toBeGreaterThan(-1);
	if (startX < 0) return 0;

	const elevation = (sim as unknown as { elevation: Uint8Array }).elevation;
	const seeds: number[] = [];
	for (let x = startX; x < startX + 20; x++) {
		const target = rowY * width + x;
		const attacker = (rowY + 1) * width + x;
		sim.owners[target] = 2;
		sim.owners[attacker] = 1;
		sim.claimedBy[target] = 0;
		sim.claimedBy[attacker] = 0;
		elevation[target] = elevationLevel;
		seeds.push(target);
	}

	const frontier = createGrowthLayer('circular', {
		width,
		height: sim.height,
		owners: sim.owners,
		attackerId: 1,
		anchorX: startX + 10,
		anchorY: rowY,
		rngSeed: 1
	});
	for (const seed of seeds) frontier.push(seed);
	const attack: AttackState = {
		id: 500,
		attackerId: 1,
		defenderId: 2,
		targetX: startX + 10,
		targetY: rowY,
		anchorX: startX + 10,
		anchorY: rowY,
		growthMode: 'circular',
		frontier,
		createdAtTick: sim.tick,
		lifetimeTicks: 0,
		orders: 1,
		initialOrders: 1,
		strength: 1500,
		initialStrength: 1500,
		supplyCost: 30,
		power: 30,
		pierce: 0,
		idleTicks: 0,
		captures: 0,
		done: false
	};
	const internals = sim as unknown as {
		attacks: AttackState[];
		processAttacks(): void;
	};
	internals.attacks.push(attack);
	internals.processAttacks();
	return attack.captures;
}

function bruteForceBorders(sim: TerritorySimulation): Map<number, Set<number>> {
	const expected = new Map<number, Set<number>>();
	for (const player of sim.players) expected.set(player.id, new Set<number>());

	for (let y = 0; y < sim.height; y++) {
		for (let x = 0; x < sim.width; x++) {
			const owner = sim.getOwner(x, y);
			if (owner === 0) continue;
			const neighbours = [
				[x - 1, y],
				[x + 1, y],
				[x, y - 1],
				[x, y + 1]
			];
			if (neighbours.some(([nx, ny]) => sim.isLand(nx, ny) && sim.getOwner(nx, ny) !== owner)) {
				expected.get(owner)?.add(y * sim.width + x);
			}
		}
	}
	return expected;
}

describe('map generation', () => {
	it('is deterministic and lands near the configured fraction', () => {
		const a = generateMap(0xc0ffee);
		const b = generateMap(0xc0ffee);

		expect(a.landCount).toBe(b.landCount);
		expect(a.landCount).toBeGreaterThan(MAP_WIDTH * MAP_HEIGHT * (LAND_FRACTION - 0.01));
		expect(a.landCount).toBeLessThan(MAP_WIDTH * MAP_HEIGHT * (LAND_FRACTION + 0.01));
		expect(Array.from(a.land.subarray(0, 5000))).toEqual(Array.from(b.land.subarray(0, 5000)));
		expect(a.starts).toEqual(b.starts);
		expect(a.starts).toHaveLength(PLAYER_COUNT);
	});

	it('places enough spaced starts for every stress-test state', () => {
		for (const seed of [1234, 1337, 424242]) {
			const map = generateMap(seed);
			expect(map.starts).toHaveLength(PLAYER_COUNT);

			const unique = new Set(map.starts.map((start) => start.index));
			expect(unique.size).toBe(PLAYER_COUNT);

			for (const start of map.starts) {
				expect(map.land[start.index]).toBe(1);
			}

			const sim = new TerritorySimulation({ seed });
			expect(sim.players).toHaveLength(PLAYER_COUNT);
			expect(PLAYER_NAMES).toHaveLength(MAX_PLAYER_COUNT);
			expect(new Set(PLAYER_NAMES).size).toBe(MAX_PLAYER_COUNT);
			expect(PALETTE).toHaveLength(MAX_PLAYER_COUNT + 1);
			for (const player of sim.players) {
				expect(player.alive).toBe(true);
				expect(player.territory).toBeGreaterThan(100);
			}
			expect(sim.getSnapshot().claimedLand).toBe(
				sim.players.reduce((total, player) => total + player.territory, 0)
			);
		}
	});
});

describe('deterministic simulation', () => {
	it('supports configured states, map size, difficulty, and match timer', () => {
		const sim = new TerritorySimulation({
			seed: 424242,
			playerCount: 8,
			width: 1024,
			height: 640,
			botDifficulty: 'relaxed',
			matchDurationTicks: 120
		});
		expect(sim.playerCount).toBe(8);
		expect(sim.width).toBe(1024);
		expect(sim.height).toBe(640);
		expect(sim.botDifficulty).toBe('relaxed');
		expect(sim.map.starts).toHaveLength(8);
		expect(sim.getSnapshot().players).toHaveLength(8);

		for (let tick = 0; tick < 125; tick++) sim.step();
		const snapshot = sim.getSnapshot();
		expect(snapshot.ended).toBe(true);
		expect(snapshot.winnerId).not.toBeNull();
		expect(snapshot.tick).toBe(120);
	});

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
});

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

describe('bot offensive investment', () => {
	it('builds Barracks early and reaches Artillery in a normal match', () => {
		const sim = new TerritorySimulation({ seed: 1234 });
		let barracksAt1800 = 0;
		let artilleryAt6000 = 0;
		for (let tick = 1; tick <= 6000; tick++) {
			sim.step();
			if (tick === 1800) {
				barracksAt1800 = sim.structures.all.filter(
					(structure) => structure.type === 'barracks'
				).length;
			}
			if (tick === 6000) {
				artilleryAt6000 = sim.structures.all.filter(
					(structure) => structure.type === 'artillery'
				).length;
			}
		}
		expect(barracksAt1800).toBeGreaterThan(0);
		expect(artilleryAt6000).toBeGreaterThan(0);
	}, 30_000);
});

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

describe('frontier bookkeeping', () => {
	it('matches a brute-force border scan after simulation', () => {
		const sim = new TerritorySimulation({ seed: 76543 });
		const target = findAttackablePixel(sim, 1);
		expect(target).not.toBeNull();
		if (!target) return;

		sim.enqueueAttack(1, target.x, target.y);
		for (let tick = 0; tick < 35; tick++) sim.step();

		const expected = bruteForceBorders(sim);
		for (const player of sim.players) {
			if (!player.alive) {
				expect(player.border.size).toBe(0);
				continue;
			}
			const playerBorder = expected.get(player.id) ?? new Set<number>();
			expect(player.border.size).toBe(playerBorder.size);
			for (const index of playerBorder) expect(player.border.has(index)).toBe(true);
		}
	});
});

describe('attack stress mode', () => {
	it('launches and resolves attacks with no troop economy', () => {
		const sim = new TerritorySimulation({ seed: 2026 });
		expect(sim.players).toHaveLength(PLAYER_COUNT);
		expect(sim.getSnapshot().players.every((player) => !('troops' in player))).toBe(true);

		const before = sim.players[0].territory;
		const target = findAttackablePixel(sim, 1);
		expect(target).not.toBeNull();
		if (!target) return;

		expect(sim.enqueueAttack(1, target.x, target.y).ok).toBe(true);
		for (let tick = 0; tick < 10; tick++) sim.step();
		expect(sim.players[0].territory).toBeGreaterThan(before);

		sim.step();
		expect(sim.getSnapshot().attacks.length).toBeGreaterThan(0);
	});

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

	it('runs many simultaneous bot fronts and keeps ownership valid', () => {
		const sim = new TerritorySimulation({ seed: 314159 });
		for (let tick = 0; tick < 100; tick++) {
			const result = sim.step();
			expect(result.changeCount).toBeLessThanOrEqual(result.changes.length);
			expect(result.changesOverflow).toBe(false);
		}

		let claimed = 0;
		for (let i = 0; i < sim.owners.length; i++) {
			const owner = sim.owners[i];
			if (owner === 0) continue;
			expect(owner).toBeGreaterThanOrEqual(1);
			expect(owner).toBeLessThanOrEqual(PLAYER_COUNT);
			expect(sim.terrain[i]).toBe(1);
			claimed++;
		}
		expect(claimed).toBe(sim.getSnapshot().claimedLand);
		expect(sim.getSnapshot().attacks.length).toBeGreaterThan(0);
	});

	it('never claims a pixel that is disconnected from the attacker at capture time', () => {
		const sim = new TerritorySimulation({ seed: 2026 });
		const internals = sim as unknown as {
			claim(index: number, newOwner: number): void;
			hasNeighbourOwner(index: number, ownerId: number): boolean;
		};
		const originalClaim = internals.claim.bind(sim);
		let captures = 0;
		let disconnectedCaptures = 0;

		internals.claim = (index: number, newOwner: number) => {
			if (!internals.hasNeighbourOwner(index, newOwner)) disconnectedCaptures++;
			captures++;
			originalClaim(index, newOwner);
		};

		for (let tick = 0; tick < 40; tick++) sim.step();

		expect(captures).toBeGreaterThan(100);
		expect(disconnectedCaptures).toBe(0);
	});

	it('applies growth-layer switches only to new orders', () => {
		const sim = new TerritorySimulation({ seed: 112233 });
		expect(sim.getSnapshot().growthMode).toBe('organic');

		const target = findAttackablePixel(sim, 1);
		expect(target).not.toBeNull();
		if (!target) return;
		sim.enqueueAttack(1, target.x, target.y);
		sim.step();
		const initialAttacks = sim.getSnapshot().attacks.filter((attack) => attack.attackerId === 1);
		expect(initialAttacks.length).toBeGreaterThan(0);
		expect(initialAttacks.every((attack) => attack.growthMode === 'organic')).toBe(true);

		sim.setGrowthMode('smooth');
		expect(sim.getSnapshot().growthMode).toBe('organic');
		sim.step();
		expect(sim.getSnapshot().growthMode).toBe('smooth');

		const retained = sim.getSnapshot().attacks.filter((attack) => attack.attackerId === 1);
		expect(retained.every((attack) => attack.growthMode === 'organic')).toBe(true);

		const nextTarget = findAttackablePixel(sim, 1);
		expect(nextTarget).not.toBeNull();
		if (!nextTarget) return;
		expect(sim.enqueueAttack(1, nextTarget.x, nextTarget.y).ok).toBe(true);
		sim.step();
		const humanAttacks = sim.getSnapshot().attacks.filter((attack) => attack.attackerId === 1);
		expect(humanAttacks.some((attack) => attack.growthMode === 'smooth')).toBe(true);

		sim.setGrowthMode('organic');
		sim.step();
		expect(sim.getSnapshot().growthMode).toBe('organic');
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

	it('gives bots varied strategies and lets them build', () => {
		const sim = new TerritorySimulation({ seed: 581321 });
		const internals = sim as unknown as {
			botProfiles: Array<{
				aggression: number;
				focus: string;
				vengeful: number;
				cautious: number;
				conciliatory: number;
				opportunist: number;
				buildPlan: string[];
				structureBias: Record<string, number>;
			}>;
		};
		const profiles = internals.botProfiles.slice(1);
		const focuses = new Set(profiles.map((profile) => profile.focus));
		expect(focuses.size).toBeGreaterThan(1);
		for (const profile of profiles) {
			expect(profile.buildPlan).toHaveLength(7);
			expect(new Set(profile.buildPlan).size).toBe(7);
			expect(profile.buildPlan[0]).toBe(profile.focus);
			expect(Object.keys(profile.structureBias)).toHaveLength(7);
			for (const value of Object.values(profile.structureBias)) {
				expect(value).toBeGreaterThanOrEqual(0);
				expect(value).toBeLessThanOrEqual(200);
			}
		}
		const biasRanges = Object.keys(profiles[0].structureBias).map((type) => {
			const values = profiles.map((profile) => profile.structureBias[type]);
			return Math.max(...values) - Math.min(...values);
		});
		expect(Math.max(...biasRanges)).toBeGreaterThan(30);
		const aggressions = profiles.map((profile) => profile.aggression);
		expect(Math.max(...aggressions) - Math.min(...aggressions)).toBeGreaterThan(30);
		for (const trait of ['vengeful', 'cautious', 'conciliatory', 'opportunist'] as const) {
			const values = profiles.map((profile) => profile[trait]);
			expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(30);
		}

		for (let i = 0; i < 60; i++) sim.step();
		const built = sim.structures.all.filter((structure) => structure.type !== 'state');
		expect(built.length).toBeGreaterThan(0);
		expect(new Set(built.map((structure) => structure.type)).size).toBeGreaterThan(1);
		for (let index = 0; index < sim.districtStructureIds.length; index++) {
			const structureId = sim.districtStructureIds[index];
			if (structureId === 0) continue;
			const structure = sim.structures.byId(structureId);
			expect(structure).toBeDefined();
			expect(structure?.ownerId).toBe(sim.owners[index]);
		}
	});

	it('lets utility bots diversify structures instead of following one fixed plan', () => {
		const sim = new TerritorySimulation({ seed: 1234 });
		for (let tick = 0; tick < 600; tick++) sim.step();
		const builtTypes = new Set(
			sim.structures.all
				.filter((structure) => structure.type !== 'state')
				.map((structure) => structure.type)
		);
		expect(builtTypes.size).toBeGreaterThanOrEqual(3);
		expect(builtTypes.has('command-post')).toBe(true);
		expect(builtTypes.has('war-academy')).toBe(true);
		const human = sim.players[HUMAN_PLAYER_ID - 1];
		expect(human.alive).toBe(true);
	});

	it('keeps bot expansion flowing while they save for expensive aspirations', () => {
		const sim = new TerritorySimulation({ seed: 1234 });
		for (let tick = 0; tick < 3000; tick++) sim.step();
		const snapshot = sim.getSnapshot();
		expect(snapshot.attacks.length).toBeGreaterThan(10);
		expect(snapshot.players.filter((player) => player.alive).length).toBeLessThan(
			snapshot.players.length
		);
	}, 45_000);

	it('weights grudges, caution, conciliation, and opportunity in bot targeting', () => {
		const sim = new TerritorySimulation({ seed: 918273 });
		const internals = sim as unknown as {
			botGrievance: Uint16Array;
			botPressure: Uint16Array;
			scoreBotTarget(
				attackerId: number,
				profile: Record<string, unknown>,
				defenderId: number,
				selfStrength: number,
				strengths: Uint32Array
			): { score: number; opportunity: boolean };
		};
		const base = {
			aggression: 50,
			economy: 50,
			fortification: 50,
			command: 50,
			vengeful: 0,
			cautious: 0,
			conciliatory: 0,
			opportunist: 0,
			focus: 'artillery',
			buildPlan: []
		};
		const strengths = new Uint32Array(PLAYER_COUNT);
		strengths[0] = 1000;
		const score = (overrides: Record<string, number>) =>
			internals.scoreBotTarget(2, { ...base, ...overrides }, 1, 100, strengths);

		const targetScore = (overrides: Record<string, number>) => score(overrides).score;

		internals.botGrievance[PLAYER_COUNT] = 10;
		expect(targetScore({ vengeful: 100 })).toBeGreaterThan(targetScore({ vengeful: 0 }));
		internals.botGrievance[PLAYER_COUNT] = 0;

		expect(targetScore({ cautious: 100 })).toBeLessThan(targetScore({ cautious: 0 }));
		expect(targetScore({ conciliatory: 100 })).toBeLessThan(targetScore({ conciliatory: 0 }));

		internals.botPressure[0] = 3;
		expect(targetScore({ opportunist: 100 })).toBeGreaterThan(targetScore({ opportunist: 0 }));

		// A stronger neighbour that cannot afford a counterattack is an
		// opportunity even for a cautious profile.
		const savedGold = sim.gold;
		sim.gold = 0;
		const lowSupply = score({ cautious: 100, opportunist: 100 });
		expect(lowSupply.opportunity).toBe(true);
		sim.gold = 1000;
		const highSupply = score({ cautious: 100, opportunist: 100 });
		expect(highSupply.opportunity).toBe(false);
		expect(lowSupply.score).toBeGreaterThan(highSupply.score);
		sim.gold = savedGold;
	});

	it('scales attacks from live Barracks levels without merging clicks', () => {
		const sim = new TerritorySimulation({ seed: 864212 });
		let barracksIndex = -1;
		for (let i = 0; i < sim.owners.length; i++) {
			if (sim.terrain[i] && !sim.structures.at(i)) {
				barracksIndex = i;
				break;
			}
		}
		expect(barracksIndex).toBeGreaterThan(-1);
		if (barracksIndex < 0) return;
		const barracksX = barracksIndex % sim.width;
		const barracksY = (barracksIndex - barracksX) / sim.width;
		sim.structures.create('barracks', 1, barracksX, barracksY, sim.width);
		expect(sim.getBarracksLevels(1)).toBe(1);

		const target = findAttackablePixel(sim, 1);
		expect(target).not.toBeNull();
		if (!target) return;
		const internals = sim as unknown as { attacks: AttackState[] };
		sim.gold = 200;
		expect(sim.enqueueAttack(1, target.x, target.y).ok).toBe(true);
		expect(sim.enqueueAttack(1, target.x, target.y).ok).toBe(true);
		sim.step();

		const humanAttacks = internals.attacks.filter((attack) => attack.attackerId === 1);
		expect(humanAttacks.length).toBe(2);
		for (const attack of humanAttacks) {
			expect(attack.orders).toBe(2);
			expect(attack.initialOrders).toBe(2);
			expect(attack.power).toBe(45);
			expect(attack.pierce).toBe(1);
			expect(attack.initialStrength).toBe(1200);
		}
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

	it('ends the match immediately when one state holds 70% of land', () => {
		const sim = new TerritorySimulation({ seed: 24682 });
		const landCount = sim.getSnapshot().landCount;
		sim.players[0].territory = Math.ceil((landCount * 70) / 100);
		(sim as unknown as { checkVictory(): void }).checkVictory();
		expect(sim.ended).toBe(true);
		expect(sim.winnerId).toBe(1);
	});

	it('removes a front when its durable strength reaches zero', () => {
		const sim = new TerritorySimulation({ seed: 24680 });
		const target = findAttackablePixel(sim, 1);
		expect(target).not.toBeNull();
		if (!target) return;

		expect(sim.enqueueAttack(1, target.x, target.y).ok).toBe(true);
		sim.step();
		const internals = sim as unknown as { attacks: AttackState[] };
		const attack = internals.attacks.find((entry) => entry.attackerId === 1);
		expect(attack).toBeDefined();
		if (!attack) return;

		attack.strength = 0;
		const result = sim.step();
		expect(result.snapshot.attacks.some((entry) => entry.id === attack.id)).toBe(false);
	});

	it('assigns discrete elevation and base defense to every land pixel', () => {
		const sim = new TerritorySimulation({ seed: 123321 });
		const counts = new Array(ELEVATION_LEVELS).fill(0) as number[];
		let neutral = -1;
		for (let i = 0; i < sim.terrain.length; i++) {
			if (!sim.terrain[i]) continue;
			counts[sim.terrainElevation[i]]++;
			if (neutral < 0 && sim.owners[i] === 0) neutral = i;
		}
		expect(counts.every((count) => count > 0)).toBe(true);
		expect(neutral).toBeGreaterThan(-1);
		if (neutral < 0) return;

		const x = neutral % sim.width;
		const y = (neutral - x) / sim.width;
		const elevation = sim.getElevation(x, y);
		const base = sim.getBaseDefense(x, y);
		expect(base).toBe(1 + elevation);
		expect(sim.getDefense(x, y)).toBe(base);

		const start = sim.map.starts[0];
		expect(sim.getBaseDefense(start.x, start.y)).toBe(1 + sim.getElevation(start.x, start.y));
		expect(sim.getDefense(start.x, start.y)).toBe(
			sim.getBaseDefense(start.x, start.y) + 1 + sim.getAuraDefense(start.x, start.y)
		);
	});

	it('routes attacks toward a cheaper frontier cell', () => {
		const sim = new TerritorySimulation({ seed: 424242 });
		const internals = sim as unknown as {
			attacks: AttackState[];
			processAttacks(): void;
			auraDefense: Uint16Array;
		};
		internals.auraDefense.fill(0);

		const findCell = (minimumDistanceFrom = -1): number => {
			for (let i = 0; i < sim.owners.length; i++) {
				if (!sim.terrain[i] || sim.structures.at(i)) continue;
				if (minimumDistanceFrom >= 0) {
					const ax = i % sim.width;
					const ay = (i - ax) / sim.width;
					const bx = minimumDistanceFrom % sim.width;
					const by = (minimumDistanceFrom - bx) / sim.width;
					if ((ax - bx) ** 2 + (ay - by) ** 2 < 30 * 30) continue;
				}
				const x = i % sim.width;
				const y = (i - x) / sim.width;
				const neighbours = [
					x > 0 ? i - 1 : -1,
					x + 1 < sim.width ? i + 1 : -1,
					y > 0 ? i - sim.width : -1,
					y + 1 < sim.height ? i + sim.width : -1
				];
				if (neighbours.some((n) => n >= 0 && sim.terrain[n] && !sim.structures.at(n))) {
					return i;
				}
			}
			return -1;
		};

		const high = findCell();
		const low = findCell(high);
		expect(high).toBeGreaterThan(-1);
		expect(low).toBeGreaterThan(-1);
		if (high < 0 || low < 0) return;

		const attach = (index: number): void => {
			const x = index % sim.width;
			const y = (index - x) / sim.width;
			const neighbours = [
				x > 0 ? index - 1 : -1,
				x + 1 < sim.width ? index + 1 : -1,
				y > 0 ? index - sim.width : -1,
				y + 1 < sim.height ? index + sim.width : -1
			];
			const friendly = neighbours.find((n) => n >= 0 && sim.terrain[n] && !sim.structures.at(n));
			expect(friendly).toBeDefined();
			if (friendly === undefined) return;
			sim.owners[index] = 2;
			sim.owners[friendly] = 1;
		};
		attach(high);
		attach(low);
		internals.auraDefense[high] = 100;

		const entries: number[] = [];
		const frontier = {
			mode: 'organic' as const,
			get size() {
				return entries.length;
			},
			push(index: number) {
				entries.push(index);
			},
			pop() {
				return entries.pop();
			},
			mixState() {}
		};
		frontier.push(low);
		frontier.push(high);
		internals.attacks = [
			{
				id: 1,
				attackerId: 1,
				defenderId: 2,
				targetX: low % sim.width,
				targetY: Math.floor(low / sim.width),
				anchorX: low % sim.width,
				anchorY: Math.floor(low / sim.width),
				growthMode: 'organic',
				frontier,
				createdAtTick: sim.tick,
				lifetimeTicks: 0,
				orders: 1,
				initialOrders: 1,
				strength: 1500,
				initialStrength: 1500,
				supplyCost: 30,
				power: 30,
				pierce: 0,
				idleTicks: 0,
				captures: 0,
				done: false
			}
		];
		internals.processAttacks();
		expect(sim.getOwner(low % sim.width, Math.floor(low / sim.width))).toBe(1);
		expect(sim.getOwner(high % sim.width, Math.floor(high / sim.width))).toBe(2);
	});

	it('keeps a front alive when its cheapest candidate is unaffordable', () => {
		const sim = new TerritorySimulation({ seed: 424242 });
		const target = findAttackablePixel(sim, 1);
		expect(target).not.toBeNull();
		if (!target) return;
		const index = target.y * sim.width + target.x;
		const internals = sim as unknown as {
			attacks: AttackState[];
			auraDefense: Uint16Array;
			processAttacks(): void;
		};
		internals.auraDefense[index] = 100;

		const frontier = createGrowthLayer('circular', {
			width: sim.width,
			height: sim.height,
			owners: sim.owners,
			attackerId: 1,
			anchorX: target.x,
			anchorY: target.y,
			rngSeed: 1
		});
		frontier.push(index);
		const attack: AttackState = {
			id: 700,
			attackerId: 1,
			defenderId: sim.owners[index],
			targetX: target.x,
			targetY: target.y,
			anchorX: target.x,
			anchorY: target.y,
			growthMode: 'circular',
			frontier,
			createdAtTick: sim.tick,
			lifetimeTicks: 0,
			orders: 1,
			initialOrders: 1,
			strength: 1500,
			initialStrength: 1500,
			supplyCost: 30,
			power: 30,
			pierce: 0,
			idleTicks: 0,
			captures: 0,
			done: false
		};
		internals.attacks = [attack];
		internals.processAttacks();

		expect(attack.captures).toBe(0);
		expect(attack.done).toBe(false);
		expect(attack.frontier.size).toBeGreaterThan(0);
		expect(sim.getOwner(target.x, target.y)).not.toBe(1);
	});

	it('slows attacks by the target pixel defense', () => {
		const lowlandCaptures = runDefenseCapture(0);
		const peakCaptures = runDefenseCapture(5);
		expect(lowlandCaptures).toBe(15);
		expect(peakCaptures).toBe(4);
		expect(lowlandCaptures).toBeGreaterThan(peakCaptures);
	});

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

	it('trades durable strength on mutual front contact', () => {
		const sim = new TerritorySimulation({ seed: 554433 });
		let candidate = -1;
		for (let i = 1; i < sim.owners.length - 1; i++) {
			if (sim.terrain[i] && sim.terrain[i - 1]) {
				candidate = i;
				break;
			}
		}
		expect(candidate).toBeGreaterThan(0);
		if (candidate < 0) return;

		sim.owners[candidate - 1] = 1;
		sim.owners[candidate] = 2;
		sim.claimedBy[candidate - 1] = 200;

		const targetX = candidate % sim.width;
		const targetY = (candidate - targetX) / sim.width;
		const makeAttack = (id: number, attackerId: number, defenderId: number, orders: number) => ({
			id,
			attackerId,
			defenderId,
			targetX,
			targetY,
			anchorX: targetX,
			anchorY: targetY,
			growthMode: 'circular' as const,
			frontier: createGrowthLayer('circular', {
				width: sim.width,
				height: sim.height,
				owners: sim.owners,
				attackerId,
				anchorX: targetX,
				anchorY: targetY,
				rngSeed: id
			}),
			createdAtTick: sim.tick,
			lifetimeTicks: 0,
			orders,
			initialOrders: orders,
			strength: 1500,
			initialStrength: 1500,
			supplyCost: 30,
			power: 30,
			pierce: orders - 1,
			idleTicks: 0,
			captures: 0,
			done: false
		});

		const internals = sim as unknown as {
			resolveOpposingClash(
				index: number,
				attack: AttackState,
				attackById: Map<number, AttackState>,
				clashedPairs: Set<number>
			): 'halted' | 'blocked' | null;
		};
		const incoming = makeAttack(100, 1, 2, 2);
		const opposing = makeAttack(200, 2, 1, 1);
		const attackById = new Map<number, AttackState>([
			[100, incoming],
			[200, opposing]
		]);

		expect(internals.resolveOpposingClash(candidate, incoming, attackById, new Set())).toBe(
			'blocked'
		);
		expect(incoming.strength).toBe(1400);
		expect(opposing.strength).toBe(1350);
		expect(incoming.done).toBe(false);

		incoming.strength = 50;
		expect(internals.resolveOpposingClash(candidate, incoming, attackById, new Set())).toBe(
			'halted'
		);
		expect(incoming.strength).toBe(0);
		expect(incoming.done).toBe(true);
	});

	it('anchors distance-based growth at the border contact, not the click', () => {
		const sim = new TerritorySimulation({ seed: 998877 });
		const click = findDeepAttackablePixel(sim, 1);
		expect(click).not.toBeNull();
		if (!click) return;

		expect(sim.enqueueAttack(1, click.x, click.y).ok).toBe(true);
		sim.step();
		const internals = sim as unknown as { attacks: AttackState[] };
		const attack = internals.attacks.find((entry) => entry.attackerId === 1);
		expect(attack).toBeDefined();
		if (!attack) return;

		const dx = attack.anchorX - click.x;
		const dy = attack.anchorY - click.y;
		expect(dx * dx + dy * dy).toBeGreaterThan(25);

		let nearBorder = false;
		for (let y = attack.anchorY - 2; y <= attack.anchorY + 2; y++) {
			for (let x = attack.anchorX - 2; x <= attack.anchorX + 2; x++) {
				if (sim.getOwner(x, y) === 1) nearBorder = true;
			}
		}
		expect(nearBorder).toBe(true);
	});

	it('discards a queued attack cell that is cut off from the attacker border', () => {
		const sim = new TerritorySimulation({ seed: 424242 });

		let isolatedIndex = -1;
		let isolatedOwner = 0;
		for (let i = 0; i < sim.owners.length && isolatedIndex < 0; i++) {
			const owner = sim.owners[i];
			if (owner <= 1 || !sim.terrain[i]) continue;

			const x = i % sim.width;
			const y = (i - x) / sim.width;
			const touchesAttacker =
				sim.getOwner(x - 1, y) === 1 ||
				sim.getOwner(x + 1, y) === 1 ||
				sim.getOwner(x, y - 1) === 1 ||
				sim.getOwner(x, y + 1) === 1;
			if (touchesAttacker) continue;

			isolatedIndex = i;
			isolatedOwner = owner;
		}
		expect(isolatedIndex).toBeGreaterThan(-1);

		const targetX = isolatedIndex % sim.width;
		const targetY = (isolatedIndex - targetX) / sim.width;
		const frontier = createGrowthLayer('circular', {
			width: sim.width,
			height: sim.height,
			owners: sim.owners,
			attackerId: 1,
			anchorX: targetX,
			anchorY: targetY,
			rngSeed: 1
		});
		frontier.push(isolatedIndex);
		const attack: AttackState = {
			id: 999_999,
			attackerId: 1,
			defenderId: isolatedOwner,
			targetX,
			targetY,
			anchorX: targetX,
			anchorY: targetY,
			growthMode: 'circular',
			frontier,
			createdAtTick: sim.tick,
			lifetimeTicks: 0,
			orders: 1,
			initialOrders: 1,
			strength: 1500,
			initialStrength: 1500,
			supplyCost: 30,
			power: 30,
			pierce: 0,
			idleTicks: 0,
			captures: 0,
			done: false
		};

		const internals = sim as unknown as { attacks: AttackState[] };
		internals.attacks.push(attack);
		const territoryBefore = sim.players[0].territory;
		const result = sim.step();

		expect(sim.owners[isolatedIndex]).toBe(isolatedOwner);
		expect(sim.players[0].territory).toBe(territoryBefore);
		expect(result.snapshot.attacks.some((entry) => entry.id === attack.id)).toBe(true);
		for (let tick = 0; tick <= ATTACK_IDLE_TICKS; tick++) sim.step();
		expect(sim.getSnapshot().attacks.some((entry) => entry.id === attack.id)).toBe(false);
	});
});

type BotDefenseInternals = {
	botThreat: Uint16Array;
	botDefensive: Uint8Array;
	botReserve: Uint8Array;
	botDefenseStall: Uint8Array;
	botGold: number[];
	botGrievance: Uint16Array;
	botAttackers: Uint8Array;
	botProfiles: Array<{ buildPlan: BuildableStructureType[] }>;
	attacks: AttackState[];
	scoreBotTarget(
		attackerId: number,
		profile: Record<string, unknown>,
		defenderId: number,
		selfStrength: number,
		strengths: Uint32Array
	): { score: number; opportunity: boolean };
};

/** Step until the simulation reaches the requested tick. */
function stepUntilTick(sim: TerritorySimulation, targetTick: number): void {
	while (sim.tick < targetTick) sim.step();
}

function findBareOwnedCells(sim: TerritorySimulation, playerId: number, count: number): number[] {
	const cells: number[] = [];
	for (let index = 0; index < sim.owners.length && cells.length < count; index++) {
		if (sim.owners[index] !== playerId || !sim.terrain[index]) continue;
		if (sim.structures.at(index)) continue;
		const x = index % sim.width;
		const y = (index - x) / sim.width;
		if (sim.getDistrictStructureId(x, y) !== 0) continue;
		if (sim.structures.hasWithinRadius(x, y, STRUCTURE_MIN_SPACING)) continue;
		cells.push(index);
	}
	return cells;
}

/**
 * Inject a hostile front that is retired by processAttacks on the same step.
 * The threat refresh runs before combat, so the defender still sees the attack.
 */
function injectThreatAttack(
	sim: TerritorySimulation,
	attackerId: number,
	defenderId: number
): void {
	const start = sim.map.starts[defenderId - 1];
	const internals = sim as unknown as { attacks: AttackState[] };
	internals.attacks.push({
		id: 900_000 + attackerId,
		attackerId,
		defenderId,
		targetX: start.x,
		targetY: start.y,
		anchorX: start.x,
		anchorY: start.y,
		growthMode: 'circular',
		frontier: createGrowthLayer('circular', {
			width: sim.width,
			height: sim.height,
			owners: sim.owners,
			attackerId,
			anchorX: start.x,
			anchorY: start.y,
			rngSeed: 7
		}),
		createdAtTick: sim.tick,
		lifetimeTicks: 0,
		orders: 1,
		initialOrders: 1,
		strength: 1500,
		initialStrength: 1500,
		supplyCost: 30,
		power: 30,
		pierce: 0,
		idleTicks: 0,
		captures: 0,
		done: false
	});
}

describe('bot threat detection and defensive behaviour', () => {
	it('detects an active attack targeting a bot and enters a defensive posture', () => {
		const sim = new TerritorySimulation({ seed: 13579 });
		const internals = sim as unknown as BotDefenseInternals;
		stepUntilTick(sim, BOT_DECISION_INTERVAL - 1);
		expect(internals.botThreat[1]).toBe(0);
		expect(internals.botDefensive[1]).toBe(0);

		injectThreatAttack(sim, 3, 2);
		sim.step();

		expect(internals.botThreat[1]).toBeGreaterThanOrEqual(BOT_THREAT_DEFENSIVE);
		expect(internals.botDefensive[1]).toBe(1);
		expect(internals.botReserve[1]).toBeGreaterThan(0);
		expect(internals.botReserve[1]).toBeLessThanOrEqual(BOT_DEFENSE_RESERVE_MAX);
	});

	it('counts hostile border contact as threat without holding the posture', () => {
		const sim = new TerritorySimulation({ seed: 97531 });
		const internals = sim as unknown as BotDefenseInternals;
		stepUntilTick(sim, BOT_DECISION_INTERVAL - 1);

		// Fabricate enemy ownership on three neutral pixels touching bot 2.
		let touches = 0;
		for (const index of sim.players[1].border) {
			const x = index % sim.width;
			const y = (index - x) / sim.width;
			const neighbours = [
				x > 0 ? index - 1 : -1,
				x + 1 < sim.width ? index + 1 : -1,
				y > 0 ? index - sim.width : -1,
				y + 1 < sim.height ? index + sim.width : -1
			];
			for (const neighbour of neighbours) {
				if (neighbour < 0 || !sim.terrain[neighbour]) continue;
				if (sim.owners[neighbour] !== 0) continue;
				sim.owners[neighbour] = 3;
				touches++;
				if (touches >= 3) break;
			}
			if (touches >= 3) break;
		}
		expect(touches).toBe(3);

		sim.step();
		expect(internals.botThreat[1]).toBeGreaterThan(0);
		expect(internals.botThreat[1]).toBeLessThan(BOT_THREAT_DEFENSIVE);
		expect(internals.botDefensive[1]).toBe(0);
		expect(internals.botReserve[1]).toBe(0);
	});

	it('releases the gold reserve once the threat passes', () => {
		const sim = new TerritorySimulation({ seed: 24680 });
		const internals = sim as unknown as BotDefenseInternals;
		stepUntilTick(sim, BOT_DECISION_INTERVAL - 1);

		injectThreatAttack(sim, 3, 2);
		sim.step();
		expect(internals.botDefensive[1]).toBe(1);
		expect(internals.botReserve[1]).toBeGreaterThan(0);

		// The injected front idles out, then the next decision clears posture.
		stepUntilTick(sim, BOT_DECISION_INTERVAL * 2 + ATTACK_IDLE_TICKS + 4);
		expect(internals.botThreat[1]).toBe(0);
		expect(internals.botDefensive[1]).toBe(0);
		expect(internals.botReserve[1]).toBe(0);
	});

	it('releases a stuck reserve so a long stalemate cannot block spending forever', () => {
		const sim = new TerritorySimulation({ seed: 314159 });
		const internals = sim as unknown as BotDefenseInternals;
		stepUntilTick(sim, BOT_BUILD_INTERVAL - 2);

		const cells = findBareOwnedCells(sim, 2, 2);
		expect(cells).toHaveLength(2);
		if (cells.length < 2) return;
		const [postCell, barracksCell] = cells;
		const post = sim.structures.create(
			'fortification',
			2,
			postCell % sim.width,
			Math.floor(postCell / sim.width),
			sim.width
		);
		const barracks = sim.structures.create(
			'barracks',
			2,
			barracksCell % sim.width,
			Math.floor(barracksCell / sim.width),
			sim.width
		);
		// Both defensive options are far above what the bot can save between
		// build intervals, so defensive progress genuinely stalls.
		for (let level = 1; level < 100; level++) {
			sim.structures.reinforce(post);
			sim.structures.reinforce(barracks);
		}
		internals.botGold[1] = 300;

		// Fresh losses at every decision tick keep the bot threatened.
		const grudge = (2 - 1) * PLAYER_COUNT + (3 - 1);
		const lastTick = BOT_BUILD_INTERVAL * BOT_DEFENSE_STALL_INTERVALS;
		for (let tick = BOT_DECISION_INTERVAL; tick <= lastTick; tick += BOT_DECISION_INTERVAL) {
			stepUntilTick(sim, tick - 1);
			internals.botGrievance[grudge] += 10;
			sim.step();
		}

		expect(internals.botDefensive[1]).toBe(1);
		// The reserve was released, so the bot finally bought a plan structure.
		const planStructures = sim.structures
			.forOwner(2)
			.filter(
				(entry) => entry.type !== 'state' && entry.id !== post.id && entry.id !== barracks.id
			);
		expect(planStructures.length).toBeGreaterThan(0);
	});

	it('builds a fortification before the build plan when threatened', () => {
		const sim = new TerritorySimulation({ seed: 246810 });
		const internals = sim as unknown as BotDefenseInternals;
		stepUntilTick(sim, BOT_BUILD_INTERVAL - 2);
		expect(internals.botDefensive[1]).toBe(0);
		expect(sim.structures.forOwner(2).filter((entry) => entry.type !== 'state')).toHaveLength(0);

		// A fresh loss at the refresh tick raises threat past the threshold.
		internals.botGrievance[(2 - 1) * PLAYER_COUNT + (3 - 1)] += 10;
		sim.step();

		expect(internals.botDefensive[1]).toBe(1);
		expect(internals.botReserve[1]).toBeGreaterThan(0);
		expect(sim.structures.forOwnerType(2, 'fortification')).toBeDefined();
		const buildables = sim.structures
			.forOwner(2)
			.filter((entry) => entry.type !== 'state')
			.map((entry) => entry.type);
		expect(buildables).toEqual(['fortification']);
	});

	it('upgrades a defensive structure before unrelated plan steps when threatened', () => {
		const sim = new TerritorySimulation({ seed: 918273 });
		const internals = sim as unknown as BotDefenseInternals;
		stepUntilTick(sim, BOT_BUILD_INTERVAL - 2);

		const cells = findBareOwnedCells(sim, 2, 2);
		expect(cells).toHaveLength(2);
		if (cells.length < 2) return;
		const [postCell, barracksCell] = cells;
		const post = sim.structures.create(
			'fortification',
			2,
			postCell % sim.width,
			Math.floor(postCell / sim.width),
			sim.width
		);
		const barracks = sim.structures.create(
			'barracks',
			2,
			barracksCell % sim.width,
			Math.floor(barracksCell / sim.width),
			sim.width
		);

		internals.botGrievance[(2 - 1) * PLAYER_COUNT + (3 - 1)] += 10;
		sim.step();

		expect(internals.botDefensive[1]).toBe(1);
		expect(post.stacks).toBe(2);
		expect(barracks.stacks).toBe(1);
		const built = sim.structures
			.forOwner(2)
			.filter(
				(entry) => entry.type !== 'state' && entry.id !== post.id && entry.id !== barracks.id
			);
		expect(built).toHaveLength(0);
	});

	it('rebuilds a destroyed fortification when threatened', () => {
		const sim = new TerritorySimulation({ seed: 553311 });
		const internals = sim as unknown as BotDefenseInternals;
		stepUntilTick(sim, BOT_BUILD_INTERVAL - 2);

		const [cell] = findBareOwnedCells(sim, 2, 1);
		expect(cell).toBeDefined();
		if (cell === undefined) return;
		const destroyed = sim.structures.create(
			'fortification',
			2,
			cell % sim.width,
			Math.floor(cell / sim.width),
			sim.width
		);
		expect(sim.structures.destroy(destroyed)).toBe(true);
		expect(sim.structures.forOwnerType(2, 'fortification')).toBeUndefined();

		internals.botGrievance[(2 - 1) * PLAYER_COUNT + (3 - 1)] += 10;
		internals.botGold[1] = 100;
		sim.step();

		const rebuilt = sim.structures.forOwnerType(2, 'fortification');
		expect(rebuilt).toBeDefined();
		expect(rebuilt?.id).not.toBe(destroyed.id);
	});

	it('rebuilds a destroyed early-economy structure when affordable and a site exists', () => {
		const sim = new TerritorySimulation({ seed: 314159 });
		const internals = sim as unknown as BotDefenseInternals;
		stepUntilTick(sim, BOT_BUILD_INTERVAL - 2);
		expect(internals.botDefensive[1]).toBe(0);

		const economyType = 'command-post';
		const [cell] = findBareOwnedCells(sim, 2, 1);
		expect(cell).toBeDefined();
		if (cell === undefined) return;
		const destroyed = sim.structures.create(
			economyType,
			2,
			cell % sim.width,
			Math.floor(cell / sim.width),
			sim.width
		);
		expect(sim.structures.destroy(destroyed)).toBe(true);
		internals.botGold[1] = 1000;

		sim.step();
		expect(sim.structures.forOwnerType(2, economyType)).toBeDefined();
	});

	it('biases high-threat targeting toward the grudge holder and attacker', () => {
		const sim = new TerritorySimulation({ seed: 1234 });
		const internals = sim as unknown as BotDefenseInternals;
		const profile = internals.botProfiles[1] as unknown as Record<string, unknown>;
		const strengths = new Uint32Array(PLAYER_COUNT).fill(1000);
		const score = (defenderId: number): number =>
			internals.scoreBotTarget(2, profile, defenderId, 1000, strengths).score;

		const peacefulNeutral = score(0);
		expect(peacefulNeutral).toBeGreaterThan(0);

		internals.botDefensive[1] = 1;
		internals.botGrievance[(2 - 1) * PLAYER_COUNT + (3 - 1)] = 8;
		internals.botAttackers[(4 - 1) * PLAYER_COUNT + (2 - 1)] = 1;

		expect(score(0)).toBeGreaterThan(peacefulNeutral);
		expect(score(3)).toBeGreaterThan(score(5));
		expect(score(4)).toBeGreaterThan(score(5));
	});

	it('measures income and strength gaps against bordering neighbours', () => {
		const sim = new TerritorySimulation({ seed: 1234 });
		const width = sim.width;
		const internals = sim as unknown as {
			claim(index: number, newOwner: number, sourceAttackId?: number): void;
			botIncomeGap: Uint8Array;
			botDeterrence: Uint16Array;
		};
		const self = sim.players[1];
		const neighbour = sim.players[2];
		expect(self).toBeDefined();
		expect(neighbour).toBeDefined();
		if (!self || !neighbour) return;
		let claimed = -1;
		for (const index of self.border) {
			const x = index % width;
			const y = (index - x) / width;
			const candidates = [
				x > 0 ? index - 1 : -1,
				x + 1 < width ? index + 1 : -1,
				y > 0 ? index - width : -1,
				y + 1 < sim.height ? index + width : -1
			];
			for (const next of candidates) {
				if (next < 0 || (sim.owners[next] ?? 0) !== 0) continue;
				internals.claim(next, neighbour.id);
				claimed = next;
				break;
			}
			if (claimed >= 0) break;
		}
		expect(claimed).toBeGreaterThanOrEqual(0);
		neighbour.territory += 30_000;
		stepUntilTick(sim, BOT_DECISION_INTERVAL);

		expect(internals.botIncomeGap[self.id - 1]).toBeGreaterThan(0);
		expect(internals.botDeterrence[self.id - 1]).toBeGreaterThan(0);
	});

	it('prioritizes income and deterrent fortifications from neighbour pressure', () => {
		const sim = new TerritorySimulation({ seed: 90210 });
		const internals = sim as unknown as {
			tick: number;
			botIncomeGap: Uint8Array;
			botDeterrence: Uint16Array;
			botDefensive: Uint8Array;
			chooseBotEconomicAction(
				player: PlayerState,
				budget: number,
				defensiveBudget?: number
			): { type: string } | null;
		};
		const player = sim.players[1];
		expect(player).toBeDefined();
		if (!player) return;
		internals.tick = 1201;
		internals.botDefensive[player.id - 1] = 0;

		internals.botIncomeGap[player.id - 1] = 100;
		internals.botDeterrence[player.id - 1] = 0;
		expect(internals.chooseBotEconomicAction(player, 1000, 1000)?.type).toBe('command-post');

		internals.botIncomeGap[player.id - 1] = 0;
		internals.botDeterrence[player.id - 1] = 100;
		expect(internals.chooseBotEconomicAction(player, 1000, 1000)?.type).toBe('fortification');
	});

	it('counts threatened fortifications and deterrence-triggered posture', () => {
		const sim = new TerritorySimulation({ seed: 1234 });
		const internals = sim as unknown as {
			tick: number;
			botDefensive: Uint8Array;
			botThreat: Uint16Array;
			botReserve: Uint8Array;
			botGold: number[];
			botPressure: Uint16Array;
			runBotEconomy(): void;
		};
		internals.tick = BOT_BUILD_INTERVAL - 1;
		internals.botPressure[1] = 1;
		internals.botDefensive[1] = 1;
		internals.botThreat[1] = BOT_THREAT_DEFENSIVE;
		internals.botReserve[1] = BOT_DEFENSE_RESERVE_MAX;
		internals.botGold[1] = 1000;
		internals.runBotEconomy();
		expect(sim.getBotBehaviorTelemetry().threatenedFortificationBuilds).toBeGreaterThan(0);

		const deterrenceSim = new TerritorySimulation({ seed: 1234 });
		const deterrenceInternals = deterrenceSim as unknown as {
			claim(index: number, newOwner: number, sourceAttackId?: number): void;
			botPressure: Uint16Array;
			botDefensive: Uint8Array;
			refreshBotThreat(player: PlayerState): void;
		};
		const self = deterrenceSim.players[1];
		const neighbour = deterrenceSim.players[2];
		expect(self).toBeDefined();
		expect(neighbour).toBeDefined();
		if (!self || !neighbour) return;
		let claimed = -1;
		for (const index of self.border) {
			const x = index % deterrenceSim.width;
			const y = (index - x) / deterrenceSim.width;
			for (const next of [
				x > 0 ? index - 1 : -1,
				x + 1 < deterrenceSim.width ? index + 1 : -1,
				y > 0 ? index - deterrenceSim.width : -1,
				y + 1 < deterrenceSim.height ? index + deterrenceSim.width : -1
			]) {
				if (next < 0 || (deterrenceSim.owners[next] ?? 0) !== 0) continue;
				deterrenceInternals.claim(next, neighbour.id);
				claimed = next;
				break;
			}
			if (claimed >= 0) break;
		}
		expect(claimed).toBeGreaterThanOrEqual(0);
		neighbour.territory += 30_000;
		deterrenceInternals.botPressure[self.id - 1] = 1;
		deterrenceInternals.botDefensive[self.id - 1] = 0;
		deterrenceInternals.refreshBotThreat(self);
		expect(deterrenceSim.getBotBehaviorTelemetry().deterrencePostures).toBeGreaterThan(0);
	});

	it('keeps coordinated teams from attacking each other', () => {
		const sim = new TerritorySimulation({
			seed: 424242,
			playerCount: 4,
			width: 640,
			height: 360,
			allPlayersBots: true,
			teamIds: [1, 1, 2, 2]
		});
		for (let tick = 0; tick < 900; tick++) sim.step();
		const snapshot = sim.getSnapshot();
		const sameTeamAttack = snapshot.attacks.some((attack) => {
			const attacker = sim.players[attack.attackerId - 1];
			const defender = sim.players[attack.defenderId - 1];
			return (
				attacker !== undefined &&
				defender !== undefined &&
				attacker.teamId !== 0 &&
				attacker.teamId === defender.teamId
			);
		});
		expect(sameTeamAttack).toBe(false);
	});

	it('selects committed strategic options deterministically', () => {
		const left = new TerritorySimulation({ seed: 424242 });
		const right = new TerritorySimulation({ seed: 424242 });
		for (let tick = 0; tick < 300; tick++) {
			left.step();
			right.step();
		}
		const leftOptions = left.players
			.filter((player) => player.isBot && player.alive)
			.map((player) => left.getBotOption(player.id));
		expect(leftOptions.some((option) => option !== null)).toBe(true);
		const telemetry = left.getBotBehaviorTelemetry();
		expect(Object.values(telemetry.optionSelections).some((count) => count > 0)).toBe(true);
		expect(left.checksum()).toBe(right.checksum());
		expect(left.getBotBehaviorTelemetry().optionSelections).toEqual(
			right.getBotBehaviorTelemetry().optionSelections
		);
	}, 15_000);

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

	it('records successful attack and defense reward metrics', () => {
		const sim = new TerritorySimulation({ seed: 1234 });
		for (let tick = 0; tick < 2500; tick++) sim.step();
		const metrics = sim.players.map((player) => sim.getPlayerBehaviorMetrics(player.id));
		const total = (key: keyof (typeof metrics)[number]): number =>
			metrics.reduce((sum, entry) => sum + entry[key], 0);
		expect(total('attacksVsWeakerStates')).toBeGreaterThan(0);
		expect(total('attacksRepelled')).toBeGreaterThan(0);
		expect(total('defenseDamage')).toBeGreaterThan(0);
		const erased = sim.players.filter((player) => !player.alive).length;
		expect(total('statesEliminated')).toBeGreaterThan(0);
		expect(total('statesEliminated')).toBeLessThanOrEqual(erased);
	}, 30_000);

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
