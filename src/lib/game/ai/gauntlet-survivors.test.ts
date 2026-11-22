import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOT_MODULE_IDS } from './genome';

describe('gauntlet survivor bot roster', () => {
	it('contains the committed seed-1236 run-24 survivor genomes', () => {
		const file = JSON.parse(
			readFileSync(new URL('../../../../static/gauntlet-survivors.json', import.meta.url), 'utf8')
		) as {
			version: number;
			source: { seed: number; run: number };
			genomes: Array<{
				id: string;
				version: number;
				modules: Record<string, number>;
				markov: unknown;
			}>;
		};
		expect(file.version).toBe(1);
		expect(file.source.seed).toBe(1236);
		expect(file.source.run).toBe(24);
		expect(file.genomes).toHaveLength(21);
		expect(new Set(file.genomes.map((genome) => genome.id)).size).toBe(21);
		for (const genome of file.genomes) {
			expect(genome.version).toBe(2);
			expect(Object.keys(genome.modules)).toEqual([...BOT_MODULE_IDS]);
			expect(genome.markov).toBeTruthy();
		}
	});
});
