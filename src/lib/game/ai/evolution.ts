import { hash32 } from '../map';
import { TerritorySimulation, type GameSnapshot, type PublicPlayer } from '../simulation';
import {
	createRandomGenome,
	crossoverGenomes,
	cloneGenome,
	mutateGenome,
	type BotGenome
} from './genome';

export type BotBucket = 'poor' | 'good' | 'top';
export const BOT_BUCKETS: readonly BotBucket[] = ['poor', 'good', 'top'];

export interface EvolutionConfig {
	seed: number;
	populationSize: number;
	generations: number;
	playerCount: number;
	matchesPerRound: number;
	ticks: number;
	width: number;
	height: number;
}

export const DEFAULT_EVOLUTION_CONFIG: EvolutionConfig = {
	seed: 1234,
	populationSize: 16,
	generations: 4,
	playerCount: 8,
	matchesPerRound: 2,
	ticks: 1600,
	width: 1280,
	height: 720
};

export interface GenomePerformance {
	genome: BotGenome;
	bucket: BotBucket;
	matches: number;
	wins: number;
	landShare: number;
	income: number;
	attackStrength: number;
	fitness: number;
}

export interface GenerationResult {
	generation: number;
	rows: GenomePerformance[];
	buckets: Record<BotBucket, string[]>;
}

export interface EvolutionReport {
	config: EvolutionConfig;
	generations: GenerationResult[];
	final: GenerationResult;
}

interface Evaluation {
	genome: BotGenome;
	matches: number;
	wins: number;
	landShare: number;
	income: number;
	attackStrength: number;
	fitness: number;
}

export function normalizeEvolutionConfig(config: Partial<EvolutionConfig> = {}): EvolutionConfig {
	const merged = { ...DEFAULT_EVOLUTION_CONFIG, ...config };
	const playerCount = Math.max(2, Math.min(51, Math.trunc(merged.playerCount)));
	return {
		seed: merged.seed >>> 0,
		populationSize: Math.max(playerCount, Math.min(64, Math.trunc(merged.populationSize))),
		generations: Math.max(1, Math.min(50, Math.trunc(merged.generations))),
		playerCount,
		matchesPerRound: Math.max(1, Math.min(8, Math.trunc(merged.matchesPerRound))),
		ticks: Math.max(200, Math.min(30_000, Math.trunc(merged.ticks))),
		width: Math.max(512, Math.trunc(merged.width)),
		height: Math.max(256, Math.trunc(merged.height))
	};
}

export function createInitialPopulation(config: EvolutionConfig): BotGenome[] {
	return Array.from({ length: config.populationSize }, (_, index) =>
		createRandomGenome(hash32(config.seed, index, 0x165667b1), 0)
	);
}

/**
 * Final fitness is deliberately multi-objective: land is the primary score,
 * but income, durable attack strength, and winning all matter.
 */
export function genomeFitness(
	player: PublicPlayer,
	income: number,
	attackStrength: number,
	won: boolean
): number {
	return Math.round(
		player.landShare * 120_000 +
			income * 120 +
			attackStrength * 0.3 +
			(won ? 75_000 : 0) +
			(player.alive ? 1_000 : 0)
	);
}

function scoreMatch(
	simulation: TerritorySimulation,
	snapshot: GameSnapshot,
	seats: readonly BotGenome[]
): Map<string, Evaluation> {
	const scored = new Map<string, Evaluation>();
	for (let seat = 0; seat < seats.length; seat++) {
		const genome = seats[seat];
		const playerId = seat + 1;
		const player = snapshot.players.find((entry) => entry.id === playerId);
		if (!player) continue;
		const attackStrength = snapshot.attacks
			.filter((attack) => attack.attackerId === playerId)
			.reduce((total, attack) => total + attack.strength, 0);
		const fitness = genomeFitness(
			player,
			simulation.incomeOf(playerId),
			attackStrength,
			snapshot.winnerId === playerId
		);
		scored.set(genome.id, {
			genome,
			matches: 1,
			wins: snapshot.winnerId === playerId ? 1 : 0,
			landShare: player.landShare,
			income: simulation.incomeOf(playerId),
			attackStrength,
			fitness
		});
	}
	return scored;
}

