/**
 * Deterministic bot personality construction.
 *
 * Profiles are derived only from `hash32(seed, playerId, salt)` and the optional
 * evolved genome; the shared simulation PRNG is never touched here. Runtime
 * strategy state (threat, reserves, options) stays in the simulation.
 */

import { BOT_DECISION_INTERVAL } from '../constants';
import type { BuildableStructureType } from '../structures';
import { BUILDABLE_STRUCTURE_TYPES } from '../structures';
import { hash32 } from '../map';
import { BOT_MODULE_IDS, type BotGenome, type BotModules } from '../ai/genome';
import type { MarkovController } from '../ai/markov';

export interface BotProfile {
	aggression: number;
	economy: number;
	fortification: number;
	command: number;
	vengeful: number;
	cautious: number;
	conciliatory: number;
	opportunist: number;
	focus: BuildableStructureType;
	buildPlan: BuildableStructureType[];
	/** Persistent per-type affinity; dynamic utility layers situational value on top. */
	structureBias: Record<BuildableStructureType, number>;
	/** Evolvable behaviour-module weights, neutral at 50. */
	modules: BotModules;
	genomeId: string | null;
	markov: MarkovController | null;
}

export const DEFAULT_BOT_MODULES: BotModules = {
	income: 50,
	defense: 50,
	deterrence: 50,
	opportunity: 50,
	expansion: 50,
	retaliation: 50
};

/** Highest affinity first; ties rank by structure-type name for stability. */
export function rankBuildPlan(
	structureBias: Record<BuildableStructureType, number>
): BuildableStructureType[] {
	const preferred = BUILDABLE_STRUCTURE_TYPES.map((type) => [type, structureBias[type]] as const);
	preferred.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
	return preferred.map((entry) => entry[0]);
}

export function createBotProfile(playerId: number, seed: number): BotProfile {
	const aggression = hash32(playerId, 1, seed ^ 0x1b56c4e9) % 101;
	const economy = hash32(playerId, 2, seed ^ 0x7f4a7c15) % 101;
	const fortification = hash32(playerId, 3, seed ^ 0x9e3779b9) % 101;
	const command = hash32(playerId, 4, seed ^ 0x85ebca6b) % 101;
	const vengeful = hash32(playerId, 6, seed ^ 0xd3a2646c) % 101;
	const cautious = hash32(playerId, 7, seed ^ 0xfd7046c5) % 101;
	const conciliatory = hash32(playerId, 8, seed ^ 0xb55a4f09) % 101;
	const opportunist = hash32(playerId, 9, seed ^ 0x165667b1) % 101;

	const structureBias: Record<BuildableStructureType, number> = {
		artillery:
			15 +
			Math.floor(economy * 0.35) +
			Math.floor(aggression * 0.55) +
			(hash32(playerId, 10, seed) % 20),
		barracks:
			12 +
			Math.floor(aggression * 0.7) +
			Math.floor(cautious * 0.15) +
			(hash32(playerId, 11, seed) % 20),
		fortification:
			10 +
			Math.floor(fortification * 0.8) +
			Math.floor((100 - aggression) * 0.1) +
			(hash32(playerId, 12, seed) % 20),
		jammer: 8 + Math.floor((fortification + command) * 0.4) + (hash32(playerId, 15, seed) % 20),
		'command-post':
			10 +
			Math.floor(economy * 0.65) +
			Math.floor(command * 0.2) +
			(hash32(playerId, 13, seed) % 20),
		'war-academy':
			5 +
			Math.floor(command * 0.55) +
			Math.floor(economy * 0.35) +
			(hash32(playerId, 14, seed) % 20),
		port:
			4 +
			Math.floor(aggression * 0.2) +
			Math.floor(command * 0.2) +
			(hash32(playerId, 16, seed) % 16)
	};
	const buildPlan = rankBuildPlan(structureBias);
	return {
		aggression,
		economy,
		fortification,
		command,
		vengeful,
		cautious,
		conciliatory,
		opportunist,
		focus: buildPlan[0],
		buildPlan,
		structureBias,
		modules: { ...DEFAULT_BOT_MODULES },
		genomeId: null,
		markov: null
	};
}

export function createProfileFromGenome(genome: BotGenome): BotProfile {
	const structureBias = {} as Record<BuildableStructureType, number>;
	for (const type of BUILDABLE_STRUCTURE_TYPES) structureBias[type] = genome.structureBias[type];
	const buildPlan = rankBuildPlan(structureBias);
	const modules = {} as BotModules;
	for (const id of BOT_MODULE_IDS) modules[id] = genome.modules[id];
	return {
		aggression: genome.aggression,
		economy: genome.economy,
		fortification: genome.fortification,
		command: genome.command,
		vengeful: genome.vengeful,
		cautious: genome.cautious,
		conciliatory: genome.conciliatory,
		opportunist: genome.opportunist,
		focus: buildPlan[0],
		buildPlan,
		structureBias,
		modules,
		genomeId: genome.id,
		markov: genome.markov
	};
}

/** Staggered per-bot decision cadence. */
export function botDecisionDue(tick: number, playerId: number): boolean {
	return (tick + playerId - 1) % BOT_DECISION_INTERVAL === 0;
}
