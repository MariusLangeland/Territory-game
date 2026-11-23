import { describe, expect, it } from 'vitest';
import { UNCLAIMED_POCKET_MAX_AREA } from './constants';
import { TerritoryIntegrity, type IntegrityAnchor } from './integrity';
import { TerritorySimulation } from './simulation';

describe('territory integrity', () => {
	it('skips integrity and pocket scans when ownership did not change', () => {
		const sim = new TerritorySimulation({ seed: 112233, playerCount: 2, allPlayersBots: true });
		const internals = sim as unknown as {
			players: Array<{ isBot: boolean }>;
			annexDisconnectedTerritory(): void;
			cleanupUnclaimedPockets(): void;
		};
		for (const player of internals.players) player.isBot = false;
		let annexCalls = 0;
		let cleanupCalls = 0;
		const annex = internals.annexDisconnectedTerritory.bind(internals);
		internals.annexDisconnectedTerritory = () => {
			annexCalls++;
			return annex();
		};
		// Stub cleanup so its one-time startup pass cannot create an ownership
		// change that legitimately schedules a second annex scan.
		internals.cleanupUnclaimedPockets = () => {
			cleanupCalls++;
		};
		for (let tick = 0; tick < 150; tick++) sim.step();
		expect(annexCalls).toBe(1);
		expect(cleanupCalls).toBe(1);
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

	it('applies detached-pocket annexation atomically in one pass', () => {
		const sim = new TerritorySimulation({ seed: 667788 });
		const internals = sim as unknown as {
			annexDisconnectedTerritory(): { annexedCells: number; abandonedCells: number };
		};
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
		const result = internals.annexDisconnectedTerritory();
		expect(result.annexedCells).toBeGreaterThan(0);
		expect(sim.owners[pocket]).toBe(1);
	});

	it('carries Port protection across a transitive chain of shared seas', () => {
		const sim = new TerritorySimulation({ seed: 24680, playerCount: 2 });
		const internals = sim as unknown as {
			land: Uint8Array;
			seaComponents: Uint32Array;
			structures: {
				create(type: string, ownerId: number, x: number, y: number, width: number): unknown;
			};
			protectedPortAnchors(): IntegrityAnchor[];
		};
		const width = sim.width;
		const height = sim.height;
		const land = internals.land;
		const waterNeighbours: number[][] = [];
		const shores: number[] = [];
		for (let index = 0; index < land.length; index++) {
			if (!land[index]) continue;
			const x = index % width;
			const y = (index - x) / width;
			const waters: number[] = [];
			if (x > 0 && !land[index - 1]) waters.push(index - 1);
			if (x + 1 < width && !land[index + 1]) waters.push(index + 1);
			if (y > 0 && !land[index - width]) waters.push(index - width);
			if (y + 1 < height && !land[index + width]) waters.push(index + width);
			if (waters.length > 0) {
				shores.push(index);
				waterNeighbours[index] = waters;
			}
		}
		const bridge = shores.find((index) => (waterNeighbours[index]?.length ?? 0) >= 2);
		expect(bridge).toBeDefined();
		if (bridge === undefined) return;
		const others = shores.filter(
			(index) =>
				Math.abs((index % width) - (bridge % width)) +
					Math.abs(Math.floor(index / width) - Math.floor(bridge / width)) >
				8
		);
		const first = others[0];
		const last = others[others.length - 1];
		expect(first).toBeDefined();
		expect(last).toBeDefined();
		if (first === undefined || last === undefined) return;

		sim.owners.fill(0);
		// Keep the three test sites as isolated land components. The bridge site
		// gets two shores so it can join two distinct sea components.
		for (const index of [first, bridge, last]) sim.owners[index] = 1;
		const stateIndex = [first - 1, first + 1, first - width, first + width].find(
			(index) => index >= 0 && index < land.length && land[index] === 1 && sim.owners[index] === 0
		);
		expect(stateIndex).toBeDefined();
		if (stateIndex === undefined) return;
		sim.owners[stateIndex] = 1;

		const toXY = (index: number) => ({ x: index % width, y: Math.floor(index / width) });
		const a = toXY(first);
		const b = toXY(bridge);
		const c = toXY(last);
		const s = toXY(stateIndex);
		internals.structures.create('state', 1, s.x, s.y, width);
		internals.structures.create('port', 1, a.x, a.y, width);
		internals.structures.create('port', 1, b.x, b.y, width);
		internals.structures.create('port', 1, c.x, c.y, width);

		const aWaters = waterNeighbours[first] ?? [];
		const bWaters = waterNeighbours[bridge] ?? [];
		const cWaters = waterNeighbours[last] ?? [];
		for (const water of aWaters) internals.seaComponents[water] = 101;
		internals.seaComponents[bWaters[0] as number] = 101;
		internals.seaComponents[bWaters[1] as number] = 102;
		for (const water of cWaters) internals.seaComponents[water] = 102;

		const anchors = internals.protectedPortAnchors();
		const indexes = new Set(anchors.map((anchor) => anchor.index));
		expect(indexes.has(first)).toBe(true);
		expect(indexes.has(bridge)).toBe(true);
		expect(indexes.has(last)).toBe(true);
	});

	it('abandons an isolated owned island with no path to a State or Port', () => {
		const sim = new TerritorySimulation({ seed: 667788 });
		const internals = sim as unknown as {
			annexDisconnectedTerritory(): void;
			land: Uint8Array;
		};
		let island = -1;
		for (let candidate = 0; candidate < sim.owners.length; candidate++) {
			if (!internals.land[candidate] || sim.owners[candidate] !== 0) continue;
			const x = candidate % sim.width;
			const y = Math.floor(candidate / sim.width);
			let isolated = true;
			for (const [dx, dy] of [
				[-1, 0],
				[1, 0],
				[0, -1],
				[0, 1]
			]) {
				const nx = x + dx;
				const ny = y + dy;
				if (nx < 0 || ny < 0 || nx >= sim.width || ny >= sim.height) continue;
				if (sim.owners[ny * sim.width + nx] > 0) isolated = false;
			}
			if (isolated) {
				island = candidate;
				break;
			}
		}
		expect(island).toBeGreaterThan(-1);
		if (island < 0) return;
		sim.owners[island] = 1;
		internals.annexDisconnectedTerritory();
		expect(sim.owners[island]).toBe(0);
	});
});

interface OptimizationInternals {
	auraDefense: Uint16Array;
	rebuildAuraDefense(): void;
	claim(index: number, newOwner: number, attackId?: number): void;
	cleanupUnclaimedPockets(): void;
	cleanupDirtyCount: number;
	cleanupDirtyIndices: Uint32Array;
	cleanupNeedsFullScan: boolean;
	cleanupDirtyOverflow: boolean;
	land: Uint8Array;
	portComponentOf: Uint32Array | null;
	portComponentQueue: Uint32Array | null;
	protectedPortAnchors(): IntegrityAnchor[];
	computeStableBotBuildCell(player: { id: number }, type: string): number;
	findBotBuildCell(player: { id: number }, type: string): number;
	structures: {
		create(
			type: string,
			ownerId: number,
			x: number,
			y: number,
			width: number
		): { id: number; index: number };
		destroy(structure: { id: number }): boolean;
		reinforce(structure: { stacks: number }): number;
		forOwner(ownerId: number): Array<{ id: number; type: string; stacks: number }>;
		forOwnerType(ownerId: number, type: string): { id: number; stacks: number } | undefined;
	};
}

describe('simulation optimizations', () => {
	it('keeps localized aura defense identical to a full rebuild', () => {
		const sim = new TerritorySimulation({
			seed: 24601,
			width: 768,
			height: 512,
			playerCount: 8,
			allPlayersBots: true
		});
		const internals = sim as unknown as OptimizationInternals;
		const expectAuraMatchesFullRebuild = () => {
			const maintained = Uint16Array.from(internals.auraDefense);
			internals.rebuildAuraDefense();
			expect(Array.from(internals.auraDefense)).toEqual(Array.from(maintained));
		};

		for (let tick = 0; tick < 150; tick++) sim.step();
		expectAuraMatchesFullRebuild();

		// Capturing a structure cell razes it: that path must refresh aura for the
		// whole former district, not just the captured cell.
		const capturable = sim.structures.all.find((structure) => structure.type !== 'state');
		if (capturable) {
			internals.claim(capturable.index, 0);
			expectAuraMatchesFullRebuild();
		}

		for (let tick = 0; tick < 150; tick++) {
			sim.step();
			if (tick % 50 === 0) expectAuraMatchesFullRebuild();
		}
	});

	it('creates the same owner map as a full pocket pass at every dirty-region pass', () => {
		const sim = new TerritorySimulation({
			seed: 13579,
			width: 768,
			height: 512,
			playerCount: 8,
			allPlayersBots: true
		});
		const internals = sim as unknown as OptimizationInternals;
		const reference = new TerritoryIntegrity(768, 512, 8);
		const original = internals.cleanupUnclaimedPockets.bind(internals);
		let comparedPasses = 0;
		internals.cleanupUnclaimedPockets = () => {
			const regionPass =
				!internals.cleanupNeedsFullScan &&
				!internals.cleanupDirtyOverflow &&
				internals.cleanupDirtyCount > 0;
			if (regionPass) {
				const expected = Uint16Array.from(sim.owners);
				reference.cleanupUnclaimedPockets(
					expected,
					internals.land,
					UNCLAIMED_POCKET_MAX_AREA,
					(index, owner) => {
						expected[index] = owner;
					}
				);
				original();
				expect(Array.from(sim.owners)).toEqual(Array.from(expected));
				comparedPasses++;
				return;
			}
			original();
		};
		for (let tick = 0; tick < 400; tick++) sim.step();
		expect(comparedPasses).toBeGreaterThan(0);
	});

	it('allocates Port protection scratch only while a Port exists', () => {
		const sim = new TerritorySimulation({ seed: 2468, width: 512, height: 256, playerCount: 4 });
		const internals = sim as unknown as OptimizationInternals;
		expect(internals.portComponentOf).toBeNull();
		expect(internals.portComponentQueue).toBeNull();
		internals.protectedPortAnchors();
		expect(internals.portComponentOf).toBeNull();

		let site = -1;
		for (let index = 0; index < sim.owners.length && site < 0; index++) {
			if (sim.owners[index] !== 1) continue;
			site = index;
			break;
		}
		expect(site).toBeGreaterThan(-1);
		if (site < 0) return;
		const x = site % sim.width;
		const y = Math.floor(site / sim.width);
		const port = internals.structures.create('port', 1, x, y, sim.width);
		internals.protectedPortAnchors();
		expect(internals.portComponentOf).not.toBeNull();
		expect(internals.portComponentQueue).not.toBeNull();

		internals.structures.destroy(port);
		internals.protectedPortAnchors();
		expect(internals.portComponentOf).toBeNull();
		expect(internals.portComponentQueue).toBeNull();
	});

	it('re-validates cached bot build sites without rescanning on stack upgrades', () => {
		const sim = new TerritorySimulation({
			seed: 97531,
			width: 1024,
			height: 512,
			playerCount: 4,
			allPlayersBots: true
		});
		const internals = sim as unknown as OptimizationInternals;
		const player = sim.players[1];
		expect(player).toBeDefined();
		if (!player) return;
		let scans = 0;
		const original = internals.computeStableBotBuildCell.bind(internals);
		internals.computeStableBotBuildCell = (target, type) => {
			scans++;
			return (original as (player: { id: number }, kind: string) => number)(target, type);
		};

		const first = internals.findBotBuildCell(player, 'command-post');
		expect(first).toBeGreaterThanOrEqual(0);
		const scansAfterFirst = scans;
		expect(internals.findBotBuildCell(player, 'command-post')).toBe(first);
		expect(scans).toBe(scansAfterFirst);

		// A stack change mutates the registry but cannot change site validity.
		const state = internals.structures.forOwnerType(player.id, 'state');
		if (state) internals.structures.reinforce(state);
		expect(internals.findBotBuildCell(player, 'command-post')).toBe(first);
		expect(scans).toBe(scansAfterFirst);

		// Occupying the cached cell invalidates it on read; the next query finds
		// another legal site instead of trusting the cache.
		internals.structures.create(
			'barracks',
			player.id,
			first % sim.width,
			Math.floor(first / sim.width),
			sim.width
		);
		expect(internals.findBotBuildCell(player, 'command-post')).not.toBe(first);
	});
});
