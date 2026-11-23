/**
 * Long-run deterministic soak test.
 *
 * Runs one long headless match with normal bots and an idle human, sampling
 * every 1,000 ticks and at the final tick. Each sample is validated for
 * ownership-id range, finite numbers, checksum shape, and structure
 * integrity; the first violation aborts the run with a non-zero exit code.
 * The harness also checks that a fresh shorter world produces the same
 * checksum when replayed twice.
 *
 * Simulation logic reads no wall clock. RSS is sampled only for the memory
 * report and never feeds simulation behavior. See docs/TELEMETRY.md.
 */

import {
	TerritorySimulation,
	type BotDifficulty,
	type GameSnapshot
} from '../src/lib/game/simulation';
import { STRUCTURE_TYPES } from '../src/lib/game/structures';

const DEFAULT_TICKS = 10_000;
const DEFAULT_SEED = 1234;
const SAMPLE_INTERVAL_TICKS = 1000;
/** Fixed replay length for the determinism assertion, unless --ticks is smaller. */
const DETERMINISM_TICKS = 300;
const REPORT_VERSION = 1;

const USAGE = `Usage: pnpm exec tsx scripts/soak.ts [options]

Runs one long deterministic headless match, validates every sampled world, and
asserts that a short replay is checksum-stable. The human state is idle; bots
play normally.

Options:
  --ticks <max>   Maximum simulation ticks for the soak match (default ${DEFAULT_TICKS})
  --seed <n>      Unsigned 32-bit seed (default ${DEFAULT_SEED})
  --json          Print one JSON document instead of the text report
  --help, -h      Print this help text`;

class UsageError extends Error {}

interface CliOptions {
	ticks: number;
	seed: number;
	json: boolean;
	help: boolean;
}

interface SoakSample {
	tick: number;
	activeFronts: number;
	structuresTotal: number;
	districts: number;
	aliveStates: number;
	eliminations: number;
	/** Node process RSS at the sample, in MiB. Wall-clock-ish; never simulated. */
	rssMiB: number;
	checksum: number;
}

type SoakCheck = 'ownership' | 'economy' | 'checksum' | 'structures';

interface SoakViolation {
	tick: number;
	check: SoakCheck;
	detail: string;
}

interface DeterminismCheck {
	ticks: number;
	firstChecksum: number;
	secondChecksum: number;
	matches: boolean;
}

interface SoakSummary {
	endTick: number;
	ended: boolean;
	timeout: boolean;
	winnerId: number | null;
	winnerName: string | null;
	checksum: number;
	peakRssMiB: number;
	finalActiveFronts: number;
	finalStructuresTotal: number;
	finalDistricts: number;
	aliveStates: number;
	eliminations: number;
	samplesValidated: number;
}

interface SoakRun {
	samples: SoakSample[];
	summary: SoakSummary | null;
	playerCount: number;
	botDifficulty: BotDifficulty;
	violation: SoakViolation | null;
}

interface SoakReport {
	version: number;
	options: {
		seed: number;
		maxTicks: number;
		sampleIntervalTicks: number;
		states: number;
		botDifficulty: BotDifficulty;
	};
	determinism: DeterminismCheck;
	samples: SoakSample[];
	summary: SoakSummary;
}

function round(value: number, digits: number): number {
	const scale = 10 ** digits;
	return Math.round(value * scale) / scale;
}

function rssMiB(bytes: number): number {
	return round(bytes / (1024 * 1024), 2);
}

/**
 * A district is a live buildable structure that covers at least one cell. The
 * coverage map may retain State ids on capital cells and stale ids from razed
 * structures, so only live buildables are counted. Mirrors the telemetry
 * definition.
 */
function countDistricts(simulation: TerritorySimulation): number {
	const covered = new Set<number>();
	const coverage = simulation.districtStructureIds;
	for (let index = 0; index < coverage.length; index++) {
		const structureId = coverage[index] ?? 0;
		if (structureId !== 0) covered.add(structureId);
	}
	let districts = 0;
	for (const structure of simulation.structures.all) {
		if (structure.type !== 'state' && covered.has(structure.id)) districts += 1;
	}
	return districts;
}

function isFiniteNonNegative(value: number): boolean {
	return Number.isFinite(value) && value >= 0;
}

