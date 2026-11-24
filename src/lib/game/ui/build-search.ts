import { HUMAN_PLAYER_ID, SHIFT_BUILD_SNAP_RADIUS } from '../constants';
import type { PublicCard } from '../structures';

/** The subset of build validation the nearest-site search depends on. */
export interface BuildSearchValidation {
	ok: boolean;
	/** Placement may snap (Ports snap to owned shoreline); defaults to the request cell. */
	targetX?: number;
	targetY?: number;
}

/**
 * Read-only simulation surface used by the shift-build search. Both the
 * authoritative `TerritorySimulation` and the main-thread worker mirror satisfy
 * it, which keeps the search pure and unit-testable.
 */
export interface BuildSearchSim {
	readonly width: number;
	readonly height: number;
	isLand(x: number, y: number): boolean;
	/** 0 when the cell is outside every district. */
	getDistrictStructureId(x: number, y: number): number;
	validateBuild(
		playerId: number,
		cardId: number,
		x: number,
		y: number,
		allowTightSpacing?: boolean
	): BuildSearchValidation;
}

export interface BuildSearchTarget {
	x: number;
	y: number;
	/** Placement used the tight-spacing fallback because no normal site existed. */
	tight: boolean;
}

export interface BuildSearchOptions {
	readonly playerId?: number;
	/** Ring search radius in cells; defaults to the shared shift-build radius. */
	readonly radius?: number;
}

interface Candidate {
	x: number;
	y: number;
	tight: boolean;
}

/**
 * Find the closest cell that can hold a *new* structure for `card`.
 *
 * Shift-build deliberately never stacks onto an existing district: the whole
 * point is to create another structure outside every district (Ports are point
 * anchors and may overlap). The search walks expanding square rings from the
 * cursor cell and accepts the closest candidate, preferring normal spacing over
 * the tight fallback at equal distance. Ring order and the final tie-break are
 * fixed so the same cursor cell always resolves to the same target.
 */
export function findNearestNewStructureSite(
	sim: BuildSearchSim,
	card: PublicCard,
	cellX: number,
	cellY: number,
	options: BuildSearchOptions = {}
): BuildSearchTarget | null {
	const playerId = options.playerId ?? HUMAN_PLAYER_ID;
	const maxRadius = Math.max(0, Math.floor(options.radius ?? SHIFT_BUILD_SNAP_RADIUS));
	const isNewStructureSite = (x: number, y: number) =>
		card.type === 'port' || sim.getDistrictStructureId(x, y) === 0;
	const evaluate = (x: number, y: number, tight: boolean): Candidate | null => {
		if (!isNewStructureSite(x, y)) return null;
		const validation = sim.validateBuild(playerId, card.id, x, y, tight);
		if (!validation.ok) return null;
		return {
			x: validation.targetX ?? x,
			y: validation.targetY ?? y,
			tight
		};
	};

	// The cursor cell itself wins when it is already a legal new-structure site.
	const origin = evaluate(cellX, cellY, false);
	if (origin) return origin;
	// Port placement already snaps to owned shoreline; there is no ring search.
	if (card.type === 'port') return null;

	for (let radius = 1; radius <= maxRadius; radius++) {
		let best: Candidate | null = null;
		let bestDistance = Number.POSITIVE_INFINITY;
		const minX = cellX - radius;
		const maxX = cellX + radius;
		const minY = cellY - radius;
		const maxY = cellY + radius;
		const consider = (x: number, y: number) => {
			if (x < 0 || y < 0 || x >= sim.width || y >= sim.height) return;
			if (!sim.isLand(x, y)) return;
			const candidate = evaluate(x, y, false) ?? evaluate(x, y, true);
			if (!candidate) return;
			const dx = candidate.x - cellX;
			const dy = candidate.y - cellY;
			const distance = dx * dx + dy * dy;
			if (
				distance < bestDistance ||
				(distance === bestDistance &&
					(best === null ||
						(candidate.tight === false && best.tight === true) ||
						(candidate.tight === best.tight &&
							(candidate.y < best.y || (candidate.y === best.y && candidate.x < best.x)))))
			) {
				best = candidate;
				bestDistance = distance;
			}
		};
		// Fixed perimeter order: top edge, bottom edge, then the left and right
		// edges top-to-bottom. Distance ties fall through to the comparator.
		for (let x = minX; x <= maxX; x++) {
			consider(x, minY);
			if (maxY !== minY) consider(x, maxY);
		}
		for (let y = minY + 1; y < maxY; y++) {
			consider(minX, y);
			if (maxX !== minX) consider(maxX, y);
		}
		// The first ring with any legal candidate wins: it is the closest.
		if (best) return best;
	}
	return null;
}
