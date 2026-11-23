/**
 * Pure integer map-index and district-geometry helpers.
 *
 * These functions take explicit state and never read simulation fields, so the
 * deterministic math stays identical no matter which module calls it.
 */

import { DISTRICT_NOISE_CELL } from '../constants';
import { hash32 } from '../map';
import { STRUCTURE_TYPE_CODES, type Structure } from '../structures';
import type { GrowthMode } from '../growth';

export function indexToX(index: number, width: number): number {
	return index % width;
}

export function indexToY(index: number, width: number): number {
	return (index - (index % width)) / width;
}

export function growthModeCode(mode: GrowthMode): number {
	switch (mode) {
		case 'circular':
			return 1;
		case 'smooth':
			return 2;
		case 'organic':
			return 3;
	}
}

/** Bilinear coarse value noise plus a faint per-pixel jitter, both integer. */
export function districtNoise(x: number, y: number, seed: number): number {
	const cell = DISTRICT_NOISE_CELL;
	const ix = Math.floor(x / cell);
	const iy = Math.floor(y / cell);
	const fx = x - ix * cell;
	const fy = y - iy * cell;
	const a = hash32(ix, iy, seed) & 0xff;
	const b = hash32(ix + 1, iy, seed) & 0xff;
	const c = hash32(ix, iy + 1, seed) & 0xff;
	const d = hash32(ix + 1, iy + 1, seed) & 0xff;
	const coarse =
		(a * (cell - fx) * (cell - fy) + b * fx * (cell - fy) + c * (cell - fx) * fy + d * fx * fy) /
		(cell * cell);
	const fine = hash32(x, y, seed ^ 0x85ebca6b) & 0xff;
	return (Math.floor(coarse) * 3 + fine) >> 2;
}

/**
 * Squared distance plus a small, continuous integer noise offset. The
 * offset both wiggles Voronoi split lines and lets the outer edge grow or
 * shrink by roughly two pixels. It is deterministic and structure-specific.
 */
export function districtDistance(
	structure: Structure,
	x: number,
	y: number,
	range: number,
	seed: number
): number {
	const dx = x - structure.x;
	const dy = y - structure.y;
	const distance = dx * dx + dy * dy;
	const noiseSeed = (seed ^ Math.imul(structure.id, 0x9e3779b9)) >>> 0;
	const noise = districtNoise(x, y, noiseSeed);
	return distance + (((noise - 128) * range) >> 5);
}

export function districtColorCode(structure: Structure): number {
	const base = STRUCTURE_TYPE_CODES[structure.type] * 4 - 3;
	return base + (structure.id % 4);
}