/**
 * Validate one sampled tick. Checks run in a fixed order so the first reported
 * violation is deterministic. Returns `null` when the world is healthy.
 */
function validateSample(
	simulation: TerritorySimulation,
	snapshot: GameSnapshot,
	checksum: number
): SoakViolation | null {
	const tick = snapshot.tick;
	const playerCount = simulation.playerCount;

	// Ownership ids: every cell is neutral (0) or a deployed player id.
	const owners = simulation.owners;
	for (let index = 0; index < owners.length; index++) {
		const owner = owners[index];
		if (owner > playerCount) {
			return {
				tick,
				check: 'ownership',
				detail: `cell ${index} has owner id ${owner} (max ${playerCount})`
			};
		}
	}

	// Player economy: no NaN/Infinity in territory or supply totals.
	for (const player of snapshot.players) {
		if (!Number.isInteger(player.territory) || player.territory < 0) {
			return {
				tick,
				check: 'economy',
				detail: `player ${player.id} territory is ${player.territory}`
			};
		}
		if (!isFiniteNonNegative(player.supply)) {
			return {
				tick,
				check: 'economy',
				detail: `player ${player.id} supply is ${player.supply}`
			};
		}
		if (!Number.isFinite(player.landShare) || player.landShare < 0) {
			return {
				tick,
				check: 'economy',
				detail: `player ${player.id} landShare is ${player.landShare}`
			};
		}
	}
	for (const [field, value] of [
		['gold', snapshot.gold],
		['income', snapshot.income],
		['supply', snapshot.supply],
		['supplyCap', snapshot.supplyCap],
		['supplyIncome', snapshot.supplyIncome]
	] as const) {
		if (!isFiniteNonNegative(value)) {
			return { tick, check: 'economy', detail: `snapshot.${field} is ${value}` };
		}
	}

	// Checksum: a finite integer replay digest.
	if (!Number.isFinite(checksum) || !Number.isInteger(checksum)) {
		return { tick, check: 'checksum', detail: `checksum is ${checksum}` };
	}

	// Structures: valid owners, ids, types, packed index, and stack counts. The
	// registry keeps the packed index; public snapshots only carry x/y.
	const structureIds = new Set<number>();
	const cellCount = simulation.width * simulation.height;
	for (const structure of simulation.structures.all) {
		if (!Number.isInteger(structure.id) || structure.id < 1) {
			return {
				tick,
				check: 'structures',
				detail: `structure "${structure.type}" has id ${structure.id}`
			};
		}
		if (structureIds.has(structure.id)) {
			return {
				tick,
				check: 'structures',
				detail: `duplicate structure id ${structure.id} (${structure.type})`
			};
		}
		structureIds.add(structure.id);
		if (
			!Number.isInteger(structure.ownerId) ||
			structure.ownerId < 1 ||
			structure.ownerId > playerCount
		) {
			return {
				tick,
				check: 'structures',
				detail: `structure ${structure.id} has owner ${structure.ownerId}`
			};
		}
		if (!STRUCTURE_TYPES.includes(structure.type)) {
			return {
				tick,
				check: 'structures',
				detail: `structure ${structure.id} has type "${structure.type}"`
			};
		}
		if (!Number.isInteger(structure.index) || structure.index < 0 || structure.index >= cellCount) {
			return {
				tick,
				check: 'structures',
				detail: `structure ${structure.id} has index ${structure.index}`
			};
		}
		if (!Number.isInteger(structure.stacks) || structure.stacks < 1) {
			return {
				tick,
				check: 'structures',
				detail: `structure ${structure.id} has stacks ${structure.stacks}`
			};
		}
	}

	return null;
}

