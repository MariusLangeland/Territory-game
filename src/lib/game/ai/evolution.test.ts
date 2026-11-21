import { describe, expect, it } from 'vitest';
import { TerritorySimulation } from '../simulation';
import { EvolutionSandbox, runEvolution } from './evolution';
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
