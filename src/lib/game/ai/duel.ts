import { hash32 } from '../map';
import { TerritorySimulation, type GameSnapshot, type PublicPlayer } from '../simulation';
import {
	DEFAULT_FITNESS_WEIGHTS,
	genomeFitness,
	normalizeFitnessWeights,
	type FitnessWeights
} from './evolution';
import { createRandomGenome, mutateGenome, type BotGenome } from './genome';

export interface DuelConfig {
	seed: number;
	rounds: number;
	roundsPerMutation: number;
	ticks: number;
	width: number;
	height: number;
	names: [string, string];
	fitnessWeights: FitnessWeights;
}

export const DEFAULT_DUEL_CONFIG: DuelConfig = {
	seed: 1234,
	rounds: 12,
	roundsPerMutation: 3,
	ticks: 1600,
	width: 1280,
	height: 720,
	names: ['ALPHA', 'BETA'],
	fitnessWeights: DEFAULT_FITNESS_WEIGHTS
};

export interface DuelNode {
	id: string;
	characterIndex: 0 | 1;
	label: string;
	version: number;
	generation: number;
	parentId: string | null;
	createdRound: number;
	genome: BotGenome;
}

export interface DuelCharacter {
	index: 0 | 1;
	name: string;
	currentNodeId: string;
	wins: number;
	losses: number;
	matches: number;
	mutations: number;
	totalFitness: number;
	blockFitness: number;
	blockWins: number;
	blockRounds: number;
}

export interface DuelRoundResult {
	round: number;
	seed: number;
	nodeIds: [string, string];
	characters: [0 | 1, 0 | 1];
	winner: 0 | 1;
	fitness: [number, number];
	checksum: number;
}

export interface MutationEvent {
	round: number;
	characterIndex: 0 | 1;
	fromNodeId: string;
	toNodeId: string;
}

export type DuelPhase = 'idle' | 'match' | 'round-complete' | 'finished';

export function normalizeDuelConfig(config: Partial<DuelConfig> = {}): DuelConfig {
	const merged = { ...DEFAULT_DUEL_CONFIG, ...config };
	const cleanName = (value: string, fallback: string): string => {
		const trimmed = value.trim().slice(0, 16);
		return trimmed.length > 0 ? trimmed : fallback;
	};
	return {
		seed: merged.seed >>> 0,
		rounds: Math.max(2, Math.min(200, Math.trunc(merged.rounds))),
		roundsPerMutation: Math.max(1, Math.min(20, Math.trunc(merged.roundsPerMutation))),
		ticks: Math.max(200, Math.min(30_000, Math.trunc(merged.ticks))),
		width: Math.max(512, Math.trunc(merged.width)),
		height: Math.max(256, Math.trunc(merged.height)),
		names: [cleanName(merged.names[0], 'ALPHA'), cleanName(merged.names[1], 'BETA')],
		fitnessWeights: normalizeFitnessWeights(merged.fitnessWeights)
	};
}

function seatFitness(
	simulation: TerritorySimulation,
	snapshot: GameSnapshot,
	player: PublicPlayer,
	weights: FitnessWeights
): number {
	const playerId = player.id;
	const attackStrength = snapshot.attacks
		.filter((attack) => attack.attackerId === playerId)
		.reduce((total, attack) => total + attack.strength, 0);
	const owned = snapshot.structures.filter((structure) => structure.ownerId === playerId);
	const behavior = simulation.getPlayerBehaviorMetrics(playerId);
	const economy = owned
		.filter((structure) => structure.type === 'command-post' || structure.type === 'war-academy')
		.reduce((total, structure) => total + structure.stacks, 0);
	const defense = owned
		.filter((structure) => structure.type === 'fortification')
		.reduce((total, structure) => total + structure.stacks, 0);
	const naval =
		owned.filter((structure) => structure.type === 'port').length + behavior.navalLandings * 2;
	return genomeFitness(
		player,
		simulation.incomeOf(playerId),
		attackStrength,
		snapshot.winnerId === playerId,
		{
			economy,
			defense,
			naval,
			aggression: behavior.attacksLaunched,
			cooperation: behavior.supportedAttacks
		},
		weights
	);
}

