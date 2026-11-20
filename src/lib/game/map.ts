import {
	ELEVATION_LEVELS,
	LAND_FRACTION,
	MAP_HEIGHT,
	MAP_WIDTH,
	PLAYER_COUNT,
	START_RADIUS
} from './constants';
import { DeterministicRng } from './rng';

export interface StartPoint {
	index: number;
	x: number;
	y: number;
}

export interface GeneratedMap {
	width: number;
	height: number;
	/** 1 for land, 0 for ocean. Static for the lifetime of a map. */
	land: Uint8Array;
	/** 0-255 terrain brightness used by the renderer. Ocean is 0. */
	shade: Uint8Array;
	/** Discrete elevation tier per pixel, 0..ELEVATION_LEVELS-1. Ocean is 0. */
	elevation: Uint8Array;
	landCount: number;
	starts: StartPoint[];
}

const ELEVATION_RANGE = 65_536;

export function hash32(x: number, y: number, seed: number): number {
	let h = seed ^ Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1);
	h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
	h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
	return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Integer-lattice value noise. The interpolation uses ordinary IEEE arithmetic
 * with no transcendental functions, so results are stable across JS engines.
 * This is used only during map creation; the simulation itself is integer-based.
 */
function valueNoise(x: number, y: number, cell: number, seed: number): number {
	const ix = Math.floor(x / cell);
	const iy = Math.floor(y / cell);
	const fx = x / cell - ix;
	const fy = y / cell - iy;

	// Smoothstep.
	const sx = fx * fx * (3 - 2 * fx);
	const sy = fy * fy * (3 - 2 * fy);

	const a = hash32(ix, iy, seed) / 0x1_0000_0000;
	const b = hash32(ix + 1, iy, seed) / 0x1_0000_0000;
	const c = hash32(ix, iy + 1, seed) / 0x1_0000_0000;
	const d = hash32(ix + 1, iy + 1, seed) / 0x1_0000_0000;

	const top = a + (b - a) * sx;
	const bottom = c + (d - c) * sx;
	return top + (bottom - top) * sy;
}

const OCTAVES = [
	{ cell: 192, weight: 0.5 },
	{ cell: 96, weight: 0.25 },
	{ cell: 48, weight: 0.125 },
	{ cell: 24, weight: 0.0625 },
	{ cell: 12, weight: 0.03125 }
] as const;

function fractalElevation(x: number, y: number, seed: number): number {
	let total = 0;
	let weight = 0;

	for (let o = 0; o < OCTAVES.length; o++) {
		const octave = OCTAVES[o];
		const ox = (o + 1) * 137;
		const oy = (o + 1) * 311;
		total += valueNoise(x + ox, y + oy, octave.cell, (seed + o * 0x9e3779b9) >>> 0) * octave.weight;
		weight += octave.weight;
	}

	return total / weight;
}

function quantiseElevation(x: number, y: number, seed: number): number {
	let elevation = fractalElevation(x, y, seed);

	// Pull the map edges down into ocean so the playfield reads as an atlas.
	const edge = Math.min(x, MAP_WIDTH - 1 - x, y, MAP_HEIGHT - 1 - y);
	const edgeFade = Math.min(1, edge / 74);
	elevation *= 0.72 + 0.28 * edgeFade;

	// A second, broad signal creates recognisable continents instead of a
	// uniformly noisy archipelago.
	const continental = valueNoise(x, y, 440, (seed ^ 0xa53c9e1d) >>> 0);
	elevation = elevation * 0.66 + continental * 0.34;

	return Math.max(0, Math.min(0xffff, Math.round(elevation * 0xffff)));
}

interface Candidate {
	index: number;
	x: number;
	y: number;
}

