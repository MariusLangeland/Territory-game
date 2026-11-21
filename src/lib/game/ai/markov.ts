import { hash32 } from '../map';
import { BOT_OPTION_IDS, type BotOptionId } from './options';

export const MARKOV_MIN_STATES = 2;
export const MARKOV_MAX_STATES = 6;

export const MARKOV_CONDITIONS = [
	'always',
	'threat-high',
	'threat-low',
	'income-behind',
	'income-ahead',
	'supply-low',
	'supply-high',
	'weak-neighbor',
	'ally-pressure'
] as const;

export type MarkovCondition = (typeof MARKOV_CONDITIONS)[number];

export interface MarkovBias {
	economy: number;
	attack: number;
	defense: number;
	naval: number;
	conserve: number;
}

export interface MarkovState {
	option: BotOptionId;
	/** Minimum ticks spent in this state before a transition can fire. */
	dwell: number;
	bias: MarkovBias;
}

export interface MarkovTransition {
	from: number;
	to: number;
	when: MarkovCondition;
	/** 0-100 percent. */
	chance: number;
}

export interface MarkovController {
	states: MarkovState[];
	transitions: MarkovTransition[];
	initial: number;
}

function hash(seed: number, salt: number): number {
	return hash32(secretSeed(seed), salt, 0x9e3779b9);
}

function secretSeed(seed: number): number {
	return seed >>> 0;
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, Math.round(value)));
}

function randomOption(seed: number): BotOptionId {
	return BOT_OPTION_IDS[hash(seed, 11) % BOT_OPTION_IDS.length];
}

function randomBias(seed: number): MarkovBias {
	return {
		economy: 25 + (hash(seed, 20) % 51),
		attack: 25 + (hash(seed, 21) % 51),
		defense: 25 + (hash(seed, 22) % 51),
		naval: 25 + (hash(seed, 23) % 51),
		conserve: 25 + (hash(seed, 24) % 51)
	};
}

function randomState(seed: number): MarkovState {
	return {
		option: randomOption(seed),
		dwell: 35 + (hash(seed, 30) % 56),
		bias: randomBias(seed)
	};
}

function randomCondition(seed: number): MarkovCondition {
	return MARKOV_CONDITIONS[hash(seed, 40) % MARKOV_CONDITIONS.length];
}

export function cloneMarkov(controller: MarkovController): MarkovController {
	return {
		initial: controller.initial,
		states: controller.states.map((state) => ({
			option: state.option,
			dwell: state.dwell,
			bias: { ...state.bias }
		})),
		transitions: controller.transitions.map((transition) => ({ ...transition }))
	};
}

/** Deterministic random controller used by new genomes. */
export function createRandomMarkov(seed: number): MarkovController {
	const stateCount =
		MARKOV_MIN_STATES + (hash(seed, 1) % (MARKOV_MAX_STATES - MARKOV_MIN_STATES + 1));
	const states = Array.from({ length: stateCount }, (_, index) => randomState(seed + index * 977));
	const transitions: MarkovTransition[] = [];
	for (let from = 0; from < stateCount; from++) {
		const edges = 1 + (hash(seed, 50 + from) % 2);
		for (let edge = 0; edge < edges; edge++) {
			const to = hash(seed, 70 + from * 3 + edge) % stateCount;
			if (to === from) continue;
			transitions.push({
				from,
				to,
				when: randomCondition(seed + from * 31 + edge * 17),
				chance: 45 + (hash(seed, 90 + from * 3 + edge) % 51)
			});
		}
	}
	return normalizeMarkov({ states, transitions, initial: 0 }, seed) as MarkovController;
}

/**
 * Repairs a controller into a valid, deterministic finite-state graph: bounded
 * state count, valid option labels, no unreachable state, no state without an
 * outgoing edge, and bounded dwell/chance values.
 */
export function normalizeMarkov(
	controller: MarkovController | null | undefined,
	seed = 0
): MarkovController | null {
	if (
		!controller ||
		!Array.isArray(controller.states) ||
		controller.states.length < MARKOV_MIN_STATES
	) {
		return null;
	}
	const states = controller.states.slice(0, MARKOV_MAX_STATES).map((state) => ({
		option: BOT_OPTION_IDS.includes(state.option) ? state.option : 'expand',
		dwell: clamp(Number(state.dwell) || 60, 20, 240),
		bias: {
			economy: clamp(Number(state.bias?.economy) || 50, 0, 100),
			attack: clamp(Number(state.bias?.attack) || 50, 0, 100),
			defense: clamp(Number(state.bias?.defense) || 50, 0, 100),
			naval: clamp(Number(state.bias?.naval) || 50, 0, 100),
			conserve: clamp(Number(state.bias?.conserve) || 50, 0, 100)
		}
	}));
	const transitions: MarkovTransition[] = [];
	const seen = new Set<string>();
	for (const transition of controller.transitions ?? []) {
		const from = Math.trunc(transition.from);
		const to = Math.trunc(transition.to);
		if (from < 0 || from >= states.length || to < 0 || to >= states.length || from === to) {
			continue;
		}
		if (!MARKOV_CONDITIONS.includes(transition.when)) continue;
		const chance = clamp(Number(transition.chance) || 100, 0, 100);
		if (chance <= 0) continue;
		const key = `${from}:${to}:${transition.when}`;
		if (seen.has(key)) continue;
		seen.add(key);
		transitions.push({ from, to, when: transition.when, chance });
	}
	const initial = clamp(Number(controller.initial) || 0, 0, states.length - 1);

	// Every state needs a live outgoing edge, and every state must be reachable
	// from the initial state.
	for (let state = 0; state < states.length; state++) {
		if (!transitions.some((transition) => transition.from === state)) {
			transitions.push({
				from: state,
				to: (state + 1) % states.length,
				when: 'always',
				chance: 100
			});
		}
	}
	for (let target = 0; target < states.length; target++) {
		const visited = new Set<number>([initial]);
		const queue = [initial];
		while (queue.length > 0) {
			const current = queue.shift() as number;
			for (const transition of transitions) {
				if (transition.from !== current || visited.has(transition.to)) continue;
				visited.add(transition.to);
				queue.push(transition.to);
			}
		}
		if (!visited.has(target)) {
			transitions.push({
				from: initial,
				to: target,
				when: target === 0 ? 'always' : randomCondition(seed + target * 53),
				chance: 100
			});
		}
	}
	return { states, transitions, initial };
}

