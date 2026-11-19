import { describe, expect, it } from 'vitest';
import { generateMap } from './map';
import { TerritorySimulation, type AttackState } from './simulation';
import {
	ATTACK_LIFETIME_TICKS,
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

	it('runs many simultaneous bot fronts and keeps ownership valid', () => {
		const sim = new TerritorySimulation({ seed: 314159 });
		for (let tick = 0; tick < 80; tick++) {
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
		const attack: AttackState = {
			id: 999_999,
			attackerId: 1,
			defenderId: isolatedOwner,
			targetX,
			targetY,
			queue: new Uint32Array([isolatedIndex]),
			queueLength: 1,
			head: 0,
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
