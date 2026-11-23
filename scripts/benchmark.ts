import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { generateMap } from '../src/lib/game/map';
import { GROWTH_MODES } from '../src/lib/game/growth';
import { TerritorySimulation } from '../src/lib/game/simulation';
import { MAP_HEIGHT, MAP_WIDTH, PLAYER_COUNT } from '../src/lib/game/constants';

/**
 * Repeatable Node profiling baseline. Every section uses fixed seeds, fixed
 * iteration counts, and discarded warmup iterations so two runs on the same
 * machine are comparable. Timing output is wall-clock and therefore only
 * directional; the map cache is handled explicitly below.
 */

const TICK_BUDGET_MS = 100;
const LABEL_WIDTH = 46;
const MAP_GENERATION_ITERATIONS = 5;
const ANNEX_SCAN_ITERATIONS = 20;
const CLEANUP_ITERATIONS = 20;
const CHECKSUM_ITERATIONS = 5;
/** A cache hit returns in ~0.001 ms; a real generation needs at least this long. */
const COLD_GENERATION_MIN_MS = 10;

interface TimingStats {
	iterations: number;
	meanMs: number;
	p95Ms: number;
	totalMs: number;
}

interface IntegrityProbe {
	annexDisconnectedTerritory(): {
		components: number;
		annexedComponents: number;
		annexedCells: number;
		abandonedComponents: number;
		abandonedCells: number;
	};
	cleanupUnclaimedPockets(): void;
}

interface TypedArrayBuffer {
	path: string;
	bytes: number;
}

interface TypedArrayFootprint {
	buffers: TypedArrayBuffer[];
	totalBytes: number;
	bufferCount: number;
	viewCount: number;
}

function section(title: string): void {
	console.log('');
	console.log(title);
	console.log('-'.repeat(title.length));
}

function formatMiB(bytes: number): string {
	return (bytes / 1024 / 1024).toFixed(1);
}

/** Nearest-rank percentile over ascending samples; stable for small samples. */
function percentile(sorted: readonly number[], fraction: number): number {
	if (sorted.length === 0) return 0;
	const rank = Math.ceil(fraction * sorted.length);
	const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
	return sorted[index] ?? 0;
}

function measure(
	label: string,
	iterations: number,
	fn: () => void,
	warmupIterations = Math.min(5, iterations)
): TimingStats {
	for (let i = 0; i < warmupIterations; i++) fn();

	const samples = new Array<number>(iterations);
	const totalStarted = performance.now();
	for (let i = 0; i < iterations; i++) {
		const started = performance.now();
		fn();
		samples[i] = performance.now() - started;
	}
	const totalMs = performance.now() - totalStarted;

	const sorted = [...samples].sort((a, b) => a - b);
	let sum = 0;
	for (const sample of sorted) sum += sample;
	const stats: TimingStats = {
		iterations,
		meanMs: sum / iterations,
		p95Ms: percentile(sorted, 0.95),
		totalMs
	};
	console.log(
		`  ${label.padEnd(LABEL_WIDTH)}${stats.meanMs.toFixed(3).padStart(9)} ms/op   ` +
			`p95 ${stats.p95Ms.toFixed(2).padStart(8)} ms   (${iterations} ops in ${totalMs.toFixed(0)} ms)`
	);
	return stats;
}

/**
 * Collect the typed-array-backed buffers reachable from one simulation, with
 * one entry per ArrayBuffer so aliased views (for example `land` and
 * `map.land`) are not double-counted. Object and Map/Set internals are not
 * walked, so this is a lower bound on the simulation's real memory use.
 */
