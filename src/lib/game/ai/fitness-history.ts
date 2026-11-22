export interface FitnessHistoryRow {
	genome: { id: string };
	fitness: number;
}

export interface FitnessHistoryGeneration {
	generation: number;
	rows: readonly FitnessHistoryRow[];
}

export interface FitnessHistoryPoint {
	generation: number;
	best: number;
	average: number;
	selected: number | null;
}

/**
 * Builds one chart point per completed generation. The selected genome is
 * matched by id, so elites that survive into later generations remain on the
 * chart while newly bred genomes simply have no selected point yet.
 */
export function buildFitnessHistory(
	generations: readonly FitnessHistoryGeneration[],
	selectedGenomeId: string | null
): FitnessHistoryPoint[] {
	return generations.map((generation) => {
		let best = Number.NEGATIVE_INFINITY;
		let total = 0;
		let selected: number | null = null;
		for (const row of generation.rows) {
			best = Math.max(best, row.fitness);
			total += row.fitness;
			if (selectedGenomeId && row.genome.id === selectedGenomeId) {
				selected = row.fitness;
			}
		}
		return {
			generation: generation.generation + 1,
			best: Number.isFinite(best) ? best : 0,
			average: generation.rows.length > 0 ? total / generation.rows.length : 0,
			selected
		};
	});
}
