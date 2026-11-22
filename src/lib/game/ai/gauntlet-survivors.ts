import type { BotGenome } from './genome';
import { normalizeMarkov } from './markov';

interface GauntletSurvivorFile {
	version: number;
	source: {
		kind: string;
		seed: number;
		run: number;
		totalRuns: number;
		originalPopulation: number;
	};
	genomes: BotGenome[];
}

export interface GauntletSurvivorMetadata {
	seed: number;
	run: number;
	totalRuns: number;
	originalPopulation: number;
}

let cached: BotGenome[] | null = null;
let pending: Promise<BotGenome[]> | null = null;
let metadata: GauntletSurvivorMetadata | null = null;

/**
 * Load the committed gauntlet survivor pool used as the base bot roster for the
 * main game. Cached after the first successful fetch.
 */
export async function loadGauntletSurvivors(): Promise<BotGenome[]> {
	if (cached) return cached;
	if (pending) return pending;
	pending = (async () => {
		try {
			const response = await fetch('/gauntlet-survivors.json', { cache: 'force-cache' });
			if (!response.ok) return [];
			const file = (await response.json()) as Partial<GauntletSurvivorFile>;
			if (file.version !== 1 || !Array.isArray(file.genomes)) return [];
			const genomes = file.genomes
				.filter((genome): genome is BotGenome => Boolean(genome && typeof genome.id === 'string'))
				.map((genome) => ({
					...genome,
					markov: normalizeMarkov(genome.markov ?? null, 0)
				}));
			if (file.source) {
				metadata = {
					seed: file.source.seed,
					run: file.source.run,
					totalRuns: file.source.totalRuns,
					originalPopulation: file.source.originalPopulation
				};
			}
			cached = genomes;
			return genomes;
		} catch {
			return [];
		} finally {
			pending = null;
		}
	})();
	return pending;
}

export function gauntletSurvivorMetadata(): GauntletSurvivorMetadata | null {
	return metadata;
}
