import { describe, expect, it } from 'vitest';
import type { GameSnapshot } from '../simulation';
import type { LocalWorkerClient } from './local-client';
import type { LocalWorkerInit } from './local-protocol';
import { WorkerLocalSimulation } from './local-simulation';

const WIDTH = 48;
const HEIGHT = 16;
/** Only column x = 5 is land, so every land cell is a shore. */
const SHORE_X = 5;

function snapshot(
	structures: GameSnapshot['structures'] = [],
	alliances: GameSnapshot['alliances'] = []
): GameSnapshot {
	return {
		tick: 4,
		seed: 1,
		landCount: HEIGHT,
		claimedLand: 0,
		players: [],
		alliances,
		allianceProposals: [],
		attacks: [],
		shells: [],
		navalLandings: [],
		structures,
		gold: 0,
		income: 0,
		supply: 0,
		supplyCap: 0,
		supplyIncome: 0,
		hand: [],
		attackOrders: 0,
		attackOrderCap: 0,
		winnerId: null,
		ended: false,
		humanId: 1,
		growthMode: 'organic'
	};
}

function makeSim(
	options: {
		owners?: Map<number, number>;
		structures?: GameSnapshot['structures'];
		alliances?: GameSnapshot['alliances'];
		land?: boolean;
	} = {}
): WorkerLocalSimulation {
	const terrain = new Uint8Array(WIDTH * HEIGHT);
	const owners = new Uint16Array(WIDTH * HEIGHT);
	if (options.land !== false) {
		for (let y = 0; y < HEIGHT; y++) terrain[y * WIDTH + SHORE_X] = 1;
	}
	for (const [index, owner] of options.owners ?? []) owners[index] = owner;
	const init: LocalWorkerInit = {
		type: 'init',
		config: {
			seed: 1,
			width: WIDTH,
			height: HEIGHT,
			playerCount: 2,
			growthMode: 'organic',
			botDifficulty: 'standard',
			matchDurationTicks: 0,
			botCommandPostStacks: 0
		},
		width: WIDTH,
		height: HEIGHT,
		starts: [],
		terrain,
		terrainShade: new Uint8Array(WIDTH * HEIGHT),
		terrainElevation: new Uint8Array(WIDTH * HEIGHT),
		owners,
		districtColorCodes: new Uint8Array(WIDTH * HEIGHT),
		snapshot: snapshot(options.structures ?? [], options.alliances ?? []),
		mergedDistricts: []
	};
	// The preview query never touches the worker client.
	return new WorkerLocalSimulation(init, {} as unknown as LocalWorkerClient);
}

function cellIndex(x: number, y: number): number {
	return y * WIDTH + x;
}

describe('WorkerLocalSimulation naval snap preview', () => {
	it('resolves the nearest non-friendly shore within 32 px', () => {
		const sim = makeSim({ owners: new Map([[cellIndex(SHORE_X, 10), 2]]) });
		expect(sim.resolveNavalTarget(1, 10, 10)).toEqual({ x: SHORE_X, y: 10 });
	});

	it('skips friendly shores', () => {
		const sim = makeSim({ owners: new Map([[cellIndex(SHORE_X, 10), 1]]) });
		// The friendly cell is closest; the neutral neighbours tie on distance
		// and resolve by lower map index.
		expect(sim.resolveNavalTarget(1, 10, 10)).toEqual({ x: SHORE_X, y: 9 });
	});

	it('skips allied shores', () => {
		const sim = makeSim({
			owners: new Map([[cellIndex(SHORE_X, 10), 2]]),
			alliances: [{ id: 1, playerA: 1, playerB: 2, startedAtTick: 0, expiresAtTick: 100 }]
		});
		expect(sim.resolveNavalTarget(1, 10, 10)).toEqual({ x: SHORE_X, y: 9 });
	});

	it('skips structure-occupied shores', () => {
		const sim = makeSim({
			owners: new Map([[cellIndex(SHORE_X, 10), 2]]),
			structures: [
				{
					id: 1,
					type: 'port',
					ownerId: 2,
					x: SHORE_X,
					y: 10,
					stacks: 1,
					effects: [],
					readyAtTick: 0
				}
			]
		});
		expect(sim.resolveNavalTarget(1, 10, 10)).toEqual({ x: SHORE_X, y: 9 });
	});

	it('respects the NAVAL_TARGET_SNAP_RADIUS bound', () => {
		// 34 px from the coast is outside the 32 px snap radius.
		expect(makeSim().resolveNavalTarget(1, SHORE_X + 34, 10)).toBeNull();
		// 31 px is inside.
		expect(makeSim().resolveNavalTarget(1, SHORE_X + 31, 10)).toEqual({ x: SHORE_X, y: 10 });
	});

	it('returns null when the map has no shores', () => {
		expect(makeSim({ land: false }).resolveNavalTarget(1, 10, 10)).toBeNull();
	});
});