/**
 * Explicit 1v1 mode. Two named characters persist for the whole run; no genome
 * is culled. After every `roundsPerMutation` rounds the character with the lower
 * block fitness must mutate and continue from its descendant.
 */
export class DuelLab {
	readonly config: DuelConfig;
	readonly characters: [DuelCharacter, DuelCharacter];
	readonly nodes: DuelNode[] = [];
	readonly rounds: DuelRoundResult[] = [];
	readonly mutations: MutationEvent[] = [];

	phase: DuelPhase = 'idle';
	currentSimulation: TerritorySimulation | null = null;
	currentRoundIndex = 0;
	currentCharacters: [0 | 1, 0 | 1] = [0, 1];
	currentNodeIds: [string, string] = ['', ''];
	currentMatchSeed = 0;

	constructor(config: Partial<DuelConfig> = {}) {
		this.config = normalizeDuelConfig(config);
		const alphaGenome = createRandomGenome(hash32(this.config.seed, 0, 0x27d4eb2d), 0);
		const betaGenome = createRandomGenome(hash32(this.config.seed, 1, 0x165667b1), 0);
		const alpha = this.addNode(0, alphaGenome, null, 0);
		const beta = this.addNode(1, betaGenome, null, 0);
		this.characters = [this.createCharacter(0, alpha), this.createCharacter(1, beta)];
	}

	private createCharacter(index: 0 | 1, node: DuelNode): DuelCharacter {
		return {
			index,
			name: this.config.names[index],
			currentNodeId: node.id,
			wins: 0,
			losses: 0,
			matches: 0,
			mutations: 0,
			totalFitness: 0,
			blockFitness: 0,
			blockWins: 0,
			blockRounds: 0
		};
	}

	private addNode(
		characterIndex: 0 | 1,
		genome: BotGenome,
		parentId: string | null,
		createdRound: number
	): DuelNode {
		const version = this.nodes.filter((node) => node.characterIndex === characterIndex).length + 1;
		const node: DuelNode = {
			id: genome.id,
			characterIndex,
			label: `${this.config.names[characterIndex]} v${version}`,
			version,
			generation: genome.generation,
			parentId,
			createdRound,
			genome
		};
		this.nodes.push(node);
		return node;
	}

	get currentNode(): [DuelNode, DuelNode] {
		const alpha = this.nodes.find((node) => node.id === this.characters[0].currentNodeId);
		const beta = this.nodes.find((node) => node.id === this.characters[1].currentNodeId);
		if (!alpha || !beta) throw new Error('Duel character node missing.');
		return [alpha, beta];
	}

	get progress(): { round: number; rounds: number; block: number; blockSize: number } {
		return {
			round: this.rounds.length,
			rounds: this.config.rounds,
			block: this.characters[0].blockRounds,
			blockSize: this.config.roundsPerMutation
		};
	}

	begin(): void {
		if (this.phase !== 'idle') return;
		this.phase = 'match';
		this.startRound(0);
	}

	step(maxSteps = 1): boolean {
		if (!this.currentSimulation) return false;
		let steps = 0;
		while (steps < maxSteps && !this.currentSimulation.ended) {
			this.currentSimulation.step();
			steps++;
		}
		return this.currentSimulation.ended;
	}

	private startRound(roundIndex: number): void {
		const [alpha, beta] = this.currentNode;
		// Alternate seats so spawn/seat advantage is split across rounds.
		const alphaSeat = roundIndex % 2;
		const betaSeat = 1 - alphaSeat;
		this.currentCharacters = alphaSeat === 0 ? [0, 1] : [1, 0];
		this.currentNodeIds = alphaSeat === 0 ? [alpha.id, beta.id] : [beta.id, alpha.id];
		this.currentMatchSeed = hash32(hash32(this.config.seed, roundIndex, 0x9e3779b9), 0x51ed270b, 0);
		this.currentSimulation = new TerritorySimulation({
			seed: this.currentMatchSeed,
			width: this.config.width,
			height: this.config.height,
			playerCount: 2,
			allPlayersBots: true,
			duelStarts: true,
			matchDurationTicks: this.config.ticks,
			botGenomes: alphaSeat === 0 ? [alpha.genome, beta.genome] : [beta.genome, alpha.genome]
		});
	}

