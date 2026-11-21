import { describe, expect, it } from 'vitest';
import { adjacentWater, computeSeaComponents, isShoreIndex, SeaRouter } from './naval';

function mapFromRows(rows: readonly string[]): {
	width: number;
	height: number;
	land: Uint8Array;
} {
	const height = rows.length;
	const width = rows[0]?.length ?? 0;
	const land = new Uint8Array(width * height);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			land[y * width + x] = rows[y]?.[x] === '#' ? 1 : 0;
		}
	}
	return { width, height, land };
}

describe('naval routing', () => {
	it('detects shores and adjacent water', () => {
		const { width, height, land } = mapFromRows(['#####', '#...#', '#####']);
		expect(isShoreIndex(land, width, height, 1 * width + 0)).toBe(true);
		expect(isShoreIndex(land, width, height, 1 * width + 2)).toBe(false);
		const water = adjacentWater(land, width, height, 1 * width + 0);
		expect(water).toContain(1 * width + 1);
	});

	it('separates disconnected seas and finds a deterministic route', () => {
		const { width, height, land } = mapFromRows([
			'#########',
			'#...#...#',
			'#...#...#',
			'#########'
		]);
		const components = computeSeaComponents(land, width, height);
		expect(components[1 * width + 1]).toBeGreaterThan(0);
		expect(components[1 * width + 5]).toBeGreaterThan(0);
		expect(components[1 * width + 1]).not.toBe(components[1 * width + 5]);

		const router = new SeaRouter(land, width, height);
		expect(router.findPath(1 * width + 1, 1 * width + 5)).toBeNull();

		const connected = mapFromRows(['#########', '#.......#', '#.......#', '#########']);
		const openRouter = new SeaRouter(connected.land, connected.width, connected.height);
		const path = openRouter.findPath(1 * connected.width + 1, 1 * connected.width + 7);
		expect(path).not.toBeNull();
		expect(path?.length).toBe(7);
		expect(path?.[0]).toBe(1 * connected.width + 1);
		expect(path?.[path.length - 1]).toBe(1 * connected.width + 7);
	});
});
