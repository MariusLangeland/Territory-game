/**
 * Balance sweep harness.
 *
 * Plays a fixed sequence of deterministic headless matches and reports the
 * balance signals a tuning loop needs: match length, winner personality, the
 * early-economy ramp, structure mix, and war pacing. Bots play their normal AI;
 * the human state (id 1) is idle and issues no commands.
 *
 * The report is deterministic: fixed seed order, fixed structure-type order,
 * fixed field order, and no wall-clock values. Metrics are sampled from public
 * snapshots plus one read-only private field (`botProfiles`). See
 * docs/TELEMETRY.md.
 */

import { PLAYER_COUNT } from '../src/lib/game/constants';
import {
	TerritorySimulation,
	type BotDifficulty,
	type GameSnapshot
} from '../src/lib/game/simulation';
import {
	STRUCTURE_TYPES,
	type PublicStructure,
	type StructureType
} from '../src/lib/game/Structures';

const DEFAULT_SEEDS = 8;
const DEFAULT_START_SEED = 1234;
const DEFAULT_MAX_TICKS = 1800;
const REPORT_VERSION = 1;

/** Early-economy and structure-mix checkpoints: 5, 10, and 15 minutes at 10 Hz. */
const MILESTONE_TICKS = [600, 1200, 1800] as const;

/** Front-count and elimination pacing is sampled every game minute. */
const PACE_INTERVAL_TICKS = 600;

/** The shared opening ramp is complete at two Command Post and two War Academy stacks. */
const EARLY_ECONOMY_STACKS = 2;

/**
 * Profile axes a winner can be grouped by. Declaration order is also the
 * deterministic tie-break order for equal trait values.
 */
const TRAIT_BUCKETS = ['aggression', 'economy', 'fortification', 'command'] as const;

type TraitBucket = (typeof TRAIT_BUCKETS)[number];

const USAGE = `Usage: pnpm exec tsx scripts/balance-sweep.ts [options]

Runs deterministic headless Territory matches and reports balance signals:
match length, winner personality, early-economy ramp, structure mix, and war
pacing. The human state is idle; bots play normally.

Options:
  --seeds <count>     Number of consecutive seeds to run (default ${DEFAULT_SEEDS})
  --start-seed <n>    First seed; later seeds advance by 1 (default ${DEFAULT_START_SEED})
  --ticks <max>       Maximum simulation ticks per match (default ${DEFAULT_MAX_TICKS})
  --json              Print one JSON document instead of the text report
  --help, -h          Print this help text`;

class UsageError extends Error {}

interface CliOptions {
	seeds: number;
	startSeed: number;
	maxTicks: number;
	json: boolean;
	help: boolean;
}

interface RunOptions {
	maxTicks: number;
}

/** Read-only view of the bot profile fields this harness groups winners by. */
interface BotProfileView {
	aggression: number;
	economy: number;
	fortification: number;
	command: number;
}

/**
 * Read-only view of simulation internals the public snapshot does not expose.
 * Bot profiles are derived from `hash32(seed, playerId)` and are authoritative
 * for personality, but they are private; this harness only reads them.
 */
interface SimulationInternals {
	botProfiles: readonly BotProfileView[];
}

interface CheckpointEconomy {
	tick: number;
	livingBots: number;
	completed: number;
	completionRate: number;
}

interface StructureMixCheckpoint {
	tick: number;
	total: number;
	byType: Record<StructureType, number>;
}

interface PaceCheckpoint {
	tick: number;
	activeFronts: number;
	cumulativeEliminations: number;
}

interface WinnerProfile extends BotProfileView {
	dominantTrait: TraitBucket;
}

interface SeedBalance {
	seed: number;
	endTick: number;
	ended: boolean;
	timeout: boolean;
	winnerId: number | null;
	winnerName: string | null;
	aliveCount: number;
	eliminations: number;
	winnerProfile: WinnerProfile | null;
	earlyEconomy: CheckpointEconomy[];
	structureMix: StructureMixCheckpoint[];
	pace: PaceCheckpoint[];
}

interface SeedRun {
	record: SeedBalance;
	/** Bot population per dominant trait bucket at deployment. */
	population: Record<TraitBucket, number>;
	playerCount: number;
	botDifficulty: BotDifficulty;
}

