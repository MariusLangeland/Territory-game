/**
 * AI balance matrix: 8 seeds × 6,000 ticks across difficulty and growth mode.
 *
 * Measures outcome distribution, elimination variance, frontline activity,
 * fortification coverage, economy investment, and the new bot behavior counters.
 * Writes reports/ai-balance.json and a flat CSV.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TICK_RATE } from '../src/lib/game/constants';
import type { GrowthMode } from '../src/lib/game/growth';
import {
	TerritorySimulation,
	type BotBehaviorTelemetry,
	type GameSnapshot
} from '../src/lib/game/simulation';

const DEFAULT_SEEDS = 8;
const DEFAULT_START_SEED = 1234;
const DEFAULT_TICKS = 6000;
const MODES: readonly GrowthMode[] = ['organic', 'circular'];
const DIFFICULTIES = ['standard', 'ruthless'] as const;
type Difficulty = (typeof DIFFICULTIES)[number];

interface RunMetrics {
	seed: number;
	growthMode: GrowthMode;
	difficulty: Difficulty;
	endTick: number;
	ended: boolean;
	timeout: boolean;
	alive: number;
	eliminations: number;
	frontsAtEnd: number;
	averageFronts: number;
	peakFronts: number;
	fortifications: number;
	commandPosts: number;
	warAcademies: number;
	barracks: number;
	jammers: number;
	ports: number;
	averageBotIncome: number;
	fortifiedFrontShare: number;
	botBehavior: BotBehaviorTelemetry;
	checksum: number;
}

interface Aggregate {
	runs: number;
	averageEndTick: number;
	timeoutRate: number;
	averageAlive: number;
	averageEliminations: number;
	eliminationStdDev: number;
	averageFronts: number;
	peakFronts: number;
	averageFortifications: number;
	averageCommandPosts: number;
	averageWarAcademies: number;
	averageBotIncome: number;
	averageFortifiedFrontShare: number;
	botBehavior: BotBehaviorTelemetry;
}

function countStructures(snapshot: GameSnapshot, type: string): number {
	return snapshot.structures.filter((structure) => structure.type === type).length;
}

/** Fraction of active hostile fronts whose target has a defender Fort within 40 px. */
function fortifiedFrontShare(snapshot: GameSnapshot): number {
	const hostile = snapshot.attacks.filter((attack) => attack.defenderId > 0);
	if (hostile.length === 0) return 1;
	let fortified = 0;
	for (const attack of hostile) {
		const target = snapshot.structures.some(
			(structure) =>
				structure.ownerId === attack.defenderId &&
				structure.type === 'fortification' &&
				Math.abs(structure.x - attack.targetX) + Math.abs(structure.y - attack.targetY) <= 40
		);
		if (target) fortified++;
	}
	return fortified / hostile.length;
}

function emptyBehavior(): BotBehaviorTelemetry {
	return {
		threatenedFortificationBuilds: 0,
		threatenedFortificationUpgrades: 0,
		deterrencePostures: 0,
		incomeGapCommandPosts: 0,
		incomeGapWarAcademies: 0,
		opportunityAttacks: 0,
		botPortBuilds: 0,
		botNavalLandings: 0
	};
}

function runMatch(
	seed: number,
	mode: GrowthMode,
	difficulty: Difficulty,
	ticks: number
): RunMetrics {
	const simulation = new TerritorySimulation({
		seed,
		growthMode: mode,
		botDifficulty: difficulty,
		matchDurationTicks: ticks
	});
	let snapshot = simulation.getSnapshot();
	let peakFronts = snapshot.attacks.length;
	let frontSum = 0;
	let frontSamples = 0;
	while (!snapshot.ended && snapshot.tick < ticks) {
		const result = simulation.step();
		snapshot = result.snapshot;
		peakFronts = Math.max(peakFronts, snapshot.attacks.length);
		if (snapshot.tick % 100 === 0) {
			frontSum += snapshot.attacks.length;
			frontSamples++;
		}
	}
	const alive = snapshot.players.filter((player) => player.alive).length;
	const aliveBots = snapshot.players.filter((player) => player.alive && player.isBot);
	const averageBotIncome =
		aliveBots.length === 0
			? 0
			: aliveBots.reduce((sum, player) => sum + simulation.incomeOf(player.id), 0) /
				aliveBots.length;
	return {
		seed,
		growthMode: mode,
		difficulty,
		endTick: snapshot.tick,
		ended: snapshot.ended,
		timeout: !snapshot.ended,
		alive,
		eliminations: snapshot.players.length - alive,
		frontsAtEnd: snapshot.attacks.length,
		averageFronts: frontSamples > 0 ? frontSum / frontSamples : 0,
		peakFronts,
		fortifications: countStructures(snapshot, 'fortification'),
		commandPosts: countStructures(snapshot, 'command-post'),
		warAcademies: countStructures(snapshot, 'war-academy'),
		barracks: countStructures(snapshot, 'barracks'),
		jammers: countStructures(snapshot, 'jammer'),
		ports: countStructures(snapshot, 'port'),
		averageBotIncome,
		fortifiedFrontShare: fortifiedFrontShare(snapshot),
		botBehavior: simulation.getBotBehaviorTelemetry(),
		checksum: simulation.checksum()
	};
}

