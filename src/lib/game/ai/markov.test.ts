import { describe, expect, it } from 'vitest';
import { TerritorySimulation } from '../simulation';
import { createRandomGenome, crossoverGenomes, mutateGenome } from './genome';
import {
	createRandomMarkov,
	crossoverMarkov,
	MARKOV_MAX_STATES,
	MARKOV_MIN_STATES,
	mutateMarkov,
	normalizeMarkov,
	type MarkovController
} from './markov';

function reachable(controller: MarkovController): Set<number> {
	const visited = new Set<number>([controller.initial]);
	const queue = [controller.initial];
	while (queue.length > 0) {
		const current = queue.shift() as number;
		for (const transition of controller.transitions) {
			if (transition.from !== current || visited.has(transition.to)) continue;
			visited.add(transition.to);
			queue.push(transition.to);
		}
	}
	return visited;
}

function expectValid(controller: MarkovController): void {
	expect(controller.states.length).toBeGreaterThanOrEqual(MARKOV_MIN_STATES);
	expect(controller.states.length).toBeLessThanOrEqual(MARKOV_MAX_STATES);
	expect(controller.initial).toBeGreaterThanOrEqual(0);
	expect(controller.initial).toBeLessThan(controller.states.length);
	const visited = reachable(controller);
	for (let index = 0; index < controller.states.length; index++) {
		expect(visited.has(index)).toBe(true);
		expect(controller.transitions.some((transition) => transition.from === index)).toBe(true);
	}
	for (const transition of controller.transitions) {
		expect(transition.from).toBeGreaterThanOrEqual(0);
		expect(transition.to).toBeGreaterThanOrEqual(0);
		expect(transition.chance).toBeGreaterThan(0);
		expect(transition.chance).toBeLessThanOrEqual(100);
	}
}

describe('semi-Markov qualitative genomes', () => {
	it('creates or repairs a valid controller deterministically', () => {
		const first = createRandomMarkov(1234);
		const second = createRandomMarkov(1234);
		expect(first).toEqual(second);
		expectValid(first);
		const repaired = normalizeMarkov(
			{
				initial: 99,
				states: [
					{
						option: 'expand',
						dwell: -1,
						bias: { economy: 500, attack: 0, defense: 0, naval: 0, conserve: 0 }
					}
				],
				transitions: [
					{ from: 0, to: 7, when: 'always', chance: 0 },
					{ from: 0, to: 0, when: 'threat-high', chance: 50 }
				]
			},
			7
		);
		expect(repaired).toBeNull();
	});
	it('mutates and crosses structure while preserving reachability', () => {
		const first = createRandomMarkov(9);
		const second = createRandomMarkov(42);
		const mutated = mutateMarkov(first, 17);
		expect(mutated).toEqual(mutateMarkov(first, 17));
		expectValid(mutated);
		const crossed = crossoverMarkov(first, second, 23);
		expect(crossed).toEqual(crossoverMarkov(first, second, 23));
		expectValid(crossed);
	});
	it('drives the strategic option state deterministically', () => {
		const genome = createRandomGenome(55);
		expect(genome.markov).not.toBeNull();
		const config = {
			seed: 9,
			width: 640,
			height: 360,
			playerCount: 2,
			allPlayersBots: true,
			botGenomes: [genome, createRandomGenome(55)]
		} as const;
		const left = new TerritorySimulation(config);
		const right = new TerritorySimulation(config);
		for (let tick = 0; tick < 300; tick++) {
			left.step();
			right.step();
		}
		expect(left.getBotMarkovState(1)).not.toBeNull();
		expect(left.getBotMarkovState(1)).toBe(right.getBotMarkovState(1));
		expect(left.getBotOption(1)).toBe(right.getBotOption(1));
		expect(left.checksum()).toBe(right.checksum());
	});
	it('mutates and crosses genome-level controllers', () => {
		const parent = createRandomGenome(7);
		const other = createRandomGenome(8);
		const child = mutateGenome(parent, 91, 1);
		expect(child.markov).not.toBeNull();
		expectValid(child.markov as MarkovController);
		const crossed = crossoverGenomes(parent, other, 92, 2);
		expect(crossed.markov).not.toBeNull();
		expectValid(crossed.markov as MarkovController);
	});
});
