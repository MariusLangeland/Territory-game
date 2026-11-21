import type { BotDifficulty } from '../simulation';
import type { BotGenome } from './genome';
import type { BotBucket, EvolutionReport } from './evolution';

export interface EvolutionBuckets {
	version: 1;
	updatedAt: number;
	poor: BotGenome[];
	good: BotGenome[];
	top: BotGenome[];
}

const STORAGE_KEY = 'territory.evolution.buckets.v1';

export function emptyBuckets(): EvolutionBuckets {
	return { version: 1, updatedAt: 0, poor: [], good: [], top: [] };
}

export function bucketsFromReport(report: EvolutionReport): EvolutionBuckets {
	const final = report.final;
	if (!final) return emptyBuckets();
	const genomeById = new Map(final.rows.map((row) => [row.genome.id, row.genome]));
	const genomesFor = (ids: string[]): BotGenome[] =>
		ids.map((id) => genomeById.get(id)).filter((genome): genome is BotGenome => Boolean(genome));
	return {
		version: 1,
		updatedAt: Date.now(),
		poor: genomesFor(final.buckets.poor),
		good: genomesFor(final.buckets.good),
		top: genomesFor(final.buckets.top)
	};
}

export function loadEvolutionBuckets(): EvolutionBuckets {
	if (typeof window === 'undefined') return emptyBuckets();
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw) return emptyBuckets();
		const parsed = JSON.parse(raw) as Partial<EvolutionBuckets>;
		return {
			version: 1,
			updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
			poor: Array.isArray(parsed.poor) ? parsed.poor : [],
			good: Array.isArray(parsed.good) ? parsed.good : [],
			top: Array.isArray(parsed.top) ? parsed.top : []
		};
	} catch {
		return emptyBuckets();
	}
}

export function saveEvolutionBuckets(buckets: EvolutionBuckets): void {
	if (typeof window === 'undefined') return;
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(buckets));
	} catch {
		// Storage can be full or unavailable; evolution still works without it.
	}
}

export function clearEvolutionBuckets(): void {
	if (typeof window === 'undefined') return;
	try {
		window.localStorage.removeItem(STORAGE_KEY);
	} catch {
		// Ignore unavailable storage.
	}
}

export function bucketForDifficulty(difficulty: BotDifficulty): BotBucket {
	if (difficulty === 'relaxed') return 'poor';
	if (difficulty === 'ruthless') return 'top';
	return 'good';
}

export function difficultyGenomes(
	buckets: EvolutionBuckets,
	difficulty: BotDifficulty
): BotGenome[] {
	const preferred = buckets[bucketForDifficulty(difficulty)];
	if (preferred.length > 0) return preferred;
	if (buckets.top.length > 0) return buckets.top;
	if (buckets.good.length > 0) return buckets.good;
	return buckets.poor;
}

export function bucketCounts(buckets: EvolutionBuckets): Record<BotBucket, number> {
	return { poor: buckets.poor.length, good: buckets.good.length, top: buckets.top.length };
}