function runSoak(seed: number, maxTicks: number): SoakRun {
	const simulation = new TerritorySimulation({ seed });
	let snapshot: GameSnapshot = simulation.getSnapshot();
	let ticks = 0;
	let eliminations = 0;
	const samples: SoakSample[] = [];
	let peakRssBytes = process.memoryUsage().rss;

	const sample = (): SoakViolation | null => {
		const checksum = simulation.checksum();
		const violation = validateSample(simulation, snapshot, checksum);
		if (violation) return violation;

		const rss = process.memoryUsage().rss;
		peakRssBytes = Math.max(peakRssBytes, rss);
		samples.push({
			tick: snapshot.tick,
			activeFronts: snapshot.attacks.length,
			structuresTotal: snapshot.structures.length,
			districts: countDistricts(simulation),
			aliveStates: snapshot.players.filter((player) => player.alive).length,
			eliminations,
			rssMiB: rssMiB(rss),
			checksum
		});
		return null;
	};

	while (!snapshot.ended && ticks < maxTicks) {
		const result = simulation.step();
		ticks += 1;
		snapshot = result.snapshot;
		for (const event of result.events) {
			if (event.kind === 'elimination') eliminations += 1;
		}

		// Sample on the fixed interval and always at the final tick so short runs
		// and early victories still get validated.
		const finalTick = ticks >= maxTicks || snapshot.ended;
		if (ticks % SAMPLE_INTERVAL_TICKS === 0 || finalTick) {
			const violation = sample();
			if (violation) {
				return {
					samples,
					summary: null,
					playerCount: simulation.playerCount,
					botDifficulty: simulation.botDifficulty,
					violation
				};
			}
		}
	}

	const aliveStates = snapshot.players.filter((player) => player.alive).length;
	const winner =
		snapshot.winnerId === null
			? null
			: (snapshot.players.find((player) => player.id === snapshot.winnerId) ?? null);

	return {
		samples,
		summary: {
			endTick: snapshot.tick,
			ended: snapshot.ended,
			timeout: !snapshot.ended,
			winnerId: snapshot.winnerId,
			winnerName: winner?.name ?? null,
			checksum: simulation.checksum(),
			peakRssMiB: rssMiB(peakRssBytes),
			finalActiveFronts: snapshot.attacks.length,
			finalStructuresTotal: snapshot.structures.length,
			finalDistricts: countDistricts(simulation),
			aliveStates,
			eliminations: snapshot.players.length - aliveStates,
			samplesValidated: samples.length
		},
		playerCount: simulation.playerCount,
		botDifficulty: simulation.botDifficulty,
		violation: null
	};
}

function checksumAfterTicks(seed: number, maxTicks: number): number {
	const simulation = new TerritorySimulation({ seed });
	let snapshot = simulation.getSnapshot();
	let remaining = maxTicks;
	while (!snapshot.ended && remaining > 0) {
		snapshot = simulation.step().snapshot;
		remaining -= 1;
	}
	return simulation.checksum();
}

/** Replay a fresh short world twice and compare authoritative checksums. */
function runDeterminismCheck(seed: number, ticks: number): DeterminismCheck {
	const firstChecksum = checksumAfterTicks(seed, ticks);
	const secondChecksum = checksumAfterTicks(seed, ticks);
	return {
		ticks,
		firstChecksum,
		secondChecksum,
		matches: firstChecksum === secondChecksum
	};
}

function pad(value: string | number, width: number, align: 'left' | 'right' = 'left'): string {
	const text = String(value);
	return align === 'right' ? text.padStart(width) : text.padEnd(width);
}

function formatReport(report: SoakReport): string {
	const lines: string[] = [];
	const options = report.options;
	const summary = report.summary;

	lines.push('TERRITORY SOAK');
	lines.push(
		`seed=${options.seed}  maxTicks=${options.maxTicks}  ` +
			`sampleInterval=${options.sampleIntervalTicks}  states=${options.states}  ` +
			`difficulty=${options.botDifficulty}  human=id 1 (idle)`
	);
	lines.push('');

	lines.push('SAMPLES');
	lines.push(
		[
			pad('tick', 7, 'right'),
			pad('fronts', 7, 'right'),
			pad('structs', 8, 'right'),
			pad('districts', 10, 'right'),
			pad('alive', 6, 'right'),
			pad('elim', 5, 'right'),
			pad('rssMiB', 8, 'right'),
			pad('checksum', 12, 'right')
		].join(' ')
	);
	for (const entry of report.samples) {
		lines.push(
			[
				pad(entry.tick, 7, 'right'),
				pad(entry.activeFronts, 7, 'right'),
				pad(entry.structuresTotal, 8, 'right'),
				pad(entry.districts, 10, 'right'),
				pad(entry.aliveStates, 6, 'right'),
				pad(entry.eliminations, 5, 'right'),
				pad(entry.rssMiB.toFixed(2), 8, 'right'),
				pad(entry.checksum, 12, 'right')
			].join(' ')
		);
	}
	lines.push('');

	const determinism = report.determinism;
	lines.push('DETERMINISM');
	lines.push(
		`${determinism.ticks} ticks x2: ${determinism.matches ? 'PASS' : 'FAIL'}  ` +
			`checksums ${determinism.firstChecksum} / ${determinism.secondChecksum}`
	);
	lines.push('');

	lines.push('SUMMARY');
	const outcome = summary.timeout
		? 'TIMEOUT'
		: `ENDED: ${summary.winnerName ?? '?'} #${summary.winnerId ?? 0}`;
	lines.push(`end tick: ${summary.endTick} (${outcome})`);
	lines.push(`deterministic checksum: ${summary.checksum}`);
	lines.push(`peak RSS: ${summary.peakRssMiB.toFixed(2)} MiB`);
	lines.push(
		`final: fronts ${summary.finalActiveFronts}  structures ${summary.finalStructuresTotal}  ` +
			`districts ${summary.finalDistricts}  alive ${summary.aliveStates}  ` +
			`eliminations ${summary.eliminations}`
	);
	lines.push(`samples validated: ${summary.samplesValidated}`);

	return lines.join('\n');
}

