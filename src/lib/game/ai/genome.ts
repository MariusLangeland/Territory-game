import { hash32 } from '../map';
import { BUILDABLE_STRUCTURE_TYPES, type BuildableStructureType } from '../structures';
import {
	cloneMarkov,
	crossoverMarkov,
	createRandomMarkov,
	mutateMarkov,
	type MarkovController
} from './markov';

export const BOT_GENOME_VERSION = 2;

export const BOT_MODULE_IDS = [
	'income',
	'defense',
	'deterrence',
	'opportunity',
	'expansion',
	'retaliation'
] as const;

export type BotModuleId = (typeof BOT_MODULE_IDS)[number];
export type BotModules = Record<BotModuleId, number>;

export interface BotGenome {
	version: number;
	id: string;
	generation: number;
	parents: string[];
	aggression: number;
	economy: number;
	fortification: number;
	command: number;
	vengeful: number;
	cautious: number;
	conciliatory: number;
	opportunist: number;
	modules: BotModules;
	structureBias: Record<BuildableStructureType, number>;
	/** Optional qualitative semi-Markov strategic controller (genome v2). */
	markov: MarkovController | null;
}

export const BOT_MODULE_LABELS: Record<BotModuleId, string> = {
	income: 'Income growth',
	defense: 'Fortification',
	deterrence: 'Deterrence',
	opportunity: 'Opportunity attacks',
	expansion: 'Neutral expansion',
	retaliation: 'Retaliation'
};

export function clampTrait(value: number): number {
	return Math.max(0, Math.min(100, Math.round(value)));
}

export function clampModule(value: number): number {
	return Math.max(0, Math.min(100, Math.round(value)));
}

/** Stable 32-bit PRNG value for a genome field. */
function genomeHash(seed: number, salt: number): number {
	return hash32(seed >>> 0, salt >>> 0, 0x9e3779b9);
}

function randomTrait(seed: number, salt: number): number {
	return 8 + (genomeHash(seed, salt) % 85);
}

function randomModules(seed: number): BotModules {
	const modules = {} as BotModules;
	for (let index = 0; index < BOT_MODULE_IDS.length; index++) {
		const id = BOT_MODULE_IDS[index];
		modules[id] = 15 + (genomeHash(seed, 100 + index) % 86);
	}
	return modules;
}

function randomStructureBias(seed: number): Record<BuildableStructureType, number> {
	const bias = {} as Record<BuildableStructureType, number>;
	for (let index = 0; index < BUILDABLE_STRUCTURE_TYPES.length; index++) {
		const type = BUILDABLE_STRUCTURE_TYPES[index];
		bias[type] = 6 + (genomeHash(seed, 200 + index) % 30);
	}
	return bias;
}

export function createRandomGenome(seed: number, generation = 0): BotGenome {
	const normalized = seed >>> 0;
	return {
		version: BOT_GENOME_VERSION,
		id: genomeId(normalized, generation),
		generation,
		parents: [],
		aggression: randomTrait(normalized, 1),
		economy: randomTrait(normalized, 2),
		fortification: randomTrait(normalized, 3),
		command: randomTrait(normalized, 4),
		vengeful: randomTrait(normalized, 5),
		cautious: randomTrait(normalized, 6),
		conciliatory: randomTrait(normalized, 7),
		opportunist: randomTrait(normalized, 8),
		modules: randomModules(normalized),
		structureBias: randomStructureBias(normalized),
		markov: createRandomMarkov(normalized ^ 0x165667b1)
	};
}

export function genomeId(seed: number, generation: number): string {
	return `g${generation}-${(seed >>> 0).toString(36)}`;
}

function mutateTrait(value: number, seed: number, salt: number): number {
	if (genomeHash(seed, salt) % 9 === 0) {
		return clampTrait(value + 15 + (genomeHash(seed, salt + 1) % 16));
	}
	return clampTrait(value + (genomeHash(seed, salt) % 13) - 6);
}

function mutateModule(value: number, seed: number, salt: number): number {
	if (genomeHash(seed, salt) % 11 === 0) {
		return clampModule(value + 25 + (genomeHash(seed, salt + 1) % 26));
	}
	return clampModule(value + (genomeHash(seed, salt) % 19) - 9);
}

/**
 * Sexless mutation for elite retention; offspring normally use crossover first.
 * A module can be swapped wholesale so behaviour presets stay mixable.
 */
