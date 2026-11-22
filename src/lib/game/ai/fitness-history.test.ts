import { describe, expect, it } from 'vitest';
import { buildFitnessHistory } from './fitness-history';

const generations = [
	{
		generation: 0,
		rows: [
			{ genome: { id: 'a' }, fitness: 10 },
			{ genome: { id: 'b' }, fitness: 30 }
		]
	},
	{
		generation: 1,
		rows: [
			{ genome: { id: 'b' }, fitness: 40 },
			{ genome: { id: 'c' }, fitness: 20 }
		]
	}
];

describe('fitness history', () => {
	it('computes best, average, and selected values per generation', () => {
		expect(buildFitnessHistory(generations, 'b')).toEqual([
			{ generation: 1, best: 30, average: 20, selected: 30 },
			{ generation: 2, best: 40, average: 30, selected: 40 }
		]);
	});

	it('leaves the selected point empty when the genome is not present', () => {
		expect(buildFitnessHistory(generations, 'z').map((point) => point.selected)).toEqual([
			null,
			null
		]);
	});

	it('handles an empty history', () => {
		expect(buildFitnessHistory([], 'a')).toEqual([]);
		expect(buildFitnessHistory([{ generation: 0, rows: [] }], null)).toEqual([
			{ generation: 1, best: 0, average: 0, selected: null }
		]);
	});
});