function mutateState(state: MarkovState, seed: number): MarkovState {
	const next = {
		option: state.option,
		dwell: state.dwell,
		bias: { ...state.bias }
	};
	const choice = hash(seed, 1) % 3;
	if (choice === 0) next.option = randomOption(seed);
	else if (choice === 1) next.dwell = clamp(next.dwell + (hash(seed, 2) % 71) - 35, 20, 240);
	else {
		const key = (['economy', 'attack', 'defense', 'naval', 'conserve'] as const)[hash(seed, 3) % 5];
		next.bias[key] = clamp(next.bias[key] + (hash(seed, 4) % 41) - 20, 0, 100);
	}
	return next;
}

/** Numeric and structural mutation: states can be added, removed and rewired. */
export function mutateMarkov(controller: MarkovController, seed: number): MarkovController {
	const next = cloneMarkov(controller);
	const operations = 1 + (hash(seed, 10) % 3);
	for (let operation = 0; operation < operations; operation++) {
		const opSeed = seed + operation * 7919;
		const kind = hash(opSeed, 11) % 10;
		if (kind === 0 && next.states.length < MARKOV_MAX_STATES) {
			next.states.push(randomState(opSeed));
			const from = hash(opSeed, 12) % next.states.length;
			const to = next.states.length - 1;
			next.transitions.push({
				from,
				to,
				when: randomCondition(opSeed),
				chance: 55 + (hash(opSeed, 13) % 46)
			});
		} else if (kind === 1 && next.states.length > MARKOV_MIN_STATES) {
			const removed = hash(opSeed, 14) % next.states.length;
			next.states.splice(removed, 1);
			next.transitions = next.transitions
				.filter((transition) => transition.from !== removed && transition.to !== removed)
				.map((transition) => ({
					...transition,
					from: transition.from > removed ? transition.from - 1 : transition.from,
					to: transition.to > removed ? transition.to - 1 : transition.to
				}));
			next.initial = Math.min(next.initial, next.states.length - 1);
		} else if (kind === 2) {
			next.states[hash(opSeed, 15) % next.states.length] = mutateState(
				next.states[hash(opSeed, 15) % next.states.length],
				opSeed
			);
		} else if (kind === 3 && next.transitions.length > 0) {
			next.transitions.splice(hash(opSeed, 16) % next.transitions.length, 1);
		} else if (kind <= 6) {
			const from = hash(opSeed, 17) % next.states.length;
			const to = hash(opSeed, 18) % next.states.length;
			if (from !== to) {
				next.transitions.push({
					from,
					to,
					when: randomCondition(opSeed),
					chance: 35 + (hash(opSeed, 19) % 66)
				});
			}
		} else {
			const index = hash(opSeed, 20) % next.states.length;
			next.states[index] = {
				option: randomOption(opSeed + 5),
				dwell: 35 + (hash(opSeed, 21) % 56),
				bias: randomBias(opSeed + 7)
			};
		}
	}
	return normalizeMarkov(next, seed) as MarkovController;
}

/**
 * Recombines controllers by primary graph plus labeled-state alignment, then
 * mutations. State labels are option names, not raw indexes, so crossing two
 * graphs does not splice unrelated roles together.
 */
export function crossoverMarkov(
	first: MarkovController,
	second: MarkovController,
	seed: number
): MarkovController {
	const primary = hash(seed, 1) % 2 === 0 ? cloneMarkov(first) : cloneMarkov(second);
	const donor = hash(seed, 1) % 2 === 0 ? second : first;
	for (let index = 0; index < primary.states.length; index++) {
		const state = primary.states[index];
		const match = donor.states.findIndex((entry) => entry.option === state.option);
		if (match >= 0 && hash(seed, 100 + index) % 2 === 0) {
			state.bias = { ...donor.states[match].bias };
			state.dwell = donor.states[match].dwell;
		}
		// Copy a matching-donor transition if both endpoints have labeled
		// counterparts in the primary graph.
		for (const transition of donor.transitions) {
			const fromOption = donor.states[transition.from]?.option;
			const toOption = donor.states[transition.to]?.option;
			const from = primary.states.findIndex((entry) => entry.option === fromOption);
			const to = primary.states.findIndex((entry) => entry.option === toOption);
			if (
				from >= 0 &&
				to >= 0 &&
				hash(seed, 300 + transition.from * 17 + transition.to) % 3 === 0
			) {
				primary.transitions.push({
					from,
					to,
					when: transition.when,
					chance: transition.chance
				});
			}
		}
	}
	return normalizeMarkov(mutateMarkov(primary, seed ^ 0x27d4eb2d), seed) as MarkovController;
}