export function mutateGenome(parent: BotGenome, seed: number, generation: number): BotGenome {
	const normalized = seed >>> 0;
	const modules = {} as BotModules;
	for (let index = 0; index < BOT_MODULE_IDS.length; index++) {
		const id = BOT_MODULE_IDS[index];
		modules[id] = mutateModule(parent.modules[id], normalized, 300 + index);
	}
	const bias = {} as Record<BuildableStructureType, number>;
	for (let index = 0; index < BUILDABLE_STRUCTURE_TYPES.length; index++) {
		const type = BUILDABLE_STRUCTURE_TYPES[index];
		bias[type] = clampTrait(
			parent.structureBias[type] + (genomeHash(normalized, 400 + index) % 21) - 10
		);
	}
	return {
		version: BOT_GENOME_VERSION,
		id: genomeId(normalized, generation),
		generation,
		parents: [parent.id],
		aggression: mutateTrait(parent.aggression, normalized, 1),
		economy: mutateTrait(parent.economy, normalized, 2),
		fortification: mutateTrait(parent.fortification, normalized, 3),
		command: mutateTrait(parent.command, normalized, 4),
		vengeful: mutateTrait(parent.vengeful, normalized, 5),
		cautious: mutateTrait(parent.cautious, normalized, 6),
		conciliatory: mutateTrait(parent.conciliatory, normalized, 7),
		opportunist: mutateTrait(parent.opportunist, normalized, 8),
		modules,
		structureBias: bias,
		markov: parent.markov ? mutateMarkov(parent.markov, normalized ^ 0x85ebca6b) : null
	};
}

export function crossoverGenomes(
	first: BotGenome,
	second: BotGenome,
	seed: number,
	generation: number
): BotGenome {
	const normalized = seed >>> 0;
	const pick = (salt: number): boolean => genomeHash(normalized, salt) % 2 === 0;
	const modules = {} as BotModules;
	for (let index = 0; index < BOT_MODULE_IDS.length; index++) {
		const id = BOT_MODULE_IDS[index];
		modules[id] = pick(500 + index) ? first.modules[id] : second.modules[id];
	}
	const bias = {} as Record<BuildableStructureType, number>;
	for (let index = 0; index < BUILDABLE_STRUCTURE_TYPES.length; index++) {
		const type = BUILDABLE_STRUCTURE_TYPES[index];
		bias[type] = pick(600 + index) ? first.structureBias[type] : second.structureBias[type];
	}
	const child: BotGenome = {
		version: BOT_GENOME_VERSION,
		id: genomeId(normalized, generation),
		generation,
		parents: [first.id, second.id],
		aggression: pick(1) ? first.aggression : second.aggression,
		economy: pick(2) ? first.economy : second.economy,
		fortification: pick(3) ? first.fortification : second.fortification,
		command: pick(4) ? first.command : second.command,
		vengeful: pick(5) ? first.vengeful : second.vengeful,
		cautious: pick(6) ? first.cautious : second.cautious,
		conciliatory: pick(7) ? first.conciliatory : second.conciliatory,
		opportunist: pick(8) ? first.opportunist : second.opportunist,
		modules,
		structureBias: bias,
		markov:
			first.markov && second.markov
				? crossoverMarkov(first.markov, second.markov, normalized ^ 0x9e3779b9)
				: first.markov
					? cloneMarkov(first.markov)
					: second.markov
						? cloneMarkov(second.markov)
						: null
	};
	const mutated = mutateGenome(child, normalized ^ 0x27d4eb2d, generation);
	mutated.parents = [first.id, second.id];
	return mutated;
}

export function cloneGenome(genome: BotGenome): BotGenome {
	return {
		...genome,
		parents: [...genome.parents],
		modules: { ...genome.modules },
		structureBias: { ...genome.structureBias },
		markov: genome.markov ? cloneMarkov(genome.markov) : null
	};
}

/**
 * Module weights are expressed around 50 = neutral. Default bots use 50 for
 * every module, so the pre-evolution behavior is preserved exactly.
 */
export function moduleScale(weight: number | undefined): number {
	const safe = weight === undefined ? 50 : Math.max(0, Math.min(100, weight));
	return safe / 50;
}

export function scaledBonus(bonus: number, weight: number | undefined): number {
	return Math.floor(bonus * moduleScale(weight));
}