function localLandDensity(land: Uint8Array, index: number, radius: number): number {
	const x = index % MAP_WIDTH;
	const y = (index - x) / MAP_WIDTH;
	const step = Math.max(1, Math.floor(radius / 10));
	let landSamples = 0;
	let total = 0;

	for (let dy = -radius; dy <= radius; dy += step) {
		const yy = y + dy;
		if (yy < 0 || yy >= MAP_HEIGHT) continue;
		for (let dx = -radius; dx <= radius; dx += step) {
			if (dx * dx + dy * dy > radius * radius) continue;
			const xx = x + dx;
			if (xx < 0 || xx >= MAP_WIDTH) continue;
			total++;
			if (land[yy * MAP_WIDTH + xx]) landSamples++;
		}
	}

	return total === 0 ? 0 : landSamples / total;
}

function chooseStarts(land: Uint8Array, seed: number): StartPoint[] {
	const rng = new DeterministicRng((seed ^ 0x51ed270b) >>> 0);
	const candidates: Candidate[] = [];
	const targetCandidates = Math.max(1_200, PLAYER_COUNT * 64);
	const maxAttempts = 400_000;
	let attempts = 0;

	while (candidates.length < targetCandidates && attempts < maxAttempts) {
		attempts++;
		const index = rng.nextInt(land.length);
		if (!land[index]) continue;
		const x = index % MAP_WIDTH;
		const y = (index - x) / MAP_WIDTH;
		if (localLandDensity(land, index, START_RADIUS + 10) < 0.64) continue;
		candidates.push({ index, x, y });
	}

	if (candidates.length < PLAYER_COUNT) {
		throw new Error('Map generation did not produce enough land for player starts.');
	}

	// Seed the farthest-point sampler near the centre of the world so the first
	// player starts in the middle of a landmass rather than on a remote edge.
	const cx = MAP_WIDTH / 2;
	const cy = MAP_HEIGHT / 2;
	candidates.sort((a, b) => {
		const da = (a.x - cx) ** 2 + (a.y - cy) ** 2;
		const db = (b.x - cx) ** 2 + (b.y - cy) ** 2;
		return da - db || a.index - b.index;
	});

	const chosen: Candidate[] = [];
	const removed = new Uint8Array(candidates.length);
	const nearestDistance = new Float64Array(candidates.length);
	nearestDistance.fill(Number.POSITIVE_INFINITY);

	const first = candidates[0];
	chosen.push(first);
	removed[0] = 1;
	for (let i = 1; i < candidates.length; i++) {
		const dx = candidates[i].x - first.x;
		const dy = candidates[i].y - first.y;
		nearestDistance[i] = dx * dx + dy * dy;
	}

	// Keep 51 beachheads from interpenetrating. The map has far more than
	// enough land for this packing; the fallback exists only for pathological
	// seeds and still produces a deterministic set of starts.
	const preferredSpacing = (START_RADIUS * 2 + 2) ** 2;

	while (chosen.length < PLAYER_COUNT) {
		let bestIndex = -1;
		let bestDistance = -1;

		for (let i = 1; i < candidates.length; i++) {
			if (removed[i]) continue;
			const distance = nearestDistance[i];
			if (distance < preferredSpacing) continue;
			if (distance > bestDistance) {
				bestDistance = distance;
				bestIndex = i;
			}
		}

		if (bestIndex === -1) {
			for (let i = 1; i < candidates.length; i++) {
				if (removed[i]) continue;
				if (nearestDistance[i] > bestDistance) {
					bestDistance = nearestDistance[i];
					bestIndex = i;
				}
			}
		}

		if (bestIndex === -1) break;
		const next = candidates[bestIndex];
		chosen.push(next);
		removed[bestIndex] = 1;

		for (let i = 1; i < candidates.length; i++) {
			if (removed[i]) continue;
			const dx = candidates[i].x - next.x;
			const dy = candidates[i].y - next.y;
			const distance = dx * dx + dy * dy;
			if (distance < nearestDistance[i]) nearestDistance[i] = distance;
		}
	}

	if (chosen.length < PLAYER_COUNT) {
		throw new Error(`Map generation could only place ${chosen.length}/${PLAYER_COUNT} starts.`);
	}

	return chosen.map((candidate) => ({
		index: candidate.index,
		x: candidate.x,
		y: candidate.y
	}));
}

