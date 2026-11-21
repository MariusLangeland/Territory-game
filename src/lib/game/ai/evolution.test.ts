import { describe, expect, it } from 'vitest';
import { TerritorySimulation, type PublicPlayer } from '../simulation';
import {
	DEFAULT_FITNESS_WEIGHTS,
	EvolutionSandbox,
	genomeFitness,
	normalizeFitnessWeights,
	runEvolution
} from './evolution';
import { parseEvolutionCsv, serializeEvolutionCsv } from './evolution-csv';
import { BOT_MODULE_IDS, createRandomGenome, crossoverGenomes, mutateGenome } from './genome';

describe('evolutionary AI sandbox', () => {
	it('generates deterministic genomes and mutates them within bounds', () => {
		const first = createRandomGenome(1234);
		const second = createRandomGenome(1234);
		expect(first).toEqual(second);
		expect(first.id).not.toBe(createRandomGenome(5678).id);
		expect(Object.keys(first.modules)).toEqual([...BOT_MODULE_IDS]);

		const mutated = mutateGenome(first, 99, 1);
		expect(mutated.generation).toBe(1);
		expect(mutated.parents).toEqual([first.id]);
		for (const moduleId of BOT_MODULE_IDS) {
			expect(mutated.modules[moduleId]).toBeGreaterThanOrEqual(0);
			expect(mutated.modules[moduleId]).toBeLessThanOrEqual(100);
		}
		const child = crossoverGenomes(first, mutated, 123, 2);
		expect(child.parents).toEqual([first.id, mutated.id]);
		expect(child.generation).toBe(2);
	});

	it('applies configurable fitness weights and normalizes bad values', () => {
		const player = { landShare: 0.5, alive: true } as unknown as PublicPlayer;
		const strategy = {
			economy: 10,
			defense: 10,
			naval: 2,
			aggression: 10,
			cooperation: 5,
			eliminations: 1,
			weakAttacks: 3,
			defenseStops: 2,
			defenseDamage: 100
		};
		const baseline = genomeFitness(player, 10, 100, true, strategy);
		const zeroed = genomeFitness(player, 10, 100, true, strategy, {
			land: 0,
			income: 0,
			attack: 0,
			win: 0,
			survival: 0,
			economy: 0,
			defense: 0,
			naval: 0,
			aggression: 0,
			cooperation: 0,
			eliminations: 0,
			weakAttacks: 0,
			defenseStops: 0,
			defenseDamage: 0
		});
		expect(baseline).toBeGreaterThan(0);
		expect(zeroed).toBe(0);
		const normalized = normalizeFitnessWeights({ land: -10, win: Number.POSITIVE_INFINITY });
		expect(normalized.land).toBe(0);
		expect(normalized.win).toBe(DEFAULT_FITNESS_WEIGHTS.win);
		// The default land term is intentionally half the old 120k value.
		expect(DEFAULT_FITNESS_WEIGHTS.land).toBe(60_000);
	});

	it('continues a finished run from its last generation', () => {
		const sandbox = new EvolutionSandbox({
			seed: 31,
			populationSize: 4,
			generations: 1,
			playerCount: 2,
			matchesPerRound: 1,
			ticks: 200,
			width: 640,
			height: 360
		});
		sandbox.begin();
		let guard = 0;
		while (sandbox.phase !== 'finished' && guard++ < 200) {
			if (!sandbox.currentSimulation) {
				if (!sandbox.nextMatch()) break;
				continue;
			}
			while (!sandbox.step(200)) {
				// Run round to completion.
			}
			sandbox.finishMatch();
			sandbox.nextMatch();
		}
		expect(sandbox.phase).toBe('finished');
		expect(sandbox.continueEvolution()).toBe(true);
		expect(sandbox.phase).toBe('generation-complete');
		expect(sandbox.config.generations).toBe(2);
		expect(sandbox.nextMatch()).toBe(true);
		expect(sandbox.generation).toBe(1);
	});

	it('runs deterministic selection, pruning, and bucket assignment', () => {
		const config = {
			seed: 42,
			populationSize: 8,
			generations: 2,
			playerCount: 4,
			matchesPerRound: 1,
			ticks: 300,
			width: 640,
			height: 360
		} as const;
		const left = runEvolution(config);
		const right = runEvolution(config);
		expect(left.generations).toHaveLength(2);
		expect(left.final.rows).toHaveLength(8);
		expect(left.final.rows.map((row) => row.genome.id)).toEqual(
			right.final.rows.map((row) => row.genome.id)
		);
		expect(left.final.rows.map((row) => row.fitness)).toEqual(
			right.final.rows.map((row) => row.fitness)
		);
		expect(left.final.buckets.top.length).toBeGreaterThan(0);
		expect(left.final.buckets.good.length).toBeGreaterThan(0);
		expect(left.final.buckets.poor.length).toBeGreaterThan(0);
		expect(new Set(left.final.rows.map((row) => row.genome.id)).size).toBe(8);
		expect(left.final.rows.every((row) => /^E\d-D\d-N\d-A\d$/.test(row.descriptor))).toBe(true);
		expect(left.archive.length).toBeGreaterThan(0);
		expect(left.archive.every((row) => /^E\d-D\d-N\d-A\d$/.test(row.descriptor))).toBe(true);
	});

	it('schedules every population genome at least once per generation', () => {
		const sandbox = new EvolutionSandbox({
			seed: 17,
			populationSize: 13,
			generations: 2,
			playerCount: 4,
			matchesPerRound: 2,
			ticks: 200,
			width: 640,
			height: 360
		});
		sandbox.begin();
		const schedule = (sandbox as unknown as { schedule: Array<Array<{ id: string }>> }).schedule;
		const appearances = new Map<string, number>();
		for (const seats of schedule) {
			const unique = new Set(seats.map((seat) => seat.id));
			expect(unique.size).toBe(seats.length);
			for (const id of unique) appearances.set(id, (appearances.get(id) ?? 0) + 1);
		}
		expect(appearances.size).toBe(13);
		const counts = [...appearances.values()];
		expect(Math.min(...counts)).toBeGreaterThanOrEqual(1);
		expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
	});

	it('runs mirrored ancestor duels in 1v1 lineage mode', () => {
		const report = runEvolution({
			seed: 5,
			populationSize: 8,
			generations: 3,
			playerCount: 2,
			matchesPerRound: 2,
			ticks: 200,
			width: 640,
			height: 360,
			lineageDuels: true
		});
		const rows = report.final.rows;
		expect(rows).toHaveLength(8);
		expect(
			rows
				.filter((row) => row.genome.parents.length > 0)
				.every((row) => row.lineageWins + row.lineageLosses <= 1)
		).toBe(true);
		const allRows = report.generations.flatMap((generation) => generation.rows);
		expect(allRows.some((row) => row.lineageWins > 0)).toBe(true);
		expect(allRows.some((row) => row.lineageLosses > 0)).toBe(true);
	}, 10_000);

	it('schedules each mirrored 1v1 pair exactly once', () => {
		const sandbox = new EvolutionSandbox({
			seed: 5,
			populationSize: 4,
			generations: 2,
			playerCount: 2,
			matchesPerRound: 2,
			ticks: 200,
			width: 640,
			height: 360,
			lineageDuels: true
		});
		sandbox.begin();
		const schedule = (sandbox as unknown as { schedule: Array<Array<{ id: string }>> }).schedule;
		expect(schedule.length % 2).toBe(0);
		const pairs = new Set<string>();
		for (let index = 0; index < schedule.length; index += 2) {
			const first = schedule[index];
			const second = schedule[index + 1];
			expect(first[0].id).toBe(second[1].id);
			expect(first[1].id).toBe(second[0].id);
			const key =
				first[0].id < first[1].id
					? `${first[0].id}|${first[1].id}`
					: `${first[1].id}|${first[0].id}`;
			expect(pairs.has(key)).toBe(false);
			pairs.add(key);
		}
	});

	it('round-trips genomes through the spreadsheet CSV', () => {
		const report = runEvolution({
			seed: 7,
			populationSize: 6,
			generations: 2,
			playerCount: 3,
			matchesPerRound: 1,
			ticks: 250,
			width: 640,
			height: 360
		});
		const csv = serializeEvolutionCsv(report);
		const genomes = parseEvolutionCsv(csv);
		expect(genomes.length).toBeGreaterThanOrEqual(2);
		const source = report.final.rows.find((row) => row.genome.id === genomes[0].id);
		expect(source).toBeDefined();
		if (!source) return;
		expect(genomes[0].aggression).toBe(source.genome.aggression);
		expect(genomes[0].modules).toEqual(source.genome.modules);
		expect(genomes[0].markov).toEqual(source.genome.markov);
	});

	it('can run an all-bot match with genome-derived profiles', () => {
		const genomes = Array.from({ length: 4 }, (_, index) => createRandomGenome(100 + index));
		const sim = new TerritorySimulation({
			seed: 9,
			playerCount: 4,
			width: 640,
			height: 360,
			allPlayersBots: true,
			botGenomes: genomes
		});
		expect(sim.players.every((player) => player.isBot)).toBe(true);
		const internals = sim as unknown as {
			botProfiles: Array<{ genomeId: string | null }>;
		};
		expect(internals.botProfiles[0].genomeId).toBe(genomes[0].id);
		expect(internals.botProfiles[3].genomeId).toBe(genomes[3].id);
		for (let tick = 0; tick < 200; tick++) sim.step();
		expect(sim.tick).toBe(200);
	});

	it('supports loading a custom population into the sandbox', () => {
		const sandbox = new EvolutionSandbox({
			populationSize: 4,
			playerCount: 2,
			generations: 1,
			ticks: 200,
			width: 640,
			height: 360
		});
		const genomes = Array.from({ length: 4 }, (_, index) => createRandomGenome(500 + index));
		expect(sandbox.setPopulation(genomes)).toBe(true);
		expect(sandbox.population.map((genome) => genome.id)).toEqual(
			genomes.map((genome) => genome.id)
		);
	});
});
