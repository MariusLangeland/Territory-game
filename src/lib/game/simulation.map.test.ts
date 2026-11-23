import { describe, expect, it } from 'vitest';
import {
	CHANGE_INDEX_BITS,
	CHANGE_INDEX_MASK,
	LAND_FRACTION,
	MAP_HEIGHT,
	MAP_WIDTH,
	MAX_PLAYER_COUNT,
	PALETTE,
	PLAYER_COUNT,
	PLAYER_NAMES
} from './constants';
import { generateMap } from './map';
import { TerritorySimulation } from './simulation';

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

	// Three full-map worlds take ~3.7s alone; parallel suites push past the
	// 5s default, so keep explicit headroom here.
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
	}, 15_000);
});

describe('world configuration', () => {
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
});

describe('arbitrary atlas sizes', () => {
	it('packs ownership changes beyond the old 21-bit index limit', () => {
		const sim = new TerritorySimulation({
			seed: 1234,
			playerCount: 2,
			width: 2048,
			height: 2048
		});
		const index = 2_100_000;
		const internals = sim as unknown as {
			claim(index: number, newOwner: number): void;
			changes: Uint32Array;
			changeCount: number;
		};
		internals.claim(index, 2);
		const packed = internals.changes[internals.changeCount - 1] ?? 0;
		expect(packed >>> CHANGE_INDEX_BITS).toBe(2);
		expect(packed & CHANGE_INDEX_MASK).toBe(index);
	});
});
