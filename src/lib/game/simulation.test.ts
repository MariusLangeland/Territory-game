import { describe, expect, it } from 'vitest';
import { createGrowthLayer, GROWTH_MODES } from './growth';
import { generateMap } from './map';
import { TerritorySimulation, type AttackState } from './simulation';
import {
	ATTACK_DAMAGE_PER_TICK,
	ATTACK_LIFETIME_TICKS,
	ELEVATION_LEVELS,
	LAND_FRACTION,
	MAP_HEIGHT,
	MAP_WIDTH,
	PALETTE,
	PLAYER_COUNT,
	PLAYER_NAMES
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
			expect(PLAYER_NAMES).toHaveLength(PLAYER_COUNT);
			expect(new Set(PLAYER_NAMES).size).toBe(PLAYER_COUNT);
			expect(PALETTE).toHaveLength(PLAYER_COUNT + 1);
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

	it('spends attack orders and refreshes them every 10 seconds', () => {
		const sim = new TerritorySimulation({ seed: 271828 });
		const target = findAttackablePixel(sim, 1);
		expect(target).not.toBeNull();
		if (!target) return;

		expect(sim.getSnapshot().attackOrders).toBe(3);
		expect(sim.getSnapshot().attackOrderCap).toBe(3);
		for (let i = 0; i < 3; i++) {
			expect(sim.enqueueAttack(1, target.x, target.y).ok).toBe(true);
		}
		const blocked = sim.enqueueAttack(1, target.x, target.y);
		expect(blocked.ok).toBe(false);
		expect(blocked.reason).toBe('no-orders');

		for (let tick = 0; tick < 100; tick++) sim.step();
		expect(sim.getSnapshot().attackOrders).toBe(3);
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
		expect(sim.getSnapshot().growthMode).toBe('circular');

		const target = findAttackablePixel(sim, 1);
		expect(target).not.toBeNull();
		if (!target) return;
		sim.enqueueAttack(1, target.x, target.y);
		sim.step();
		const circularAttacks = sim.getSnapshot().attacks.filter((attack) => attack.attackerId === 1);
		expect(circularAttacks.length).toBeGreaterThan(0);
		expect(circularAttacks.every((attack) => attack.growthMode === 'circular')).toBe(true);

		sim.setGrowthMode('smooth');
		expect(sim.getSnapshot().growthMode).toBe('circular');
		sim.step();
		expect(sim.getSnapshot().growthMode).toBe('smooth');

		const retained = sim.getSnapshot().attacks.filter((attack) => attack.attackerId === 1);
		expect(retained.every((attack) => attack.growthMode === 'circular')).toBe(true);

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
	});

	it('expires attack orders after their maximum lifetime', () => {
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

		attack.createdAtTick = sim.tick - ATTACK_LIFETIME_TICKS;
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

	it('cancels mutual attacks when their claimed fronts touch', () => {
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
		const makeFrontier = () => {
			const frontier = createGrowthLayer('circular', {
				width: sim.width,
				height: sim.height,
				owners: sim.owners,
				attackerId: 1,
				anchorX: targetX,
				anchorY: targetY,
				rngSeed: 1
			});
			frontier.push(candidate);
			return frontier;
		};

		const internals = sim as unknown as {
			attacks: AttackState[];
			processAttacks(): void;
		};
		internals.attacks.push(
			{
				id: 100,
				attackerId: 1,
				defenderId: 2,
				targetX,
				targetY,
				anchorX: targetX,
				anchorY: targetY,
				growthMode: 'circular',
				frontier: makeFrontier(),
				createdAtTick: sim.tick,
				captures: 0,
				done: false
			},
			{
				id: 200,
				attackerId: 2,
				defenderId: 1,
				targetX,
				targetY,
				anchorX: targetX,
				anchorY: targetY,
				growthMode: 'circular',
				frontier: createGrowthLayer('circular', {
					width: sim.width,
					height: sim.height,
					owners: sim.owners,
					attackerId: 2,
					anchorX: targetX,
					anchorY: targetY,
					rngSeed: 2
				}),
				createdAtTick: sim.tick,
				captures: 0,
				done: false
			}
		);

		internals.processAttacks();
		expect(internals.attacks).toEqual([]);
		expect(sim.owners[candidate]).toBe(2);
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
			captures: 0,
			done: false
		};

		const internals = sim as unknown as { attacks: AttackState[] };
		internals.attacks.push(attack);
		const territoryBefore = sim.players[0].territory;
		const result = sim.step();

		expect(sim.owners[isolatedIndex]).toBe(isolatedOwner);
		expect(sim.players[0].territory).toBe(territoryBefore);
		expect(result.snapshot.attacks.some((entry) => entry.id === attack.id)).toBe(false);
	});
});