interface BucketStats {
	/** Bots deployed with this dominant trait, summed across seeds. */
	bots: number;
	/** Runs this bucket won as the winner's dominant trait. */
	wins: number;
	winRate: number;
}

interface WinnerTraitAggregate {
	buckets: Record<TraitBucket, BucketStats>;
	/** Wins by a non-bot (the idle human) or runs with no winner (timeout). */
	unattributedWins: number;
}

interface EarlyEconomyAggregateCheckpoint {
	tick: number;
	runs: number;
	livingBots: number;
	completed: number;
	completionRate: number;
}

interface EarlyEconomyAggregate {
	checkpoints: EarlyEconomyAggregateCheckpoint[];
	aggregate: {
		livingBots: number;
		completed: number;
		completionRate: number;
	};
}

interface StructureMixAggregateCheckpoint {
	tick: number;
	runs: number;
	total: number;
	byType: Record<StructureType, number>;
}

interface PaceAggregateCheckpoint {
	tick: number;
	runs: number;
	averageActiveFronts: number;
	averageCumulativeEliminations: number;
}

interface BalanceAggregate {
	runs: number;
	results: {
		ended: number;
		timeouts: number;
		timeoutRate: number;
	};
	endTick: {
		average: number;
		median: number;
		min: number;
		max: number;
	};
	winnerProfiles: WinnerTraitAggregate;
	earlyEconomy: EarlyEconomyAggregate;
	structureMix: StructureMixAggregateCheckpoint[];
	pace: PaceAggregateCheckpoint[];
}