/**
 * Builds a versioned, deterministic pixel world.
 *
 * The map is gameplay data, not decoration: every client must generate the exact
 * same `land` mask from the same seed. If this algorithm changes, increment
 * MAP_VERSION in constants.ts.
 */
export function generateMap(seed: number): GeneratedMap {
	const width = MAP_WIDTH;
	const height = MAP_HEIGHT;
	const pixelCount = width * height;
	const elevations = new Uint16Array(pixelCount);
	const histogram = new Uint32Array(1024);

	for (let y = 0; y < height; y++) {
		const row = y * width;
		for (let x = 0; x < width; x++) {
			const elevation = quantiseElevation(x, y, seed);
			elevations[row + x] = elevation;
			histogram[elevation >>> 6]++;
		}
	}

	const desiredLand = Math.floor(pixelCount * LAND_FRACTION);
	let accumulated = 0;
	let thresholdBin = 0;
	for (let bin = 1023; bin >= 0; bin--) {
		accumulated += histogram[bin];
		if (accumulated >= desiredLand) {
			thresholdBin = bin;
			break;
		}
	}
	const threshold = thresholdBin << 6;

	const land = new Uint8Array(pixelCount);
	const shade = new Uint8Array(pixelCount);
	let landCount = 0;
	let max = threshold;
	for (let i = 0; i < pixelCount; i++) {
		if (elevations[i] >= threshold) {
			land[i] = 1;
			landCount++;
			if (elevations[i] > max) max = elevations[i];
		}
	}

	const span = Math.max(1, max - threshold);
	const elevation = new Uint8Array(pixelCount);
	const heightHistogram = new Uint32Array(1024);
	for (let i = 0; i < pixelCount; i++) {
		if (!land[i]) continue;
		const heightRatio = Math.min(1, (elevations[i] - threshold) / span);
		heightHistogram[Math.min(1023, Math.floor(heightRatio * 1023))]++;
	}

	// Land quantiles keep every tier visible: most land is lowland, while peaks
	// remain rare. Thresholds are deterministic and independent of ownership.
	const elevationThresholds = landQuantileThresholds(heightHistogram, landCount);
	let detailSeed = (seed ^ 0x7f4a7c15) >>> 0;
	for (let y = 0; y < height; y++) {
		const row = y * width;
		for (let x = 0; x < width; x++) {
			const i = row + x;
			if (!land[i]) continue;
			const heightRatio = Math.min(1, (elevations[i] - threshold) / span);
			const bin = Math.min(1023, Math.floor(heightRatio * 1023));
			let level = 0;
			for (const cutoff of elevationThresholds) {
				if (bin >= cutoff) level++;
			}
			elevation[i] = Math.min(ELEVATION_LEVELS - 1, level);

			const grain = (hash32(x, y, detailSeed) & 0xff) / 255;
			shade[i] = Math.max(0, Math.min(255, Math.round(118 + heightRatio * 105 + grain * 22)));
		}
	}
	detailSeed = (detailSeed + 1) >>> 0;

	const starts = chooseStarts(land, seed);

	return { width, height, land, shade, elevation, landCount, starts };
}

/** Quantile cutoffs for the five boundaries between the six elevation tiers. */
function landQuantileThresholds(histogram: Uint32Array, landCount: number): Uint16Array {
	const fractions = [0.45, 0.65, 0.8, 0.92, 0.98];
	const thresholds = new Uint16Array(fractions.length);
	let cumulative = 0;
	let target = 0;

	for (let bin = 0; bin < histogram.length && target < fractions.length; bin++) {
		cumulative += histogram[bin];
		while (target < fractions.length && cumulative >= landCount * fractions[target]) {
			thresholds[target++] = bin;
		}
	}
	while (target < fractions.length) thresholds[target++] = 1023;
	return thresholds;
}
