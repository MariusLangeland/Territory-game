import { describe, expect, it } from 'vitest';
import { SHIFT_BUILD_SNAP_RADIUS } from '../constants';
import type { PublicCard } from '../structures';
import {
	findNearestNewStructureSite,
	type BuildSearchSim,
	type BuildSearchValidation
} from './build-search';

const BARRACKS: PublicCard = { id: 1, type: 'barracks' };
const PORT: PublicCard = { id: 2, type: 'port' };

/**
 * Minimal sim-like fixture: land is everywhere unless declared otherwise,
 * districts and valid build cells are explicit sets keyed by `y * width + x`.
 */
class FakeBuildSim implements BuildSearchSim {
	readonly width = 420;
	readonly height = 420;
	readonly water = new Set<number>();
	readonly districts = new Set<number>();
	readonly normalSites = new Set<number>();
	readonly tightSites = new Set<number>();
	readonly portSnap = new Map<number, number>();

	private index(x: number, y: number): number {
		return y * this.width + x;
	}

	isLand(x: number, y: number): boolean {
		return !this.water.has(this.index(x, y));
	}

	getDistrictStructureId(x: number, y: number): number {
		return this.districts.has(this.index(x, y)) ? 7 : 0;
	}

	validateBuild(
		_playerId: number,
		_cardId: number,
		x: number,
		y: number,
		allowTightSpacing = false
	): BuildSearchValidation {
		const index = this.index(x, y);
		const snapped = this.portSnap.get(index);
		if (snapped !== undefined) {
			return {
				ok: true,
				targetX: snapped % this.width,
				targetY: Math.floor(snapped / this.width)
			};
		}
		if (this.normalSites.has(index)) return { ok: true, targetX: x, targetY: y };
		if (allowTightSpacing && this.tightSites.has(index)) {
			return { ok: true, targetX: x, targetY: y };
		}
		return { ok: false };
	}

	setCell(set: Set<number>, x: number, y: number): void {
		set.add(this.index(x, y));
	}
}

function target(sim: FakeBuildSim, card: PublicCard, x: number, y: number) {
	return findNearestNewStructureSite(sim, card, x, y);
}

describe('shift-build nearest new-structure search', () => {
	it('returns the cursor cell when it is already a legal new-structure site', () => {
		const sim = new FakeBuildSim();
		sim.setCell(sim.normalSites, 10, 10);
		expect(target(sim, BARRACKS, 10, 10)).toEqual({ x: 10, y: 10, tight: false });
	});

	it('finds a site inside the 160 px ring search', () => {
		const sim = new FakeBuildSim();
		sim.setCell(sim.normalSites, 80, 40);
		expect(target(sim, BARRACKS, 50, 40)).toEqual({ x: 80, y: 40, tight: false });
	});

	it('stops searching at SHIFT_BUILD_SNAP_RADIUS', () => {
		const sim = new FakeBuildSim();
		// One cell past the default ring search never resolves.
		sim.setCell(sim.normalSites, 10 + SHIFT_BUILD_SNAP_RADIUS + 1, 10);
		expect(target(sim, BARRACKS, 10, 10)).toBeNull();
		// The same site is found once the caller widens the radius.
		expect(
			findNearestNewStructureSite(sim, BARRACKS, 10, 10, {
				radius: SHIFT_BUILD_SNAP_RADIUS + 1
			})
		).toEqual({ x: 11 + SHIFT_BUILD_SNAP_RADIUS, y: 10, tight: false });
	});

	it('prefers the closest ring over a farther legal site', () => {
		const sim = new FakeBuildSim();
		sim.setCell(sim.normalSites, 13, 10);
		sim.setCell(sim.normalSites, 40, 10);
		expect(target(sim, BARRACKS, 10, 10)).toEqual({ x: 13, y: 10, tight: false });
	});

	it('rejects district cells even when the sim would accept them', () => {
		const sim = new FakeBuildSim();
		sim.setCell(sim.districts, 10, 10);
		sim.setCell(sim.districts, 11, 10);
		sim.setCell(sim.normalSites, 11, 10);
		sim.setCell(sim.normalSites, 12, 10);
		expect(target(sim, BARRACKS, 10, 10)).toEqual({ x: 12, y: 10, tight: false });
	});

	it('skips ocean cells', () => {
		const sim = new FakeBuildSim();
		sim.setCell(sim.water, 10, 9);
		sim.setCell(sim.normalSites, 10, 9);
		sim.setCell(sim.normalSites, 10, 11);
		expect(target(sim, BARRACKS, 10, 10)).toEqual({ x: 10, y: 11, tight: false });
	});

	it('prefers normal spacing over the tight fallback at equal distance', () => {
		const sim = new FakeBuildSim();
		// Both cells are one step from the cursor. Ring order visits (10, 9)
		// first, but a normal-spacing site at equal distance must win.
		sim.setCell(sim.tightSites, 10, 9);
		sim.setCell(sim.normalSites, 11, 10);
		expect(target(sim, BARRACKS, 10, 10)).toEqual({ x: 11, y: 10, tight: false });
	});

	it('falls back to tight spacing when no normal site exists', () => {
		const sim = new FakeBuildSim();
		sim.setCell(sim.tightSites, 10, 12);
		expect(target(sim, BARRACKS, 10, 10)).toEqual({ x: 10, y: 12, tight: true });
	});

	it('still prefers a closer tight site over a farther normal site', () => {
		const sim = new FakeBuildSim();
		sim.setCell(sim.tightSites, 11, 10);
		sim.setCell(sim.normalSites, 20, 10);
		expect(target(sim, BARRACKS, 10, 10)).toEqual({ x: 11, y: 10, tight: true });
	});

	it('returns null when no legal site exists in range', () => {
		const sim = new FakeBuildSim();
		expect(target(sim, BARRACKS, 10, 10)).toBeNull();
	});

	it('uses the validation snap for Port placement and does not ring-search', () => {
		const sim = new FakeBuildSim();
		const shore = 20 * sim.width + 12;
		sim.portSnap.set(10 * sim.width + 9, shore);
		sim.setCell(sim.normalSites, 14, 10);
		expect(target(sim, PORT, 9, 10)).toEqual({ x: 12, y: 20, tight: false });
		// An invalid Port click never falls through to the structure ring search.
		expect(target(sim, PORT, 40, 40)).toBeNull();
	});
});