function inspectTypedArrays(root: object, maxDepth = 3): TypedArrayFootprint {
	const buffers = new Map<ArrayBufferLike, string>();
	const visited = new Set<object>();
	let viewCount = 0;

	const walk = (value: unknown, path: string, depth: number): void => {
		if (value === null || typeof value !== 'object') return;
		if (ArrayBuffer.isView(value)) {
			if (visited.has(value)) return;
			visited.add(value);
			viewCount++;
			const view = value as ArrayBufferView & { buffer: ArrayBufferLike };
			const buffer = view.buffer;
			const previous = buffers.get(buffer);
			// Keep the shortest path for aliased views; the root simulation fields
			// (`land`) read better than their map origin (`map.land`).
			if (previous === undefined || path.length < previous.length) buffers.set(buffer, path);
			return;
		}
		if (depth >= maxDepth) return;
		if (visited.has(value)) return;
		visited.add(value);
		const record = value as Record<string, unknown>;
		for (const key of Object.keys(record)) {
			walk(record[key], path === '' ? key : `${path}.${key}`, depth + 1);
		}
	};

	walk(root, '', 0);

	const entries: TypedArrayBuffer[] = [];
	let totalBytes = 0;
	for (const [buffer, path] of buffers) {
		entries.push({ path, bytes: buffer.byteLength });
		totalBytes += buffer.byteLength;
	}
	entries.sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path));
	return { buffers: entries, totalBytes, bufferCount: buffers.size, viewCount };
}

console.log('Territory simulation benchmark');
console.log('==============================');
const cpu = os.cpus()[0]?.model ?? 'unknown CPU';
console.log(`Environment: Node ${process.version} on ${process.platform} ${process.arch}`);
console.log(`CPU: ${cpu} (${os.cpus().length} logical cores)`);
console.log(
	`Map: ${MAP_WIDTH} x ${MAP_HEIGHT} pixels = ${(MAP_WIDTH * MAP_HEIGHT).toLocaleString()} cells`
);
console.log(`States: ${PLAYER_COUNT} (1 human + ${PLAYER_COUNT - 1} attacking AI)`);
console.log('Timings are Node wall time on this machine; compare runs on the same hardware.');

// ---------------------------------------------------------------------------
// Cold map generation
// ---------------------------------------------------------------------------
section('Map generation');
// `generateMap` keeps an LRU of the last six maps keyed by seed. Reusing one
// seed would measure a cache lookup (~0.001 ms/op). Use a unique seed for the
// discarded warmup generation and for every measured generation so each call
// pays the full noise/start-selection cost.
let coldMapSeed = 0xbeefcafe;
const coldGeneration = measure(
	'generate map + 51 starts (cold, unique seeds)',
	MAP_GENERATION_ITERATIONS,
	() => {
		generateMap(coldMapSeed++ >>> 0);
	},
	1
);
console.log(
	`  seeds: warmup 0x${(0xbeefcafe).toString(16)}, measured ` +
		`0x${(0xbeefcafe + 1).toString(16)}..0x${((coldMapSeed - 1) >>> 0).toString(16)} (unique per op)`
);
if (coldGeneration.meanMs < COLD_GENERATION_MIN_MS) {
	console.error(
		`  ERROR: cold map generation measured ${coldGeneration.meanMs.toFixed(3)} ms/op, ` +
			`expected at least ${COLD_GENERATION_MIN_MS} ms (seed cache hit?).`
	);
	process.exitCode = 1;
} else {
	console.log('  cold-cache guard: PASS (unique seeds were not served from the map cache)');
}

// ---------------------------------------------------------------------------
// Simulation tick
// ---------------------------------------------------------------------------
section('Simulation tick');
const sustained = new TerritorySimulation({ seed: 0x12345678 });
const sustainedStep = measure('steady 51-player all-bot tick', 1000, () => sustained.step());
const sustainedSnapshot = sustained.getSnapshot();

const busy = new TerritorySimulation({ seed: 0x87654321 });
for (let i = 0; i < 100; i++) busy.step();
const busyStep = measure('collision-heavy 51-player tick', 500, () => busy.step());
const busySnapshot = busy.getSnapshot();

section('Growth-layer comparison');
for (const mode of GROWTH_MODES) {
	const sim = new TerritorySimulation({ seed: 0x13572468, growthMode: mode });
	for (let i = 0; i < 100; i++) sim.step();
	measure(`growth=${mode} tick`, 300, () => sim.step());
	console.log(`  active fronts after ${mode} run: ${sim.getSnapshot().attacks.length}`);
}

