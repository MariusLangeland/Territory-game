/**
 * Headless match telemetry harness.
 *
 * Runs `TerritorySimulation` without a renderer, UI, or network. Each seed is
 * played to victory or the tick ceiling, then the final snapshot (plus a few
 * read-only extras the public snapshot does not expose) is reduced to a stable
 * metrics record. The report is deterministic: fixed seed order, fixed type
 * order, fixed field order, no wall-clock values.
 *
 * The harness issues no player commands. The human state is idle while the 50
 * bots play their normal deterministic AI, so the human numbers measure a
 * passive-survival baseline rather than balance. See docs/TELEMETRY.md.
 */

import { PLAYER_COUNT } from '../src/lib/game/constants';
import {
	DEFAULT_GROWTH_MODE,
	GROWTH_MODES,
	isGrowthMode,
	type GrowthMode
} from '../src/lib/game/growth';
import {
	TerritorySimulation,
	type GameSnapshot,
	type PublicPlayer
} from '../src/lib/game/simulation';
import {
	STRUCTURE_TYPES,
	type PublicStructure,
	type StructureType
} from '../src/lib/game/Structures';

const DEFAULT_SEEDS = 3;
const DEFAULT_START_SEED = 1234;
const DEFAULT_MAX_TICKS = 1200;
const REPORT_VERSION = 1;

const USAGE = `Usage: pnpm exec tsx scripts/telemetry.ts [options]

Runs deterministic headless Territory matches and reports per-seed and
aggregate outcome metrics. The human state is idle; bots play normally.

Options:
  --seeds <count>     Number of consecutive seeds to run (default ${DEFAULT_SEEDS})
  --start-seed <n>    First seed; later seeds advance by 1 (default ${DEFAULT_START_SEED})
  --ticks <max>       Maximum simulation ticks per match (default ${DEFAULT_MAX_TICKS})
  --mode <mode>       Growth layer: ${GROWTH_MODES.join(' | ')} (default ${DEFAULT_GROWTH_MODE})
  --json              Print one JSON document instead of the text report
  --help, -h          Print this help text`;

class UsageError extends Error {}

interface CliOptions {
	seeds: number;
	startSeed: number;
	maxTicks: number;
	mode: GrowthMode;
	json: boolean;
	help: boolean;
}

interface RunOptions {
	mode: GrowthMode;
	maxTicks: number;
}

/**
 * Read-only view of simulation internals the public snapshot does not expose.
 * Grievance counters and the attack-id counter are authoritative but private;
 * they are read here only for reporting, never written.
 */
interface SimulationInternals {
	nextAttackId: number;
	botGrievance: Uint16Array;
}

interface StructureLevelStats {
	count: number;
	max: number;
	median: number;
}

interface StructureTelemetry {
	total: number;
	byType: Record<StructureType, number>;
	levels: Record<StructureType, StructureLevelStats>;
}

interface GrievanceStats {
	total: number;
	/** Number of nonzero defender -> attacker grievance pairs. */
	records: number;
	max: number;
	/** Highest single pair; ties resolve to the lowest defender then attacker id. */
	top: { defenderId: number; attackerId: number; count: number } | null;
}

interface HumanTelemetry {
	id: number;
	name: string;
	alive: boolean;
	territory: number;
	landShare: number;
	rank: number;
	peakTerritory: number;
	troughTerritory: number;
	peakRank: number;
}

interface SeedTelemetry {
	seed: number;
	growthMode: GrowthMode;
	humanId: number;
	maxTicks: number;
	endTick: number;
	ended: boolean;
	timeout: boolean;
	winnerId: number | null;
	winnerName: string | null;
	humanVictory: boolean;
	aliveCount: number;
	eliminatedCount: number;
	human: HumanTelemetry;
	fronts: { active: number; peak: number };
	activity: {
		attacksLaunched: number;
		eliminations: number;
		structuresRazed: number;
	};
	structures: StructureTelemetry;
	districts: number;
	grievances: GrievanceStats;
	/** Full authoritative state hash at the final tick; useful for regression checks. */
	checksum: number;
}

