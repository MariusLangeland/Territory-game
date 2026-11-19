import { describe, expect, it } from 'vitest';
import { generateMap } from './map';
import { TerritorySimulation } from './simulation';
import { LAND_FRACTION, MAP_HEIGHT, MAP_WIDTH } from './constants';

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

function bruteForceBorder(sim: TerritorySimulation, playerId: number): Set<number> {
	const expected = new Set<number>();
	for (let y = 0; y < sim.height; y++) {
		for (let x = 0; x < sim.width; x++) {
			if (sim.getOwner(x, y) !== playerId) continue;
			const neighbours = [
				[x - 1, y],
				[x + 1, y],
				[x, y - 1],
				[x, y + 1]
			];
			if (neighbours.some(([nx, ny]) => sim.isLand(nx, ny) && sim.getOwner(nx, ny) !== playerId)) {
				const index = y * sim.width + x;
				expected.add(index);
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
		expect(a.starts).toHaveLength(8);
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

		for (const player of sim.players) {
			if (!player.alive) {
				expect(player.border.size).toBe(0);
				continue;
			}
			const expected = bruteForceBorder(sim, player.id);
			expect(player.border.size).toBe(expected.size);
			for (const index of expected) expect(player.border.has(index)).toBe(true);
		}
	});
});