function aggregateEvaluations(evaluations: Map<string, Evaluation>): GenomePerformance[] {
	const rows = Array.from(evaluations.values()).map<GenomePerformance>((evaluation) => ({
		genome: evaluation.genome,
		bucket: 'poor',
		matches: evaluation.matches,
		wins: evaluation.wins,
		landShare: evaluation.matches ? evaluation.landShare / evaluation.matches : 0,
		income: evaluation.matches ? evaluation.income / evaluation.matches : 0,
		attackStrength: evaluation.matches ? evaluation.attackStrength / evaluation.matches : 0,
		fitness: evaluation.matches
			? Math.round((evaluation.fitness / evaluation.matches) * 100) / 100
			: 0
	}));
	rows.sort((a, b) => b.fitness - a.fitness || a.genome.id.localeCompare(b.genome.id));
	return rows;
}

export function bucketRows(rows: GenomePerformance[]): Record<BotBucket, string[]> {
	const topCount = Math.max(1, Math.ceil(rows.length * 0.2));
	const goodCount = Math.max(1, Math.ceil(rows.length * 0.3));
	const buckets: Record<BotBucket, string[]> = { poor: [], good: [], top: [] };
	for (let index = 0; index < rows.length; index++) {
		const bucket: BotBucket =
			index < topCount ? 'top' : index < topCount + goodCount ? 'good' : 'poor';
		rows[index].bucket = bucket;
		buckets[bucket].push(rows[index].genome.id);
	}
	return buckets;
}

function nextPopulation(
	rows: GenomePerformance[],
	config: EvolutionConfig,
	generation: number
): BotGenome[] {
	const survivorCount = Math.max(2, Math.ceil(rows.length * 0.5));
	const survivors = rows.slice(0, survivorCount).map((row) => row.genome);
	const eliteCount = Math.max(1, Math.ceil(rows.length * 0.2));
	const next: BotGenome[] = survivors.slice(0, eliteCount).map((genome) => cloneGenome(genome));
	while (next.length < config.populationSize) {
		const seed = hash32(hash32(config.seed, generation, next.length), 0x27d4eb2d, 0);
		const first = survivors[seed % survivors.length];
		const second = survivors[hash32(seed, 1, generation) % survivors.length];
		next.push(
			next.length % 3 === 0
				? mutateGenome(first, seed, generation)
				: crossoverGenomes(first, second, seed, generation)
		);
	}
	return next;
}

export class EvolutionSandbox {
	readonly config: EvolutionConfig;
	population: BotGenome[];
	generation = 0;
	phase: 'idle' | 'match' | 'generation-complete' | 'finished' = 'idle';
	currentSimulation: TerritorySimulation | null = null;
	currentSeats: BotGenome[] = [];
	currentMatchIndex = 0;
	currentMatchSeed = 0;
	reports: GenerationResult[] = [];
	private schedule: BotGenome[][] = [];
	private evaluations = new Map<string, Evaluation>();
	private pendingPopulation: BotGenome[] = [];

	constructor(config: Partial<EvolutionConfig> = {}) {
		this.config = normalizeEvolutionConfig(config);
		this.population = createInitialPopulation(this.config);
	}

	get latestRows(): GenomePerformance[] {
		return this.reports.length > 0 ? this.reports[this.reports.length - 1].rows : [];
	}

	get progress(): { match: number; matches: number; generation: number } {
		return {
			match: this.currentMatchIndex + 1,
			matches: this.schedule.length,
			generation: this.generation + 1
		};
	}

	begin(): void {
		if (this.phase !== 'idle') return;
		this.generation = 0;
		this.startGeneration();
	}

	/** Replace the population, for spreadsheet imports and bucket mixes. */
	setPopulation(genomes: BotGenome[], restart = true): boolean {
		if (genomes.length < this.config.playerCount) return false;
		const pool = genomes.slice(0, 64).map((genome) => cloneGenome(genome));
		while (pool.length < this.config.populationSize) {
			pool.push(cloneGenome(pool[pool.length % genomes.length]));
		}
		this.population = pool.slice(0, this.config.populationSize);
		this.reports = [];
		this.generation = 0;
		this.currentSimulation = null;
		this.phase = 'idle';
		if (restart) this.startGeneration();
		return true;
	}

	startNextMatch(): boolean {
		if (this.phase !== 'match' || this.currentSimulation) return false;
		if (this.currentMatchIndex >= this.schedule.length) return false;
		const seats = this.schedule[this.currentMatchIndex];
		const seed = hash32(
			hash32(this.config.seed, this.generation, this.currentMatchIndex),
			0x51ed270b,
			0
		);
		this.currentMatchSeed = seed;
		this.currentSeats = seats;
		this.currentSimulation = new TerritorySimulation({
			seed,
			width: this.config.width,
			height: this.config.height,
			playerCount: this.config.playerCount,
			allPlayersBots: true,
			botGenomes: seats,
			matchDurationTicks: this.config.ticks
		});
		return true;
	}