interface TelemetryAggregate {
	runs: number;
	growthMode: GrowthMode;
	maxTicks: number;
	outcomes: {
		humanWins: number;
		botWins: number;
		timeouts: number;
		humanWinRate: number;
	};
	endTick: { average: number; median: number; min: number; max: number };
	alive: { average: number; min: number; max: number };
	eliminations: { average: number; total: number };
	human: { averageRank: number; averageLandShare: number; averagePeakTerritory: number };
	fronts: { averageActive: number; peak: number };
	structures: { total: number; byType: Record<StructureType, number> };
	districts: { average: number; total: number };
	activity: { attacksLaunched: number; structuresRazed: number };
	grievances: { total: number; records: number; max: number };
}

interface TelemetryReport {
	version: number;
	options: {
		seeds: number;
		startSeed: number;
		maxTicks: number;
		mode: GrowthMode;
	};
	seeds: SeedTelemetry[];
	aggregate: TelemetryAggregate;
}

function average(values: readonly number[]): number {
	if (values.length === 0) return 0;
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: readonly number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const middle = sorted.length >> 1;
	if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
	return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/** Deterministic decimal rounding; never formats from a clock or locale. */
function round(value: number, digits: number): number {
	const scale = 10 ** digits;
	return Math.round(value * scale) / scale;
}

function emptyStructureTelemetry(): StructureTelemetry {
	const byType = {} as Record<StructureType, number>;
	const levels = {} as Record<StructureType, StructureLevelStats>;
	for (const type of STRUCTURE_TYPES) {
		byType[type] = 0;
		levels[type] = { count: 0, max: 0, median: 0 };
	}
	return { total: 0, byType, levels };
}

function summarizeStructures(structures: readonly PublicStructure[]): StructureTelemetry {
	const telemetry = emptyStructureTelemetry();
	const levelsByType = new Map<StructureType, number[]>();
	for (const type of STRUCTURE_TYPES) levelsByType.set(type, []);
	for (const structure of structures) {
		telemetry.total += 1;
		telemetry.byType[structure.type] += 1;
		levelsByType.get(structure.type)?.push(structure.stacks);
	}
	for (const type of STRUCTURE_TYPES) {
		const levels = levelsByType.get(type) ?? [];
		telemetry.levels[type] = {
			count: levels.length,
			max: levels.length === 0 ? 0 : Math.max(...levels),
			median: median(levels)
		};
	}
	return telemetry;
}

/** Same ordering as the in-game leaderboard: alive first, then territory, then id. */
function comparePlayers(a: PublicPlayer, b: PublicPlayer): number {
	if (a.alive !== b.alive) return a.alive ? -1 : 1;
	if (a.territory !== b.territory) return b.territory - a.territory;
	return a.id - b.id;
}

function rankOf(players: readonly PublicPlayer[], playerId: number): number {
	const player = players.find((entry) => entry.id === playerId);
	if (!player) return PLAYER_COUNT;
	let rank = 1;
	for (const entry of players) {
		if (entry.id !== playerId && comparePlayers(entry, player) < 0) rank += 1;
	}
	return rank;
}

function findHuman(snapshot: GameSnapshot): PublicPlayer {
	const human = snapshot.players.find((player) => player.id === snapshot.humanId);
	if (!human) throw new Error(`Snapshot is missing human player ${snapshot.humanId}.`);
	return human;
}

function summarizeGrievances(counters: Uint16Array): GrievanceStats {
	let total = 0;
	let records = 0;
	let max = 0;
	let top: GrievanceStats['top'] = null;
	for (let defender = 1; defender <= PLAYER_COUNT; defender++) {
		for (let attacker = 1; attacker <= PLAYER_COUNT; attacker++) {
			const count = counters[(defender - 1) * PLAYER_COUNT + (attacker - 1)] ?? 0;
			if (count === 0) continue;
			total += count;
			records += 1;
			// Strict `>` keeps the lowest (defender, attacker) pair on ties.
			if (count > max) {
				max = count;
				top = { defenderId: defender, attackerId: attacker, count };
			}
		}
	}
	return { total, records, max, top };
}

/**
 * A district is the coverage region of a live buildable structure. The coverage
 * map may retain State ids on capital cells (State has no district) and briefly
 * stale ids from razed structures, so only live buildables are counted.
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

function runSeed(seed: number, options: RunOptions): SeedTelemetry {
	const simulation = new TerritorySimulation({ seed, growthMode: options.mode });
	const internals = simulation as unknown as SimulationInternals;

	let snapshot = simulation.getSnapshot();
	let ticks = 0;
	let peakTerritory = findHuman(snapshot).territory;
	let troughTerritory = peakTerritory;
	let peakRank = rankOf(snapshot.players, findHuman(snapshot).id);
	let peakFronts = snapshot.attacks.length;
	let eliminations = 0;
	let structuresRazed = 0;

	while (!snapshot.ended && ticks < options.maxTicks) {
		const result = simulation.step();
		ticks += 1;
		snapshot = result.snapshot;

		const human = findHuman(snapshot);
		peakTerritory = Math.max(peakTerritory, human.territory);
		troughTerritory = Math.min(troughTerritory, human.territory);
		peakRank = Math.min(peakRank, rankOf(snapshot.players, human.id));
		peakFronts = Math.max(peakFronts, snapshot.attacks.length);

		for (const event of result.events) {
			if (event.kind === 'elimination') eliminations += 1;
			else if (event.kind === 'structure') structuresRazed += 1;
		}
	}

	const human = findHuman(snapshot);
	const aliveCount = snapshot.players.filter((player) => player.alive).length;
	const winner =
		snapshot.winnerId === null
			? null
			: (snapshot.players.find((player) => player.id === snapshot.winnerId) ?? null);

	return {
		seed,
		growthMode: options.mode,
		humanId: snapshot.humanId,
		maxTicks: options.maxTicks,
		endTick: snapshot.tick,
		ended: snapshot.ended,
		timeout: !snapshot.ended,
		winnerId: snapshot.winnerId,
		winnerName: winner?.name ?? null,
		humanVictory: snapshot.winnerId === snapshot.humanId,
		aliveCount,
		eliminatedCount: snapshot.players.length - aliveCount,
		human: {
			id: human.id,
			name: human.name,
			alive: human.alive,
			territory: human.territory,
			landShare: round(human.landShare, 6),
			rank: rankOf(snapshot.players, human.id),
			peakTerritory,
			troughTerritory,
			peakRank
		},
		fronts: { active: snapshot.attacks.length, peak: peakFronts },
		activity: {
			attacksLaunched: Math.max(0, internals.nextAttackId - 1),
			eliminations,
			structuresRazed
		},
		structures: summarizeStructures(snapshot.structures),
		districts: countDistricts(simulation),
		grievances: summarizeGrievances(internals.botGrievance),
		checksum: simulation.checksum()
	};
}

function aggregate(
	seeds: readonly SeedTelemetry[],
	mode: GrowthMode,
	maxTicks: number
): TelemetryAggregate {
	const runs = seeds.length;
	const humanWins = seeds.filter((run) => run.humanVictory).length;
	const timeouts = seeds.filter((run) => run.timeout).length;
	const botWins = runs - humanWins - timeouts;

	const endTicks = seeds.map((run) => run.endTick);
	const aliveCounts = seeds.map((run) => run.aliveCount);
	const eliminatedCounts = seeds.map((run) => run.eliminatedCount);

	const byType = {} as Record<StructureType, number>;
	for (const type of STRUCTURE_TYPES) {
		byType[type] = seeds.reduce((sum, run) => sum + run.structures.byType[type], 0);
	}

	return {
		runs,
		growthMode: mode,
		maxTicks,
		outcomes: {
			humanWins,
			botWins,
			timeouts,
			humanWinRate: round(humanWins / runs, 4)
		},
		endTick: {
			average: round(average(endTicks), 2),
			median: round(median(endTicks), 2),
			min: Math.min(...endTicks),
			max: Math.max(...endTicks)
		},
		alive: {
			average: round(average(aliveCounts), 2),
			min: Math.min(...aliveCounts),
			max: Math.max(...aliveCounts)
		},
		eliminations: {
			average: round(average(eliminatedCounts), 2),
			total: eliminatedCounts.reduce((sum, value) => sum + value, 0)
		},
		human: {
			averageRank: round(average(seeds.map((run) => run.human.rank)), 2),
			averageLandShare: round(average(seeds.map((run) => run.human.landShare)), 6),
			averagePeakTerritory: round(average(seeds.map((run) => run.human.peakTerritory)), 2)
		},
		fronts: {
			averageActive: round(average(seeds.map((run) => run.fronts.active)), 2),
			peak: Math.max(...seeds.map((run) => run.fronts.peak))
		},
		structures: {
			total: seeds.reduce((sum, run) => sum + run.structures.total, 0),
			byType
		},
		districts: {
			average: round(average(seeds.map((run) => run.districts)), 2),
			total: seeds.reduce((sum, run) => sum + run.districts, 0)
		},
		activity: {
			attacksLaunched: seeds.reduce((sum, run) => sum + run.activity.attacksLaunched, 0),
			structuresRazed: seeds.reduce((sum, run) => sum + run.activity.structuresRazed, 0)
		},
		grievances: {
			total: seeds.reduce((sum, run) => sum + run.grievances.total, 0),
			records: seeds.reduce((sum, run) => sum + run.grievances.records, 0),
			max: Math.max(...seeds.map((run) => run.grievances.max))
		}
	};
}

function pad(value: string | number, width: number, align: 'left' | 'right' = 'left'): string {
	const text = String(value);
	return align === 'right' ? text.padStart(width) : text.padEnd(width);
}

function formatPercent(fraction: number): string {
	return `${(fraction * 100).toFixed(2)}%`;
}

function formatTypeStats(stats: StructureLevelStats): string {
	return `${stats.count} ${stats.max}/${stats.median}`;
}

function formatTable(report: TelemetryReport): string {
	const lines: string[] = [];
	const first = report.seeds[0];
	lines.push('TERRITORY TELEMETRY');
	lines.push(
		`runs=${report.options.seeds}  startSeed=${report.options.startSeed}  ` +
			`mode=${report.options.mode}  maxTicks=${report.options.maxTicks}  ` +
			`human=id ${first?.humanId ?? 1} (idle)`
	);
	lines.push('');

	lines.push('PER SEED');
	lines.push(
		[
			pad('seed', 12),
			pad('end', 7, 'right'),
			pad('winner', 18),
			pad('alive', 6, 'right'),
			pad('elim', 5, 'right'),
			pad('fronts', 9, 'right'),
			pad('rank', 5, 'right'),
			pad('share', 8, 'right'),
			pad('peak', 7, 'right'),
			pad('trough', 7, 'right'),
			pad('human', 6)
		].join(' ')
	);
	for (const run of report.seeds) {
		const winner = run.timeout ? 'TIMEOUT' : (run.winnerName ?? `#${run.winnerId ?? 0}`);
		const humanState = run.humanVictory ? 'WIN' : run.human.alive ? '-' : 'OUT';
		lines.push(
			[
				pad(run.seed, 12),
				pad(run.endTick, 7, 'right'),
				pad(winner, 18),
				pad(run.aliveCount, 6, 'right'),
				pad(run.eliminatedCount, 5, 'right'),
				pad(`${run.fronts.active}/${run.fronts.peak}`, 9, 'right'),
				pad(run.human.rank, 5, 'right'),
				pad(formatPercent(run.human.landShare), 8, 'right'),
				pad(run.human.peakTerritory, 7, 'right'),
				pad(run.human.troughTerritory, 7, 'right'),
				pad(humanState, 6)
			].join(' ')
		);
	}
	lines.push('');

	lines.push('STRUCTURES BY SEED (count max/median level)');
	const typeHeaders = ['state', 'mine', 'barracks', 'defense', 'command', 'academy'] as const;
	lines.push(
		[
			pad('seed', 12),
			...typeHeaders.map((header) => pad(header, 14)),
			pad('districts', 9, 'right')
		].join(' ')
	);
	for (const run of report.seeds) {
		lines.push(
			[
				pad(run.seed, 12),
				...STRUCTURE_TYPES.map((type) => pad(formatTypeStats(run.structures.levels[type]), 14)),
				pad(run.districts, 9, 'right')
			].join(' ')
		);
	}
	lines.push('');

	lines.push('WAR AND GRIEVANCE ACTIVITY');
	lines.push(
		[
			pad('seed', 12),
			pad('launched', 9, 'right'),
			pad('razed', 6, 'right'),
			pad('grudges', 9, 'right'),
			pad('pairs', 6, 'right'),
			pad('topGrudge', 18)
		].join(' ')
	);
	for (const run of report.seeds) {
		const top = run.grievances.top;
		const topLabel = top ? `${top.defenderId}->${top.attackerId} x${top.count}` : '-';
		lines.push(
			[
				pad(run.seed, 12),
				pad(run.activity.attacksLaunched, 9, 'right'),
				pad(run.activity.structuresRazed, 6, 'right'),
				pad(run.grievances.total, 9, 'right'),
				pad(run.grievances.records, 6, 'right'),
				pad(topLabel, 18)
			].join(' ')
		);
	}
	lines.push('');

	const totals = report.aggregate;
	lines.push('AGGREGATE');
	lines.push(
		`human win rate: ${formatPercent(totals.outcomes.humanWinRate)} ` +
			`(${totals.outcomes.humanWins}/${totals.runs})  bot wins: ${totals.outcomes.botWins}  ` +
			`timeouts: ${totals.outcomes.timeouts}`
	);
	lines.push(
		`end tick: avg ${totals.endTick.average}  median ${totals.endTick.median}  ` +
			`min ${totals.endTick.min}  max ${totals.endTick.max}`
	);
	lines.push(
		`alive: avg ${totals.alive.average}  min ${totals.alive.min}  max ${totals.alive.max}  ` +
			`eliminations: avg ${totals.eliminations.average}  total ${totals.eliminations.total}`
	);
	lines.push(
		`active fronts: avg ${totals.fronts.averageActive}  peak ${totals.fronts.peak}  ` +
			`districts: avg ${totals.districts.average}  total ${totals.districts.total}`
	);
	lines.push(
		`human: avg rank ${totals.human.averageRank}  avg share ${formatPercent(totals.human.averageLandShare)}  ` +
			`avg peak territory ${totals.human.averagePeakTerritory}`
	);
	lines.push(
		`structures: total ${totals.structures.total}  ` +
			STRUCTURE_TYPES.map((type) => `${type} ${totals.structures.byType[type]}`).join('  ')
	);
	lines.push(
		`war: launched ${totals.activity.attacksLaunched}  razed ${totals.activity.structuresRazed}  ` +
			`grievances: total ${totals.grievances.total}  pairs ${totals.grievances.records}  ` +
			`max ${totals.grievances.max}`
	);
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
		seeds: DEFAULT_SEEDS,
		startSeed: DEFAULT_START_SEED,
		maxTicks: DEFAULT_MAX_TICKS,
		mode: DEFAULT_GROWTH_MODE,
		json: false,
		help: false
	};

	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index] ?? '';
		switch (arg) {
			case '--seeds':
				index += 1;
				options.seeds = parseInteger('--seeds', argv[index]);
				break;
			case '--start-seed':
				index += 1;
				options.startSeed = parseInteger('--start-seed', argv[index]);
				break;
			case '--ticks':
				index += 1;
				options.maxTicks = parseInteger('--ticks', argv[index]);
				break;
			case '--mode': {
				index += 1;
				const rawMode = argv[index];
				if (rawMode === undefined) throw new UsageError('Missing value for --mode.');
				if (!isGrowthMode(rawMode)) {
					throw new UsageError(
						`--mode must be one of ${GROWTH_MODES.join(', ')}, received "${rawMode}".`
					);
				}
				options.mode = rawMode;
				break;
			}
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

	if (options.seeds < 1) throw new UsageError('--seeds must be at least 1.');
	if (options.maxTicks < 1) throw new UsageError('--ticks must be at least 1.');
	if (options.startSeed > 0xffffffff) {
		throw new UsageError('--start-seed must fit in an unsigned 32-bit integer.');
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

	const seeds = Array.from(
		{ length: options.seeds },
		(_, index) => (options.startSeed + index) >>> 0
	);
	const seedReports: SeedTelemetry[] = [];
	for (const seed of seeds) {
		seedReports.push(runSeed(seed, { mode: options.mode, maxTicks: options.maxTicks }));
	}

	const report: TelemetryReport = {
		version: REPORT_VERSION,
		options: {
			seeds: options.seeds,
			startSeed: options.startSeed,
			maxTicks: options.maxTicks,
			mode: options.mode
		},
		seeds: seedReports,
		aggregate: aggregate(seedReports, options.mode, options.maxTicks)
	};

	if (options.json) console.log(JSON.stringify(report, null, 2));
	else console.log(formatTable(report));
}

main(process.argv.slice(2));