function average(values: readonly number[]): number {
	return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdDev(values: readonly number[]): number {
	if (values.length < 2) return 0;
	const mean = average(values);
	return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
}

function aggregate(runs: RunMetrics[]): Aggregate {
	const behavior = emptyBehavior();
	for (const run of runs) {
		for (const key of Object.keys(behavior) as Array<keyof BotBehaviorTelemetry>) {
			behavior[key] += run.botBehavior[key];
		}
	}
	return {
		runs: runs.length,
		averageEndTick: average(runs.map((run) => run.endTick)),
		timeoutRate: average(runs.map((run) => (run.timeout ? 1 : 0))),
		averageAlive: average(runs.map((run) => run.alive)),
		averageEliminations: average(runs.map((run) => run.eliminations)),
		eliminationStdDev: stdDev(runs.map((run) => run.eliminations)),
		averageFronts: average(runs.map((run) => run.averageFronts)),
		peakFronts: Math.max(...runs.map((run) => run.peakFronts)),
		averageFortifications: average(runs.map((run) => run.fortifications)),
		averageCommandPosts: average(runs.map((run) => run.commandPosts)),
		averageWarAcademies: average(runs.map((run) => run.warAcademies)),
		averageBotIncome: average(runs.map((run) => run.averageBotIncome)),
		averageFortifiedFrontShare: average(runs.map((run) => run.fortifiedFrontShare)),
		botBehavior: behavior
	};
}

function csv(rows: RunMetrics[]): string {
	const header = [
		'seed',
		'growthMode',
		'difficulty',
		'endTick',
		'ended',
		'timeout',
		'alive',
		'eliminations',
		'frontsAtEnd',
		'averageFronts',
		'peakFronts',
		'fortifications',
		'commandPosts',
		'warAcademies',
		'barracks',
		'jammers',
		'ports',
		'averageBotIncome',
		'fortifiedFrontShare',
		'threatenedFortificationBuilds',
		'threatenedFortificationUpgrades',
		'deterrencePostures',
		'incomeGapCommandPosts',
		'incomeGapWarAcademies',
		'opportunityAttacks',
		'botPortBuilds',
		'botNavalLandings'
	];
	const lines = [header.join(',')];
	for (const row of rows) {
		lines.push(
			[
				row.seed,
				row.growthMode,
				row.difficulty,
				row.endTick,
				row.ended,
				row.timeout,
				row.alive,
				row.eliminations,
				row.frontsAtEnd,
				row.averageFronts.toFixed(2),
				row.peakFronts,
				row.fortifications,
				row.commandPosts,
				row.warAcademies,
				row.barracks,
				row.jammers,
				row.ports,
				row.averageBotIncome.toFixed(2),
				row.fortifiedFrontShare.toFixed(3),
				...Object.values(row.botBehavior)
			].join(',')
		);
	}
	return `${lines.join('\r\n')}\r\n`;
}

function main(): void {
	const args = process.argv.slice(2);
	const numberArg = (name: string, fallback: number): number => {
		const index = args.indexOf(name);
		return index >= 0 ? Number(args[index + 1]) : fallback;
	};
	const seeds = Math.max(1, Math.trunc(numberArg('--seeds', DEFAULT_SEEDS)));
	const startSeed = Math.trunc(numberArg('--start-seed', DEFAULT_START_SEED)) >>> 0;
	const ticks = Math.max(100, Math.trunc(numberArg('--ticks', DEFAULT_TICKS)));
	const modeArg = args.includes('--mode') ? args[args.indexOf('--mode') + 1] : '';
	const difficultyArg = args.includes('--difficulty') ? args[args.indexOf('--difficulty') + 1] : '';
	const modes = MODES.filter((mode) => !modeArg || mode === modeArg);
	const difficulties = DIFFICULTIES.filter(
		(difficulty) => !difficultyArg || difficulty === difficultyArg
	);
	const outputPrefix = args.includes('--out-prefix')
		? args[args.indexOf('--out-prefix') + 1]
		: 'ai-balance';
	const runs: RunMetrics[] = [];
	for (const difficulty of difficulties) {
		for (const mode of modes) {
			for (let index = 0; index < seeds; index++) {
				const seed = (startSeed + index) >>> 0;
				const run = runMatch(seed, mode, difficulty, ticks);
				runs.push(run);
				console.log(
					`${difficulty.padEnd(8)} ${mode.padEnd(8)} seed ${seed} tick ${run.endTick} alive ${run.alive} elim ${run.eliminations} fronts ${run.averageFronts.toFixed(1)} forts ${run.fortifications}`
				);
			}
		}
	}
	const grouped = new Map<string, RunMetrics[]>();
	for (const run of runs) {
		const key = `${run.difficulty}/${run.growthMode}`;
		const entries = grouped.get(key) ?? [];
		entries.push(run);
		grouped.set(key, entries);
	}
	const report = {
		version: 1,
		options: { seeds, startSeed, ticks, tickRate: TICK_RATE },
		runs,
		aggregates: Object.fromEntries(
			Array.from(grouped.entries()).map(([key, entries]) => [key, aggregate(entries)])
		),
		overall: aggregate(runs)
	};
	const directory = resolve('reports');
	mkdirSync(directory, { recursive: true });
	writeFileSync(
		resolve(directory, `${outputPrefix}.json`),
		JSON.stringify(report, null, 2),
		'utf8'
	);
	writeFileSync(resolve(directory, `${outputPrefix}.csv`), csv(runs), 'utf8');
	console.log('\nOverall');
	console.table(report.overall);
	console.log(`Wrote reports/${outputPrefix}.json and reports/${outputPrefix}.csv`);
}

main();
