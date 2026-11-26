import type { BotDifficulty } from '../simulation';
import type { BotGenome } from './genome';

export type BotBucket = 'poor' | 'good' | 'top';

/** Optional locally saved bot pools. The shipped gauntlet roster remains the default. */
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
