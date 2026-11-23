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
	const result = integrity.run(
		owners,
		land,
		anchors,
		(index, owner) => {
			owners[index] = owner;
			changed.set(index, owner);
		},
		(index) => {
			owners[index] = 0;
			changed.set(index, 0);
		}
	);
	return { changed, result };
}

function runPocketCleanup(
	owners: Uint16Array,
	land: Uint8Array,
	maxArea = 8
): {
	changed: Map<number, number>;
	result: ReturnType<TerritoryIntegrity['cleanupUnclaimedPockets']>;
} {
	const integrity = new TerritoryIntegrity(WIDTH, HEIGHT, 3);
	const changed = new Map<number, number>();
	const result = integrity.cleanupUnclaimedPockets(owners, land, maxArea, (index, owner) => {
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

	it('fills a small landlocked neutral pocket with its only neighbour', () => {
		const { owners, land } = makeGrid();
		fill(owners, 0, 0, WIDTH - 1, HEIGHT - 1, 1);
		const centre = 4 * WIDTH + 4;
		owners[centre] = 0;

		const { changed, result } = runPocketCleanup(owners, land);
		expect(result.filledComponents).toBe(1);
		expect(result.filledCells).toBe(1);
		expect(changed.get(centre)).toBe(1);
	});

	it('fills a small coastal pocket that still touches an owner', () => {
		const { owners, land } = makeGrid();
		fill(owners, 0, 0, WIDTH - 1, HEIGHT - 1, 1);
		const coastal = 4 * WIDTH + 4;
		owners[coastal] = 0;
		land[coastal + 1] = 0;

		const { changed, result } = runPocketCleanup(owners, land);
		expect(result.filledComponents).toBe(1);
		expect(changed.get(coastal)).toBe(1);
	});

	it('leaves neutral pockets with no owner contact', () => {
		const { owners, land } = makeGrid();
		const island = 4 * WIDTH + 4;
		land[island - 1] = 0;
		land[island + 1] = 0;
		land[island - WIDTH] = 0;
		land[island + WIDTH] = 0;

		const { changed } = runPocketCleanup(owners, land);
		expect(changed.size).toBe(0);
	});

	it('leaves neutral pockets larger than the cleanup limit', () => {
		const { owners, land } = makeGrid();
		fill(owners, 0, 0, WIDTH - 1, HEIGHT - 1, 1);
		fill(owners, 3, 3, 5, 5, 0);

		const { changed } = runPocketCleanup(owners, land, 4);
		expect(changed.size).toBe(0);
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

	it('abandons detached land that has no path to a protected mainland', () => {
		const { owners, land } = makeGrid();
		fill(owners, 0, 0, 2, 2, 1);
		owners[6 * WIDTH + 6] = 1;

		const { changed, result } = runAnnexation(owners, land);
		expect(result.annexedComponents).toBe(0);
		expect(result.abandonedComponents).toBe(1);
		expect(result.abandonedCells).toBe(1);
		expect(changed.get(6 * WIDTH + 6)).toBe(0);
		expect(owners[6 * WIDTH + 6]).toBe(0);
	});

	it('annexes a chain of detached components to the protected mainland', () => {
		const { owners, land } = makeGrid();
		fill(owners, 0, 0, 1, 2, 1);
		fill(owners, 2, 0, 2, 2, 2);
		fill(owners, 3, 0, 3, 2, 3);

		const { changed, result } = runAnnexation(owners, land, [{ index: 0, ownerId: 1 }]);
		expect(result.annexedCells).toBe(6);
		expect(result.abandonedCells).toBe(0);
		for (const owner of changed.values()) expect(owner).toBe(1);
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

describe('dirty-region pocket cleanup', () => {
	const GRID_WIDTH = 26;
	const GRID_HEIGHT = 22;
	const MAX_AREA = 12;

	/** Small deterministic LCG for repeatable random maps and mutations. */
	function makeRandom(seed: number): () => number {
		let state = seed >>> 0;
		return () => {
			state = (state * 1_664_525 + 1_013_904_223) >>> 0;
			return state / 0x1_0000_0000;
		};
	}

	function makeWorld(
		random: () => number,
		landPercent: number,
		ownerPercent: number
	): { owners: Uint16Array; land: Uint8Array } {
		const owners = new Uint16Array(GRID_WIDTH * GRID_HEIGHT);
		const land = new Uint8Array(GRID_WIDTH * GRID_HEIGHT);
		for (let index = 0; index < land.length; index++) {
			if (random() < landPercent) land[index] = 1;
			if (random() < ownerPercent) owners[index] = 1 + Math.floor(random() * 4);
			if (!land[index]) owners[index] = 0;
		}
		return { owners, land };
	}

	function cleanFull(
		integrity: TerritoryIntegrity,
		owners: Uint16Array,
		land: Uint8Array
	): Uint16Array {
		const cleaned = Uint16Array.from(owners);
		integrity.cleanupUnclaimedPockets(cleaned, land, MAX_AREA, (index, owner) => {
			cleaned[index] = owner;
		});
		return cleaned;
	}

	function runFull(land: Uint8Array, owners: Uint16Array): Uint16Array {
		const full = new TerritoryIntegrity(GRID_WIDTH, GRID_HEIGHT, 4);
		const result = Uint16Array.from(owners);
		full.cleanupUnclaimedPockets(result, land, MAX_AREA, (index, owner) => {
			result[index] = owner;
		});
		return result;
	}

	function runRegion(
		land: Uint8Array,
		owners: Uint16Array,
		changes: readonly number[]
	): Uint16Array {
		const region = new TerritoryIntegrity(GRID_WIDTH, GRID_HEIGHT, 4);
		const result = Uint16Array.from(owners);
		region.cleanupUnclaimedPocketsNearChanges(
			result,
			land,
			MAX_AREA,
			Uint32Array.from(changes),
			changes.length,
			(index, owner) => {
				result[index] = owner;
			}
		);
		return result;
	}

	it('fills the same pockets as a full pass after local ownership changes', () => {
		const random = makeRandom(0x51230abc);
		for (let round = 0; round < 40; round++) {
			const { owners, land } = makeWorld(
				random,
				0.45 + (round % 5) * 0.11,
				0.1 + (round % 7) * 0.12
			);
			const cleaner = new TerritoryIntegrity(GRID_WIDTH, GRID_HEIGHT, 4);
			// Start fully cleaned so the only eligible pockets are the ones the
			// mutations create or resize.
			const base = cleanFull(cleaner, owners, land);
			const mutated = Uint16Array.from(base);
			const changes: number[] = [];
			const mutationCount = 12 + (round % 9) * 5;
			for (let step = 0; step < mutationCount; step++) {
				const index = Math.floor(random() * mutated.length);
				mutated[index] = Math.floor(random() * 5);
				changes.push(index);
			}
			expect(runRegion(land, mutated, changes)).toEqual(runFull(land, mutated));
		}
	});

	it('skips oversized neutral regions exactly like the full pass', () => {
		const random = makeRandom(0x51230def);
		for (let round = 0; round < 12; round++) {
			const { owners, land } = makeWorld(random, 0.95, 0.08);
			const cleaner = new TerritoryIntegrity(GRID_WIDTH, GRID_HEIGHT, 4);
			const base = cleanFull(cleaner, owners, land);
			// Carve a neutral lake well above MAX_AREA, then mutate its border.
			const lakeX = 4 + (round % 8);
			const lakeY = 3 + (round % 6);
			for (let y = lakeY; y < lakeY + 8; y++) {
				for (let x = lakeX; x < lakeX + 8; x++) base[y * GRID_WIDTH + x] = 0;
			}
			const mutated = Uint16Array.from(base);
			const changes: number[] = [];
			for (let step = 0; step < 24; step++) {
				const index = lakeY * GRID_WIDTH + lakeX - 1 + step;
				mutated[index] = step % 3 === 0 ? 0 : 1 + (step % 4);
				changes.push(index);
			}
			expect(runRegion(land, mutated, changes)).toEqual(runFull(land, mutated));
		}
	});

	it('fills a pocket bisected by a claim and keeps lower-id tie-breaks', () => {
		const land = new Uint8Array(GRID_WIDTH * GRID_HEIGHT).fill(1);
		const owners = new Uint16Array(GRID_WIDTH * GRID_HEIGHT).fill(2);
		// 2x2 neutral pocket: owners 1 and 3 each own two sides (4 contacts).
		for (let y = 5; y <= 6; y++) {
			for (let x = 5; x <= 6; x++) owners[y * GRID_WIDTH + x] = 0;
		}
		owners[5 * GRID_WIDTH + 4] = 1;
		owners[6 * GRID_WIDTH + 4] = 1;
		owners[4 * GRID_WIDTH + 5] = 1;
		owners[4 * GRID_WIDTH + 6] = 1;
		owners[5 * GRID_WIDTH + 7] = 3;
		owners[6 * GRID_WIDTH + 7] = 3;
		owners[7 * GRID_WIDTH + 5] = 3;
		owners[7 * GRID_WIDTH + 6] = 3;

		const first = runRegion(land, owners, [5 * GRID_WIDTH + 5]);
		const second = runRegion(land, owners, [5 * GRID_WIDTH + 5]);
		expect(first).toEqual(second);
		// Equal border contact: lower owner id wins.
		expect(first[5 * GRID_WIDTH + 5]).toBe(1);
		expect(first[6 * GRID_WIDTH + 6]).toBe(1);
	});
});
