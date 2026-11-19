import { describe, expect, it } from 'vitest';
import { TerritoryIntegrity } from './integrity';

const WIDTH = 9;
const HEIGHT = 9;

function makeGrid(): { owners: Uint16Array; land: Uint8Array } {
	const owners = new Uint16Array(WIDTH * HEIGHT);
	const land = new Uint8Array(WIDTH * HEIGHT).fill(1);
	return { owners, land };
}

function fill(
	owners: Uint16Array,
	x0: number,
	y0: number,
	x1: number,
	y1: number,
	owner: number
): void {
	for (let y = y0; y <= y1; y++) {
		for (let x = x0; x <= x1; x++) owners[y * WIDTH + x] = owner;
	}
}

function runAnnexation(
	owners: Uint16Array,
	land: Uint8Array,
	anchors = [{ index: 0, ownerId: 1 }]
): { changed: Map<number, number>; result: ReturnType<TerritoryIntegrity['run']> } {
	const integrity = new TerritoryIntegrity(WIDTH, HEIGHT, 3);
	const changed = new Map<number, number>();
	const result = integrity.run(owners, land, anchors, (index, owner) => {
		owners[index] = owner;
		changed.set(index, owner);
	});
	return { changed, result };
}

describe('territory integrity', () => {
	it('annexes a detached pocket into the surrounding mainland', () => {
		const { owners, land } = makeGrid();
		fill(owners, 0, 0, WIDTH - 1, HEIGHT - 1, 2);
		fill(owners, 0, 0, 2, 2, 1);
		fill(owners, 6, 6, 7, 7, 1);

		const { changed, result } = runAnnexation(owners, land, [
			{ index: 0, ownerId: 1 },
			{ index: 8 * WIDTH + 8, ownerId: 2 }
		]);
		expect(result.annexedComponents).toBe(1);
		expect(result.annexedCells).toBe(4);
		expect(changed.size).toBe(4);
		for (const owner of changed.values()) expect(owner).toBe(2);
		expect(owners[6 * WIDTH + 6]).toBe(2);
		expect(owners[7 * WIDTH + 7]).toBe(2);
	});

	it('annexes a larger detached component that has no State structure', () => {
		const { owners, land } = makeGrid();
		fill(owners, 0, 0, WIDTH - 1, HEIGHT - 1, 2);
		fill(owners, 0, 0, 1, 1, 1);
		fill(owners, 5, 5, 7, 7, 1);

		const { changed, result } = runAnnexation(owners, land, [
			{ index: 0, ownerId: 1 },
			{ index: 8 * WIDTH + 8, ownerId: 2 }
		]);
		expect(result.annexedCells).toBe(9);
		for (const owner of changed.values()) expect(owner).toBe(2);
		expect(owners[5 * WIDTH + 5]).toBe(2);
	});

	it('leaves detached land alone when no protected mainland surrounds it', () => {
		const { owners, land } = makeGrid();
		fill(owners, 0, 0, 2, 2, 1);
		owners[6 * WIDTH + 6] = 1;

		const { changed, result } = runAnnexation(owners, land);
		expect(result.annexedComponents).toBe(0);
		expect(changed.size).toBe(0);
		expect(owners[6 * WIDTH + 6]).toBe(1);
	});

	it('chooses the protected mainland with the largest shared border on a tie by lower id', () => {
		const { owners, land } = makeGrid();
		fill(owners, 0, 0, WIDTH - 1, HEIGHT - 1, 2);
		fill(owners, 0, 0, 1, 1, 1);
		for (let y = 0; y < HEIGHT; y++) {
			for (let x = 0; x < WIDTH; x++) {
				if (x >= 4 || y >= 4) owners[y * WIDTH + x] = 3;
			}
		}
		// Restore two sides of the pocket to player 2 so each claimant has two
		// contacts, then place the detached player-1 pixel in the middle.
		owners[4 * WIDTH + 3] = 2;
		owners[3 * WIDTH + 4] = 2;
		owners[4 * WIDTH + 4] = 1;

		const { changed } = runAnnexation(owners, land, [
			{ index: 0, ownerId: 1 },
			{ index: 2 * WIDTH + 2, ownerId: 2 },
			{ index: 8 * WIDTH + 8, ownerId: 3 }
		]);
		expect(changed.size).toBe(1);
		expect(changed.get(4 * WIDTH + 4)).toBe(2);
	});
});
