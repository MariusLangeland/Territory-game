import { describe, expect, it } from 'vitest';
import type { GameSnapshot } from '../simulation';
import { RemoteEvolutionSimulation } from './evolution-view';
import type { WorkerMatchInit, WorkerVisual } from './evolution-worker-protocol';

function snapshotWith(structures: GameSnapshot['structures'] = []): GameSnapshot {
	return {
		tick: 4,
		seed: 1,
		landCount: 0,
		claimedLand: 0,
		players: [],
		alliances: [],
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
		humanId: 0,
		growthMode: 'circular'
	};
}

function init(): WorkerMatchInit {
	return {
		width: 64,
		height: 32,
		starts: [],
		terrain: new Uint8Array(64 * 32),
		terrainShade: new Uint8Array(64 * 32),
		terrainElevation: new Uint8Array(64 * 32),
		owners: new Uint16Array(64 * 32),
		districtColorCodes: new Uint8Array(64 * 32),
		snapshot: snapshotWith()
	};
}

function visual(overrides: Partial<WorkerVisual> = {}): WorkerVisual {
	return {
		matchId: 1,
		tick: 5,
		snapshot: snapshotWith(),
		changes: new Uint32Array(0),
		changeCount: 0,
		overflow: false,
		owners: null,
		districtColorCodes: null,
		districtTiles: [],
		districtTileColors: null,
		markovStates: [],
		...overrides
	};
}

describe('RemoteEvolutionSimulation', () => {
	it('applies worker owner and district deltas without stepping', () => {
		const view = new RemoteEvolutionSimulation(init());
		const changes = new Uint32Array([(2 << 21) | 10, (3 << 21) | 11]);
		const districtTileColors = new Uint8Array(32 * 32);
		districtTileColors[3] = 7;
		view.applyVisual(
			visual({
				changes,
				changeCount: 2,
				districtTiles: [0],
				districtTileColors
			})
		);
		expect(view.tick).toBe(5);
		expect(view.getOwner(10, 0)).toBe(2);
		expect(view.getOwner(11, 0)).toBe(3);
		expect(view.districtColorCodes[3]).toBe(7);
	});

	it('replaces full arrays on overflow and refreshes structure queries', () => {
		const view = new RemoteEvolutionSimulation(init());
		const owners = new Uint16Array(64 * 32);
		owners[5] = 4;
		const districtColorCodes = new Uint8Array(64 * 32);
		districtColorCodes[2] = 9;
		const structure = {
			id: 1,
			type: 'barracks' as const,
			ownerId: 4,
			x: 5,
			y: 0,
			stacks: 1,
			effects: [],
			readyAtTick: 0
		};
		view.applyVisual(
			visual({
				overflow: true,
				owners,
				districtColorCodes,
				snapshot: snapshotWith([structure])
			})
		);
		expect(view.getOwner(5, 0)).toBe(4);
		expect(view.districtColorCodes[2]).toBe(9);
		expect(view.structures.forOwner(4)).toEqual([structure]);
		expect(view.structures.at(5, 0)).toEqual(structure);
	});
});