// ---------------------------------------------------------------------------
// Integrity hot phases
// ---------------------------------------------------------------------------
section('Integrity scans (private calls on the heated collision world)');
// The integrity work is periodic and ownership-gated inside step(). Calling the
// private scan directly measures the worst-case full-map pass without waiting
// for its interval; warmup calls normalise ownership first so measured calls
// are steady-state scans.
const integrityProbe = busy as unknown as IntegrityProbe;
const annexWorkload = integrityProbe.annexDisconnectedTerritory();
console.log(
	`  annex scan state: ${annexWorkload.components} components, ` +
		`${annexWorkload.annexedCells} cells pending annexation, ${annexWorkload.abandonedCells} cells pending abandonment`
);
const annexScan = measure(
	'annexation scan (component labels + borders)',
	ANNEX_SCAN_ITERATIONS,
	() => integrityProbe.annexDisconnectedTerritory()
);
const cleanupScan = measure(
	'neutral-pocket cleanup (full-map worst case)',
	CLEANUP_ITERATIONS,
	() => integrityProbe.cleanupUnclaimedPockets()
);
// The benchmark world is static between calls, so no cells are dirty and the
// production dispatch takes the full-map fallback every iteration. Live matches
// normally probe dirty regions and only fall back on the first pass/overflow.
console.log(
	'  cleanup note: static benchmark world has no dirty cells, so each timed call takes the full-map fallback;'
);
console.log(
	'  live matches probe dirty regions and fall back to the full map only on the first pass or overflow.'
);

// ---------------------------------------------------------------------------
// Checksum
// ---------------------------------------------------------------------------
section('Checksum');
const checksum = measure('full-state checksum', CHECKSUM_ITERATIONS, () => busy.checksum());

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------
section('Memory (one steady 51-player simulation)');
const footprint = inspectTypedArrays(sustained);
console.log(
	`  typed-array buffers: ${formatMiB(footprint.totalBytes)} MiB across ` +
		`${footprint.bufferCount} ArrayBuffers (${footprint.viewCount} views)`
);
console.log('  (one entry per ArrayBuffer; JS heap and Map/Set internals excluded)');
console.log('  largest buffers:');
for (const buffer of footprint.buffers.slice(0, 10)) {
	console.log(`    ${buffer.path.padEnd(48)}${formatMiB(buffer.bytes).padStart(9)} MiB`);
}

const memory = process.memoryUsage();
console.log(`  process RSS: ${formatMiB(memory.rss)} MiB`);
console.log(`  process heap used: ${formatMiB(memory.heapUsed)} MiB`);
console.log(`  process arrayBuffers: ${formatMiB(memory.arrayBuffers)} MiB`);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
const annexPerTick = annexScan.meanMs / 30; // ANNEX_INTERVAL_TICKS = 30
const cleanupPerTick = cleanupScan.meanMs / 100; // UNCLAIMED_CLEANUP_INTERVAL_TICKS = 100
const amortisedIntegrity = annexPerTick + cleanupPerTick;
const sustainedPercent = (sustainedStep.meanMs / TICK_BUDGET_MS) * 100;
const busyPercent = (busyStep.meanMs / TICK_BUDGET_MS) * 100;

section('Summary');
console.log(
	`  steady 51-player tick: ${sustainedStep.meanMs.toFixed(3)} ms ` +
		`(${sustainedPercent.toFixed(2)}% of a ${TICK_BUDGET_MS} ms tick budget, p95 ${sustainedStep.p95Ms.toFixed(2)} ms)`
);
console.log(
	`  collision-heavy tick: ${busyStep.meanMs.toFixed(3)} ms ` +
		`(${busyPercent.toFixed(2)}% of a ${TICK_BUDGET_MS} ms tick budget, p95 ${busyStep.p95Ms.toFixed(2)} ms)`
);
console.log(
	`  cold map generation: ${coldGeneration.meanMs.toFixed(0)} ms ` +
		`(one-time per unique world seed, p95 ${coldGeneration.p95Ms.toFixed(0)} ms)`
);
console.log(
	`  integrity worst case when ownership changes: ${amortisedIntegrity.toFixed(3)} ms/tick amortised ` +
		`(annex ${annexScan.meanMs.toFixed(1)} ms / 30 ticks + cleanup ${cleanupScan.meanMs.toFixed(1)} ms / 100 ticks)`
);
console.log(`  checksum: ${checksum.meanMs.toFixed(1)} ms (on demand only, never per tick)`);
console.log(
	`  active fronts after runs: ${sustainedSnapshot.attacks.length} sustained / ${busySnapshot.attacks.length} collision-heavy`
);
console.log(
	`  per-simulation typed arrays: ${formatMiB(footprint.totalBytes)} MiB; ` +
		`process RSS: ${formatMiB(memory.rss)} MiB`
);