	/** Advance the current match. Returns true when the match is complete. */
	step(ticks = 1): boolean {
		if (!this.currentSimulation && !this.startNextMatch()) return true;
		const simulation = this.currentSimulation;
		if (!simulation) return true;
		for (let index = 0; index < ticks && !simulation.ended; index++) {
			simulation.step();
			if (simulation.tick >= this.config.ticks) break;
		}
		return simulation.ended || simulation.tick >= this.config.ticks;
	}

	finishMatch(): void {
		const simulation = this.currentSimulation;
		if (!simulation) return;
		const snapshot = simulation.getSnapshot();
		const scored = scoreMatch(simulation, snapshot, this.currentSeats);
		for (const [id, value] of scored) {
			const existing = this.evaluations.get(id);
			if (!existing) {
				this.evaluations.set(id, value);
			} else {
				existing.matches += 1;
				existing.wins += value.wins;
				existing.landShare += value.landShare;
				existing.income += value.income;
				existing.attackStrength += value.attackStrength;
				existing.fitness += value.fitness;
			}
		}
		this.currentSimulation = null;
		this.currentSeats = [];
		this.currentMatchIndex++;
		if (this.currentMatchIndex >= this.schedule.length) this.completeGeneration();
	}

	nextMatch(): boolean {
		if (this.currentSimulation) return false;
		if (this.phase === 'generation-complete') {
			this.nextGeneration();
			return this.currentSimulation !== null;
		}
		if (this.phase === 'match') return this.startNextMatch();
		return false;
	}

	private startGeneration(): void {
		this.phase = 'match';
		this.currentMatchIndex = 0;
		this.currentSimulation = null;
		this.currentSeats = [];
		this.evaluations = new Map();
		this.schedule = this.buildSchedule();
		for (const genome of this.population) {
			this.evaluations.set(genome.id, {
				genome,
				matches: 0,
				wins: 0,
				landShare: 0,
				income: 0,
				attackStrength: 0,
				fitness: 0
			});
		}
		this.startNextMatch();
	}

	private buildSchedule(): BotGenome[][] {
		const rounds = Math.ceil(this.population.length / this.config.playerCount);
		const schedule: BotGenome[][] = [];
		for (let round = 0; round < rounds * this.config.matchesPerRound; round++) {
			const offset =
				(round * this.config.playerCount +
					(hash32(hash32(this.config.seed, this.generation, round), 0x9e3779b9, 0) %
						this.population.length)) %
				this.population.length;
			const seats: BotGenome[] = [];
			for (let seat = 0; seat < this.config.playerCount; seat++) {
				seats.push(this.population[(offset + seat) % this.population.length]);
			}
			schedule.push(seats);
		}
		return schedule;
	}

	private completeGeneration(): void {
		const rows = aggregateEvaluations(this.evaluations);
		const buckets = bucketRows(rows);
		this.reports.push({ generation: this.generation, rows, buckets });
		if (this.generation + 1 >= this.config.generations) {
			this.phase = 'finished';
			this.pendingPopulation = [];
			return;
		}
		this.pendingPopulation = nextPopulation(rows, this.config, this.generation + 1);
		this.phase = 'generation-complete';
	}

	nextGeneration(): void {
		if (this.phase !== 'generation-complete') return;
		this.generation++;
		this.population = this.pendingPopulation;
		this.pendingPopulation = [];
		this.startGeneration();
	}

	report(): EvolutionReport {
		return {
			config: this.config,
			generations: this.reports,
			final: this.reports[this.reports.length - 1]
		};
	}
}

/** Synchronous headless evolution used by the CLI and spreadsheet export. */
export function runEvolution(config: Partial<EvolutionConfig> = {}): EvolutionReport {
	const sandbox = new EvolutionSandbox(config);
	sandbox.begin();
	let guard = 0;
	while (sandbox.phase !== 'finished' && guard++ < 100_000) {
		if (!sandbox.currentSimulation) {
			if (!sandbox.nextMatch()) break;
			continue;
		}
		while (!sandbox.step(64)) {
			// step returns true at the match cap or at victory
		}
		sandbox.finishMatch();
	}
	return sandbox.report();
}
