import { describe, expect, it } from 'vitest';
import { ATTACK_IDLE_TICKS, ELEVATION_LEVELS, PLAYER_COUNT } from './constants';
import { createGrowthLayer } from './growth';
import { TerritorySimulation, type AttackState } from './simulation';
import { findAttackablePixel } from './simulation.test-helpers';

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

	const frontier = createGrowthLayer('organic', {
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

describe('fronts and combat', () => {
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
			claim(index: number, newOwner: number, sourceAttackId?: number): void;
			hasNeighbourOwner(index: number, ownerId: number): boolean;
		};
		const originalClaim = internals.claim.bind(sim);
		let captures = 0;
		let disconnectedCaptures = 0;

		internals.claim = (index: number, newOwner: number, sourceAttackId = 0) => {
			if (sourceAttackId !== 0 && !internals.hasNeighbourOwner(index, newOwner)) {
				disconnectedCaptures++;
			}
			if (sourceAttackId !== 0) captures++;
			originalClaim(index, newOwner, sourceAttackId);
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

		sim.setGrowthMode('organic');
		expect(sim.getSnapshot().growthMode).toBe('organic');
		sim.step();
		expect(sim.getSnapshot().growthMode).toBe('organic');

		const retained = sim.getSnapshot().attacks.filter((attack) => attack.attackerId === 1);
		expect(retained.every((attack) => attack.growthMode === 'organic')).toBe(true);

		const nextTarget = findAttackablePixel(sim, 1);
		expect(nextTarget).not.toBeNull();
		if (!nextTarget) return;
		expect(sim.enqueueAttack(1, nextTarget.x, nextTarget.y).ok).toBe(true);
		sim.step();
		const humanAttacks = sim.getSnapshot().attacks.filter((attack) => attack.attackerId === 1);
		expect(humanAttacks.some((attack) => attack.growthMode === 'organic')).toBe(true);

		sim.setGrowthMode('organic');
		sim.step();
		expect(sim.getSnapshot().growthMode).toBe('organic');
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
			mixState() {},
			snapshot() {
				return { mode: 'organic' as const, entries: [] as number[], rngState: 0 };
			},
			restore() {}
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

		const frontier = createGrowthLayer('organic', {
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
			growthMode: 'organic' as const,
			frontier: createGrowthLayer('organic', {
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
		const frontier = createGrowthLayer('organic', {
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

describe('elevation and defense', () => {
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
});