	finishRound(): DuelRoundResult | null {
		if (!this.currentSimulation) return null;
		const simulation = this.currentSimulation;
		const snapshot = simulation.getSnapshot();
		const seatNodes = this.currentNodeIds;
		const seatFitnesses: [number, number] = [0, 0];
		for (let seat = 0; seat < 2; seat++) {
			const player = snapshot.players.find((entry) => entry.id === seat + 1);
			if (player) {
				seatFitnesses[seat] = seatFitness(simulation, snapshot, player, this.config.fitnessWeights);
			}
		}
		const characterFitness: [number, number] = [0, 0];
		for (let seat = 0; seat < 2; seat++) {
			characterFitness[this.currentCharacters[seat]] = seatFitnesses[seat];
		}
		let winner: 0 | 1;
		if (snapshot.winnerId === 1) winner = this.currentCharacters[0];
		else if (snapshot.winnerId === 2) winner = this.currentCharacters[1];
		else winner = characterFitness[0] >= characterFitness[1] ? 0 : 1;

		const result: DuelRoundResult = {
			round: this.currentRoundIndex,
			seed: this.currentMatchSeed,
			nodeIds: seatNodes,
			characters: [...this.currentCharacters],
			winner,
			fitness: characterFitness,
			checksum: simulation.checksum()
		};
		this.rounds.push(result);
		for (const character of this.characters) {
			const fitness = characterFitness[character.index];
			character.matches++;
			character.totalFitness += fitness;
			character.blockFitness += fitness;
			character.blockRounds++;
			if (character.index === winner) {
				character.wins++;
				character.blockWins++;
			} else {
				character.losses++;
			}
		}

		this.currentSimulation = null;
		this.currentRoundIndex = this.rounds.length;
		if (this.rounds.length % this.config.roundsPerMutation === 0) {
			this.mutateLeastFit();
		}
		if (this.rounds.length >= this.config.rounds) {
			this.phase = 'finished';
			return result;
		}
		this.phase = 'round-complete';
		return result;
	}

	nextRound(): boolean {
		if (this.phase !== 'round-complete') return false;
		this.phase = 'match';
		this.startRound(this.currentRoundIndex);
		return this.currentSimulation !== null;
	}

	private mutateLeastFit(): void {
		const alpha = this.characters[0];
		const beta = this.characters[1];
		let weakest: DuelCharacter;
		if (alpha.blockFitness !== beta.blockFitness) {
			weakest = alpha.blockFitness < beta.blockFitness ? alpha : beta;
		} else if (alpha.blockWins !== beta.blockWins) {
			weakest = alpha.blockWins < beta.blockWins ? alpha : beta;
		} else {
			const alphaAverage = alpha.totalFitness / Math.max(1, alpha.matches);
			const betaAverage = beta.totalFitness / Math.max(1, beta.matches);
			weakest = alphaAverage <= betaAverage ? alpha : beta;
		}
		const parent = this.nodes.find((node) => node.id === weakest.currentNodeId);
		if (!parent) return;
		const mutationSeed = hash32(
			hash32(this.config.seed, weakest.mutations + 1, 0x85ebca6b),
			weakest.index,
			this.rounds.length
		);
		const childGenome = mutateGenome(parent.genome, mutationSeed, parent.generation + 1);
		const node = this.addNode(weakest.index, childGenome, parent.id, this.rounds.length);
		weakest.currentNodeId = node.id;
		weakest.mutations++;
		this.mutations.push({
			round: this.rounds.length,
			characterIndex: weakest.index,
			fromNodeId: parent.id,
			toNodeId: node.id
		});
		for (const character of this.characters) {
			character.blockFitness = 0;
			character.blockWins = 0;
			character.blockRounds = 0;
		}
	}
}