interface BalanceReport {
	version: number;
	options: {
		seeds: number;
		startSeed: number;
		maxTicks: number;
		playerCount: number;
		botDifficulty: BotDifficulty;
	};
	seeds: SeedBalance[];
	aggregate: BalanceAggregate;
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

/** Deterministic ratio; 0 when there is nothing to observe. */
function ratio(numerator: number, denominator: number, digits: number): number {
	if (denominator === 0) return 0;
	return round(numerator / denominator, digits);
}

function emptyStructureCounts(): Record<StructureType, number> {
	const counts = {} as Record<StructureType, number>;
	for (const type of STRUCTURE_TYPES) counts[type] = 0;
	return counts;
}

function emptyTraitCounts(): Record<TraitBucket, number> {
	return {
		aggression: 0,
		economy: 0,
		fortification: 0,
		command: 0
	};
}

/**
 * The dominant trait is the highest of the four profile axes. Strict `>` over
 * TRAIT_BUCKETS keeps the earliest bucket on ties, so grouping is stable even
 * when a generated profile has equal axis values.
 */
function dominantTrait(profile: BotProfileView): TraitBucket {
	let best: TraitBucket = TRAIT_BUCKETS[0];
	for (const bucket of TRAIT_BUCKETS) {
		if (profile[bucket] > profile[best]) best = bucket;
	}
	return best;
}

function summarizeStructureMix(snapshot: GameSnapshot): StructureMixCheckpoint {
	const byType = emptyStructureCounts();
	for (const structure of snapshot.structures) byType[structure.type] += 1;
	return { tick: snapshot.tick, total: snapshot.structures.length, byType };
}

/**
 * Count living bots that finished the shared opening economy ramp: at least two
 * Command Post stacks and two War Academy stacks. Stacks, not structures, are
 * counted so an upgraded pair still satisfies the check. The idle human is
 * excluded; this is a bot-behavior metric.
 */
function summarizeEarlyEconomy(snapshot: GameSnapshot): CheckpointEconomy {
	const commandPosts = new Uint32Array(snapshot.players.length + 1);
	const warAcademies = new Uint32Array(snapshot.players.length + 1);
	for (const structure of snapshot.structures) {
		if (structure.type === 'command-post') {
			commandPosts[structure.ownerId] += structure.stacks;
		} else if (structure.type === 'war-academy') {
			warAcademies[structure.ownerId] += structure.stacks;
		}
	}

	let livingBots = 0;
	let completed = 0;
	for (const player of snapshot.players) {
		if (!player.alive || !player.isBot) continue;
		livingBots += 1;
		if (
			commandPosts[player.id] >= EARLY_ECONOMY_STACKS &&
			warAcademies[player.id] >= EARLY_ECONOMY_STACKS
		) {
			completed += 1;
		}
	}

	return {
		tick: snapshot.tick,
		livingBots,
		completed,
		completionRate: ratio(completed, livingBots, 4)
	};
}

function readWinnerProfile(
	winnerId: number | null,
	players: GameSnapshot['players'],
	profiles: readonly BotProfileView[]
): WinnerProfile | null {
	if (winnerId === null) return null;
	const winner = players.find((player) => player.id === winnerId);
	if (!winner?.isBot) return null;
	const profile = profiles[winnerId - 1];
	if (!profile) return null;
	return {
		aggression: profile.aggression,
		economy: profile.economy,
		fortification: profile.fortification,
		command: profile.command,
		dominantTrait: dominantTrait(profile)
	};
}

function runSeed(seed: number, options: RunOptions): SeedRun {
	const simulation = new TerritorySimulation({ seed });
	const internals = simulation as unknown as SimulationInternals;
	const profiles = internals.botProfiles;

	// Snapshot the deployed bot population once; eliminations must not shrink the
	// sample used for the trait win-rate denominators.
	const population = emptyTraitCounts();
	for (const player of simulation.players) {
		if (!player.isBot) continue;
		const profile = profiles[player.id - 1];
		if (profile) population[dominantTrait(profile)] += 1;
	}

	let snapshot = simulation.getSnapshot();
	let ticks = 0;
	let cumulativeEliminations = 0;
	const earlyEconomy: CheckpointEconomy[] = [];
	const structureMix: StructureMixCheckpoint[] = [];
	const pace: PaceCheckpoint[] = [];

	while (!snapshot.ended && ticks < options.maxTicks) {
		const result = simulation.step();
		ticks += 1;
		snapshot = result.snapshot;

		for (const event of result.events) {
			if (event.kind === 'elimination') cumulativeEliminations += 1;
		}

		const tick = snapshot.tick;
		if (MILESTONE_TICKS.includes(tick as (typeof MILESTONE_TICKS)[number])) {
			earlyEconomy.push(summarizeEarlyEconomy(snapshot));
			structureMix.push(summarizeStructureMix(snapshot));
		}
		if (tick % PACE_INTERVAL_TICKS === 0) {
			pace.push({
				tick,
				activeFronts: snapshot.attacks.length,
				cumulativeEliminations
			});
		}
	}

	const aliveCount = snapshot.players.filter((player) => player.alive).length;
	const winnerProfile = readWinnerProfile(snapshot.winnerId, snapshot.players, profiles);

	return {
		record: {
			seed,
			endTick: snapshot.tick,
			ended: snapshot.ended,
			timeout: !snapshot.ended,
			winnerId: snapshot.winnerId,
			winnerName:
				snapshot.winnerId === null
					? null
					: (snapshot.players.find((player) => player.id === snapshot.winnerId)?.name ?? null),
			aliveCount,
			eliminations: snapshot.players.length - aliveCount,
			winnerProfile,
			earlyEconomy,
			structureMix,
			pace
		},
		population,
		playerCount: simulation.playerCount,
		botDifficulty: simulation.botDifficulty
	};
}

function aggregateEarlyEconomy(runs: readonly SeedRun[]): EarlyEconomyAggregate {
	let totalLiving = 0;
	let totalCompleted = 0;
	const checkpoints: EarlyEconomyAggregateCheckpoint[] = [];

	for (const tick of MILESTONE_TICKS) {
		let runsAtTick = 0;
		let livingBots = 0;
		let completed = 0;
		for (const run of runs) {
			const sample = run.record.earlyEconomy.find((entry) => entry.tick === tick);
			if (!sample) continue;
			runsAtTick += 1;
			livingBots += sample.livingBots;
			completed += sample.completed;
		}
		totalLiving += livingBots;
		totalCompleted += completed;
		if (runsAtTick === 0) continue;
		checkpoints.push({
			tick,
			runs: runsAtTick,
			livingBots,
			completed,
			completionRate: ratio(completed, livingBots, 4)
		});
	}

	return {
		checkpoints,
		aggregate: {
			livingBots: totalLiving,
			completed: totalCompleted,
			completionRate: ratio(totalCompleted, totalLiving, 4)
		}
	};
}

function aggregateStructureMix(runs: readonly SeedRun[]): StructureMixAggregateCheckpoint[] {
	const checkpoints: StructureMixAggregateCheckpoint[] = [];

	for (const tick of MILESTONE_TICKS) {
		let runsAtTick = 0;
		let total = 0;
		const byType = emptyStructureCounts();
		for (const run of runs) {
			const sample = run.record.structureMix.find((entry) => entry.tick === tick);
			if (!sample) continue;
			runsAtTick += 1;
			total += sample.total;
			for (const type of STRUCTURE_TYPES) byType[type] += sample.byType[type];
		}
		if (runsAtTick === 0) continue;
		checkpoints.push({ tick, runs: runsAtTick, total, byType });
	}

	return checkpoints;
}

function aggregatePace(runs: readonly SeedRun[]): PaceAggregateCheckpoint[] {
	const ticks = new Set<number>();
	for (const run of runs) {
		for (const sample of run.record.pace) ticks.add(sample.tick);
	}

	const checkpoints: PaceAggregateCheckpoint[] = [];
	for (const tick of [...ticks].sort((a, b) => a - b)) {
		let runsAtTick = 0;
		let fronts = 0;
		let eliminations = 0;
		for (const run of runs) {
			const sample = run.record.pace.find((entry) => entry.tick === tick);
			if (!sample) continue;
			runsAtTick += 1;
			fronts += sample.activeFronts;
			eliminations += sample.cumulativeEliminations;
		}
		checkpoints.push({
			tick,
			runs: runsAtTick,
			averageActiveFronts: round(fronts / runsAtTick, 2),
			averageCumulativeEliminations: round(eliminations / runsAtTick, 2)
		});
	}
	return checkpoints;
}

function aggregate(runs: readonly SeedRun[]): BalanceAggregate {
	const runsCount = runs.length;
	const timeoutRuns = runs.filter((run) => run.record.timeout).length;
	const endTicks = runs.map((run) => run.record.endTick);

	const buckets = {} as Record<TraitBucket, BucketStats>;
	for (const bucket of TRAIT_BUCKETS) {
		buckets[bucket] = { bots: 0, wins: 0, winRate: 0 };
	}

	let wins = 0;
	for (const run of runs) {
		for (const bucket of TRAIT_BUCKETS) {
			buckets[bucket].bots += run.population[bucket];
		}
		const winnerBucket = run.record.winnerProfile?.dominantTrait;
		if (winnerBucket) {
			buckets[winnerBucket].wins += 1;
			wins += 1;
		}
	}
	for (const bucket of TRAIT_BUCKETS) {
		buckets[bucket].winRate = ratio(buckets[bucket].wins, buckets[bucket].bots, 4);
	}

	return {
		runs: runsCount,
		results: {
			ended: runsCount - timeoutRuns,
			timeouts: timeoutRuns,
			timeoutRate: ratio(timeoutRuns, runsCount, 4)
		},
		endTick: {
			average: round(average(endTicks), 2),
			median: round(median(endTicks), 2),
			min: Math.min(...endTicks),
			max: Math.max(...endTicks)
		},
		winnerProfiles: {
			buckets,
			unattributedWins: runsCount - wins
		},
		earlyEconomy: aggregateEarlyEconomy(runs),
		structureMix: aggregateStructureMix(runs),
		pace: aggregatePace(runs)
	};
}

/** Abbreviations keep the per-seed structure-mix table within a terminal width. */
const STRUCTURE_ABBREVIATIONS: Record<StructureType, string> = {
	state: 'state',
	artillery: 'art',
	barracks: 'barr',
	fortification: 'fort',
	'command-post': 'cmd',
	'war-academy': 'acad',
	jammer: 'jam'
};

function pad(value: string | number, width: number, align: 'left' | 'right' = 'left'): string {
	const text = String(value);
	return align === 'right' ? text.padStart(width) : text.padEnd(width);
}

function formatPercent(fraction: number): string {
	return `${(fraction * 100).toFixed(2)}%`;
}

function formatTraits(profile: WinnerProfile | null): string {
	if (!profile) return '-';
	return `a${profile.aggression} e${profile.economy} f${profile.fortification} c${profile.command}`;
}

function formatEarlyEconomyCell(record: SeedBalance, tick: number): string {
	const sample = record.earlyEconomy.find((entry) => entry.tick === tick);
	return sample ? `${sample.completed}/${sample.livingBots}` : '-';
}

function formatPaceCell(record: SeedBalance, tick: number): string {
	const sample = record.pace.find((entry) => entry.tick === tick);
	return sample ? `${sample.activeFronts}/${sample.cumulativeEliminations}` : '-';
}

function formatReport(report: BalanceReport): string {
	const lines: string[] = [];
	const options = report.options;

	lines.push('TERRITORY BALANCE SWEEP');
	lines.push(
		`runs=${options.seeds}  startSeed=${options.startSeed}  maxTicks=${options.maxTicks}  ` +
			`states=${options.playerCount}  difficulty=${options.botDifficulty}  human=id 1 (idle)`
	);
	lines.push('');

	lines.push('PER SEED');
	lines.push(
		[
			pad('seed', 12),
			pad('end', 7, 'right'),
			pad('result', 8),
			pad('winner', 18),
			pad('alive', 6, 'right'),
			pad('elim', 5, 'right'),
			pad('dominant', 14),
			pad('traits', 24)
		].join(' ')
	);
	for (const record of report.seeds) {
		const result = record.timeout ? 'TIMEOUT' : 'ENDED';
		const winner =
			record.winnerId === null ? '-' : `${record.winnerName ?? '?'} #${record.winnerId}`;
		lines.push(
			[
				pad(record.seed, 12),
				pad(record.endTick, 7, 'right'),
				pad(result, 8),
				pad(winner, 18),
				pad(record.aliveCount, 6, 'right'),
				pad(record.eliminations, 5, 'right'),
				pad(record.winnerProfile?.dominantTrait ?? '-', 14),
				pad(formatTraits(record.winnerProfile), 24)
			].join(' ')
		);
	}
	lines.push('');

	lines.push('EARLY ECONOMY RAMP (living bots with >=2 command-post + >=2 war-academy stacks)');
	lines.push([pad('seed', 12), ...MILESTONE_TICKS.map((tick) => pad(`@${tick}`, 12))].join(' '));
	for (const record of report.seeds) {
		lines.push(
			[
				pad(record.seed, 12),
				...MILESTONE_TICKS.map((tick) => pad(formatEarlyEconomyCell(record, tick), 12))
			].join(' ')
		);
	}
	lines.push('');

	const paceTicks = [
		...new Set(report.seeds.flatMap((record) => record.pace.map((sample) => sample.tick)))
	].sort((a, b) => a - b);

	lines.push('FRONT / ELIMINATION PACE (active fronts / cumulative eliminations)');
	if (paceTicks.length === 0) {
		lines.push('(no checkpoint reached)');
	} else {
		lines.push([pad('seed', 12), ...paceTicks.map((tick) => pad(`@${tick}`, 12))].join(' '));
		for (const record of report.seeds) {
			lines.push(
				[
					pad(record.seed, 12),
					...paceTicks.map((tick) => pad(formatPaceCell(record, tick), 12))
				].join(' ')
			);
		}
	}
	lines.push('');

	lines.push(
		'STRUCTURE MIX AT CHECKPOINTS ' +
			`(${STRUCTURE_TYPES.map((type) => STRUCTURE_ABBREVIATIONS[type]).join(', ')})`
	);
	lines.push(
		[
			pad('seed', 12),
			pad('tick', 6, 'right'),
			pad('total', 6, 'right'),
			...STRUCTURE_TYPES.map((type) => pad(STRUCTURE_ABBREVIATIONS[type], 6, 'right'))
		].join(' ')
	);
	for (const record of report.seeds) {
		for (const sample of record.structureMix) {
			lines.push(
				[
					pad(record.seed, 12),
					pad(sample.tick, 6, 'right'),
					pad(sample.total, 6, 'right'),
					...STRUCTURE_TYPES.map((type) => pad(sample.byType[type], 6, 'right'))
				].join(' ')
			);
		}
	}
	if (report.seeds.every((record) => record.structureMix.length === 0)) {
		lines.push('(no checkpoint reached)');
	}
	lines.push('');

	const aggregate = report.aggregate;
	lines.push('AGGREGATE');
	lines.push(
		`results: ended ${aggregate.results.ended}/${aggregate.runs}  ` +
			`timeouts ${aggregate.results.timeouts} (${formatPercent(aggregate.results.timeoutRate)})`
	);
	lines.push(
		`match length: avg ${aggregate.endTick.average}  median ${aggregate.endTick.median}  ` +
			`min ${aggregate.endTick.min}  max ${aggregate.endTick.max} tick(s)`
	);
	lines.push('');

	lines.push('WINNER TRAIT BUCKETS (dominant profile trait; bots = deployed bot population)');
	lines.push(
		[
			pad('bucket', 14),
			pad('bots', 8, 'right'),
			pad('wins', 6, 'right'),
			pad('winRate', 10, 'right')
		].join(' ')
	);
	for (const bucket of TRAIT_BUCKETS) {
		const stats = aggregate.winnerProfiles.buckets[bucket];
		lines.push(
			[
				pad(bucket, 14),
				pad(stats.bots, 8, 'right'),
				pad(stats.wins, 6, 'right'),
				pad(formatPercent(stats.winRate), 10, 'right')
			].join(' ')
		);
	}
	lines.push(
		`unattributed wins: ${aggregate.winnerProfiles.unattributedWins} ` +
			'(timeout or idle-human victory)'
	);
	lines.push('');

	lines.push(
		`EARLY ECONOMY AGGREGATE: ${aggregate.earlyEconomy.aggregate.completed}/` +
			`${aggregate.earlyEconomy.aggregate.livingBots} observed bots completed the ramp ` +
			`(${formatPercent(aggregate.earlyEconomy.aggregate.completionRate)})`
	);
	for (const checkpoint of aggregate.earlyEconomy.checkpoints) {
		lines.push(
			`  @${checkpoint.tick}: ${checkpoint.completed}/${checkpoint.livingBots} ` +
				`across ${checkpoint.runs} run(s) (${formatPercent(checkpoint.completionRate)})`
		);
	}
	lines.push('');

	lines.push('STRUCTURE MIX AGGREGATE (sum across runs)');
	lines.push(
		[
			pad('tick', 6, 'right'),
			pad('runs', 6, 'right'),
			pad('total', 7, 'right'),
			...STRUCTURE_TYPES.map((type) => pad(STRUCTURE_ABBREVIATIONS[type], 6, 'right'))
		].join(' ')
	);
	for (const checkpoint of aggregate.structureMix) {
		lines.push(
			[
				pad(checkpoint.tick, 6, 'right'),
				pad(checkpoint.runs, 6, 'right'),
				pad(checkpoint.total, 7, 'right'),
				...STRUCTURE_TYPES.map((type) => pad(checkpoint.byType[type], 6, 'right'))
			].join(' ')
		);
	}
	if (aggregate.structureMix.length === 0) lines.push('(no checkpoint reached)');
	lines.push('');

	lines.push('PACING AGGREGATE (average across runs that reached the checkpoint)');
	lines.push(
		[
			pad('tick', 6, 'right'),
			pad('runs', 6, 'right'),
			pad('avgFronts', 10, 'right'),
			pad('avgElim', 10, 'right')
		].join(' ')
	);
	for (const checkpoint of aggregate.pace) {
		lines.push(
			[
				pad(checkpoint.tick, 6, 'right'),
				pad(checkpoint.runs, 6, 'right'),
				pad(checkpoint.averageActiveFronts, 10, 'right'),
				pad(checkpoint.averageCumulativeEliminations, 10, 'right')
			].join(' ')
		);
	}

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
	const runs: SeedRun[] = [];
	for (const seed of seeds) {
		runs.push(runSeed(seed, { maxTicks: options.maxTicks }));
	}

	const report: BalanceReport = {
		version: REPORT_VERSION,
		options: {
			seeds: options.seeds,
			startSeed: options.startSeed,
			maxTicks: options.maxTicks,
			playerCount: runs[0]?.playerCount ?? PLAYER_COUNT,
			botDifficulty: runs[0]?.botDifficulty ?? 'standard'
		},
		seeds: runs.map((run) => run.record),
		aggregate: aggregate(runs)
	};

	if (options.json) console.log(JSON.stringify(report, null, 2));
	else console.log(formatReport(report));
}

main(process.argv.slice(2));
