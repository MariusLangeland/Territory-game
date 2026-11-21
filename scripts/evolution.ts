/**
 * Headless evolutionary AI sandbox.
 *
 * Runs deterministic bot-vs-bot matches, scores genomes by land, income, attack
 * strength, survival, and wins, prunes the bottom half, mutates/crosses the
 * survivors, and writes the final bucket spreadsheet as CSV.
 *
 * Usage:
 *   pnpm evolution --population 16 --generations 4 --ticks 1600 --out reports/evolution.csv
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
	DEFAULT_EVOLUTION_CONFIG,
	EvolutionSandbox,
	normalizeEvolutionConfig,
	serializeEvolutionCsv,
	type EvolutionConfig
} from '../src/lib/game/ai';

interface CliOptions {
	config: Partial<EvolutionConfig>;
	out: string;
}

function parseArgs(argv: readonly string[]): CliOptions {
	const options: CliOptions = {
		config: { ...DEFAULT_EVOLUTION_CONFIG },
		out: 'reports/evolution.csv'
	};
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		const next = (): string => argv[++index] ?? '';
		if (arg === '--population') options.config.populationSize = Number(next());
		else if (arg === '--generations') options.config.generations = Number(next());
		else if (arg === '--matches') options.config.matchesPerRound = Number(next());
		else if (arg === '--players') options.config.playerCount = Number(next());
		else if (arg === '--ticks') options.config.ticks = Number(next());
		else if (arg === '--seed') options.config.seed = Number(next());
		else if (arg === '--width') options.config.width = Number(next());
		else if (arg === '--height') options.config.height = Number(next());
		else if (arg === '--out') options.out = next();
		else if (arg === '--help' || arg === '-h') {
			console.log(
				'Usage: pnpm evolution [--population N] [--generations N] [--matches N] [--players N] [--ticks N] [--seed N] [--out file.csv]'
			);
			process.exit(0);
		}
	}
	return options;
}

const options = parseArgs(process.argv.slice(2));
const config = normalizeEvolutionConfig(options.config);
const sandbox = new EvolutionSandbox(config);
sandbox.begin();

let guard = 0;
let reportedGenerations = 0;
while (sandbox.phase !== 'finished' && guard++ < 100_000) {
	if (!sandbox.currentSimulation) {
		if (!sandbox.nextMatch()) break;
		continue;
	}
	while (!sandbox.step(64)) {
		// step() returns true when the match is complete.
	}
	sandbox.finishMatch();
	if (sandbox.reports.length > reportedGenerations) {
		const generation = sandbox.reports[sandbox.reports.length - 1];
		reportedGenerations = sandbox.reports.length;
		const best = generation?.rows[0];
		if (generation && best) {
			console.log(
				`generation ${generation.generation + 1}/${sandbox.config.generations}: top ${best.fitness.toFixed(1)} (${best.genome.id})`
			);
		}
	}
}

const report = sandbox.report();
const csv = serializeEvolutionCsv(report);
const target = resolve(options.out);
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, csv, 'utf8');

console.log(`\nEvolution complete: ${report.final.rows.length} genomes`);
console.log(`CSV: ${target}`);
for (const bucket of ['top', 'good', 'poor'] as const) {
	const ids = report.final.buckets[bucket];
	const best = report.final.rows.find((row) => row.genome.id === ids[0]);
	console.log(
		`  ${bucket.padEnd(4)} ${String(ids.length).padStart(2)} genomes` +
			(best ? `  best fitness ${best.fitness.toFixed(1)}` : '')
	);
}