function parseInteger(name: string, raw: string | undefined): number {
	if (raw === undefined) throw new UsageError(`Missing value for ${name}.`);
	if (!/^\d+$/.test(raw)) {
		throw new UsageError(`${name} must be a non-negative integer, received "${raw}".`);
	}
	const value = Number.parseInt(raw, 10);
	if (!Number.isSafeInteger(value)) throw new UsageError(`${name} is too large: "${raw}".`);
	return value;
}

function parseArgs(argv: readonly string[]): CliOptions {
	const options: CliOptions = {
		ticks: DEFAULT_TICKS,
		seed: DEFAULT_SEED,
		json: false,
		help: false
	};

	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index] ?? '';
		switch (arg) {
			case '--ticks':
				index += 1;
				options.ticks = parseInteger('--ticks', argv[index]);
				break;
			case '--seed':
				index += 1;
				options.seed = parseInteger('--seed', argv[index]);
				break;
			case '--json':
				options.json = true;
				break;
			case '--help':
			case '-h':
				options.help = true;
				break;
			default:
				throw new UsageError(`Unknown argument "${arg}".`);
		}
	}

	if (options.ticks < 1) throw new UsageError('--ticks must be at least 1.');
	if (options.seed > 0xffffffff) {
		throw new UsageError('--seed must fit in an unsigned 32-bit integer.');
	}
	return options;
}

function main(argv: readonly string[]): void {
	let options: CliOptions;
	try {
		options = parseArgs(argv);
	} catch (error) {
		if (!(error instanceof UsageError)) throw error;
		console.error(error.message);
		console.error('');
		console.error(USAGE);
		process.exitCode = 1;
		return;
	}

	if (options.help) {
		console.log(USAGE);
		return;
	}

	const run = runSoak(options.seed, options.ticks);
	if (run.violation || !run.summary) {
		const violation = run.violation;
		console.error('SOAK VALIDATION FAILED');
		if (violation) {
			console.error(`  tick ${violation.tick}: ${violation.check}: ${violation.detail}`);
		}
		process.exitCode = 1;
		return;
	}

	const determinismTicks = Math.min(DETERMINISM_TICKS, options.ticks);
	const determinism = runDeterminismCheck(options.seed, determinismTicks);
	const report: SoakReport = {
		version: REPORT_VERSION,
		options: {
			seed: options.seed,
			maxTicks: options.ticks,
			sampleIntervalTicks: SAMPLE_INTERVAL_TICKS,
			states: run.playerCount,
			botDifficulty: run.botDifficulty
		},
		determinism,
		samples: run.samples,
		summary: run.summary
	};

	if (options.json) console.log(JSON.stringify(report, null, 2));
	else console.log(formatReport(report));

	if (!determinism.matches) {
		console.error(
			`DETERMINISM FAIL: ${determinismTicks} ticks produced checksums ` +
				`${determinism.firstChecksum} and ${determinism.secondChecksum}.`
		);
		process.exitCode = 1;
	}
}

main(process.argv.slice(2));
