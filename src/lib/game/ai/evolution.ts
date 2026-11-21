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
	/** 1 = free-for-all; >1 assigns cyclic teams for coordinated bot matches. */
	teamCount: number;
	/**
	 * In 1v1, evaluate each descendant in mirrored duels against one parent so a
	 * mutation must beat its ancestor instead of relying on mixed-pair noise.
	 */
	lineageDuels: boolean;
}

export const DEFAULT_EVOLUTION_CONFIG: EvolutionConfig = {
	seed: 1234,
	populationSize: 16,
	generations: 4,
	playerCount: 8,
	matchesPerRound: 2,
	ticks: 1600,
	width: 1280,
	height: 720,
	teamCount: 1,
	lineageDuels: true
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
	/** Quality-diversity descriptor: economy/defense/naval/aggression bins. */
	descriptor: string;
	economy: number;
	defense: number;
	naval: number;
	aggression: number;
	cooperation: number;
	/** Direct parent-duel record; zero matches means no lineage duel was played. */
	lineageWins: number;
	lineageLosses: number;
	lineageDelta: number;
}

export interface GenerationResult {
	generation: number;
	rows: GenomePerformance[];
	buckets: Record<BotBucket, string[]>;
	archive: GenomePerformance[];
}

export interface EvolutionReport {
	config: EvolutionConfig;
	generations: GenerationResult[];
	final: GenerationResult;
	archive: GenomePerformance[];
}

interface Evaluation {
	genome: BotGenome;
	matches: number;
	wins: number;
	landShare: number;
	income: number;
	attackStrength: number;
	fitness: number;
	economy: number;
	defense: number;
	naval: number;
	aggression: number;
	cooperation: number;
	lineageWins: number;
	lineageLosses: number;
	lineageDelta: number;
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
		height: Math.max(256, Math.trunc(merged.height)),
		teamCount: Math.max(1, Math.min(playerCount, Math.trunc(merged.teamCount))),
		lineageDuels: merged.lineageDuels !== false
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
	won: boolean,
	strategy: {
		economy: number;
		defense: number;
		naval: number;
		aggression: number;
		cooperation: number;
	} = { economy: 0, defense: 0, naval: 0, aggression: 0, cooperation: 0 }
): number {
	return Math.round(
		player.landShare * 120_000 +
			income * 120 +
			attackStrength * 0.3 +
			(won ? 75_000 : 0) +
			(player.alive ? 1_000 : 0) +
			strategy.economy * 8 +
			strategy.defense * 10 +
			strategy.naval * 25 +
			strategy.aggression * 2 +
			strategy.cooperation * 8
	);
}

function descriptorFor(metrics: {
	economy: number;
	defense: number;
	naval: number;
	aggression: number;
}): string {
	const bin = (value: number, low: number, high: number): number =>
		value >= high ? 2 : value >= low ? 1 : 0;
	return [
		`E${bin(metrics.economy, 3, 8)}`,
		`D${bin(metrics.defense, 3, 8)}`,
		`N${bin(metrics.naval, 1, 3)}`,
		`A${bin(metrics.aggression, 5, 12)}`
	].join('-');
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
		const strategy = {
			economy,
			defense,
			naval,
			aggression: behavior.attacksLaunched,
			cooperation: behavior.supportedAttacks
		};
		const fitness = genomeFitness(
			player,
			simulation.incomeOf(playerId),
			attackStrength,
			snapshot.winnerId === playerId,
			strategy
		);
		scored.set(genome.id, {
			genome,
			matches: 1,
			wins: snapshot.winnerId === playerId ? 1 : 0,
			landShare: player.landShare,
			income: simulation.incomeOf(playerId),
			attackStrength,
			fitness,
			...strategy,
			lineageWins: 0,
			lineageLosses: 0,
			lineageDelta: 0
		});
	}
	if (seats.length === 2) {
		const first = scored.get(seats[0].id);
		const second = scored.get(seats[1].id);
		if (first && second) {
			const pairs: Array<[Evaluation, Evaluation]> = [
				[first, second],
				[second, first]
			];
			for (const [child, parent] of pairs) {
				if (!child.genome.parents.includes(parent.genome.id)) continue;
				// Mirror duels use the same map and swapped seats. Compare the
				// summed performance margin so a lucky spawn cancels across seats
				// instead of becoming a false binary win.
				child.lineageDelta += child.fitness - parent.fitness;
			}
		}
	}
	return scored;
}

function aggregateEvaluations(
	evaluations: Map<string, Evaluation>,
	populationIds?: Set<string>
): GenomePerformance[] {
	const rows = Array.from(evaluations.values())
		.filter((evaluation) => !populationIds || populationIds.has(evaluation.genome.id))
		.map<GenomePerformance>((evaluation) => ({
			genome: evaluation.genome,
			bucket: 'poor',
			matches: evaluation.matches,
			wins: evaluation.wins,
			landShare: evaluation.matches ? evaluation.landShare / evaluation.matches : 0,
			income: evaluation.matches ? evaluation.income / evaluation.matches : 0,
			attackStrength: evaluation.matches ? evaluation.attackStrength / evaluation.matches : 0,
			fitness: evaluation.matches
				? Math.round((evaluation.fitness / evaluation.matches) * 100) / 100
				: 0,
			economy: evaluation.matches ? evaluation.economy / evaluation.matches : 0,
			defense: evaluation.matches ? evaluation.defense / evaluation.matches : 0,
			naval: evaluation.matches ? evaluation.naval / evaluation.matches : 0,
			aggression: evaluation.matches ? evaluation.aggression / evaluation.matches : 0,
			cooperation: evaluation.matches ? evaluation.cooperation / evaluation.matches : 0,
			lineageWins: evaluation.lineageDelta > 0 ? 1 : 0,
			lineageLosses: evaluation.lineageDelta < 0 ? 1 : 0,
			lineageDelta: evaluation.lineageDelta,
			descriptor: descriptorFor({
				economy: evaluation.matches ? evaluation.economy / evaluation.matches : 0,
				defense: evaluation.matches ? evaluation.defense / evaluation.matches : 0,
				naval: evaluation.matches ? evaluation.naval / evaluation.matches : 0,
				aggression: evaluation.matches ? evaluation.aggression / evaluation.matches : 0
			})
		}));
	// A mutation that loses its mirrored ancestor comparison falls below any
	// neutral genome; a winner rises. This keeps selection incremental.
	const selectionScore = (row: GenomePerformance): number =>
		row.fitness + (row.lineageWins - row.lineageLosses) * 60_000;
	rows.sort(
		(left, right) =>
			selectionScore(right) - selectionScore(left) ||
			right.fitness - left.fitness ||
			left.genome.id.localeCompare(right.genome.id)
	);
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
	generation: number,
	archive: Map<string, GenomePerformance>
): BotGenome[] {
	const lineageCull = config.playerCount === 2 && config.lineageDuels;
	const eligible = lineageCull ? rows.filter((row) => row.lineageLosses <= row.lineageWins) : rows;
	const survivorPool = eligible.length >= 2 ? eligible : rows;
	const survivorCount = Math.max(2, Math.ceil(survivorPool.length * 0.5));
	const survivors = survivorPool.slice(0, survivorCount).map((row) => row.genome);
	const eliteCount = Math.max(1, Math.ceil(rows.length * 0.2));
	const archiveElites = Array.from(archive.values()).sort(
		(left, right) => right.fitness - left.fitness
	);
	const next: BotGenome[] = [];
	const eliteIds = new Set<string>();
	for (const row of survivorPool.slice(0, eliteCount)) {
		if (eliteIds.has(row.genome.id)) continue;
		eliteIds.add(row.genome.id);
		next.push(cloneGenome(row.genome));
	}
	// Keep one best genome per quality-diversity descriptor in the breeding pool.
	const descriptorEliteTarget = Math.max(eliteCount, Math.ceil(rows.length * 0.4));
	for (const row of archiveElites) {
		if (next.length >= descriptorEliteTarget) break;
		if (eliteIds.has(row.genome.id)) continue;
		eliteIds.add(row.genome.id);
		next.push(cloneGenome(row.genome));
	}
	const parentPool = [...survivorPool.slice(0, survivorCount), ...archiveElites];
	while (next.length < config.populationSize) {
		const seed = hash32(hash32(config.seed, generation, next.length), 0x27d4eb2d, 0);
		const first = parentPool[seed % parentPool.length].genome;
		const second = parentPool[hash32(seed, 1, generation) % parentPool.length].genome;
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
	/** MAP-Elites-style archive: best fitness per strategy descriptor. */
	readonly archive = new Map<string, GenomePerformance>();
	private schedule: BotGenome[][] = [];
	/** Optional fixed seed per match so mirrored lineage duels share a map. */
	private scheduleSeeds: number[] = [];
	private evaluations = new Map<string, Evaluation>();
	/** Keeps ancestors available as opponents after they leave the live population. */
	private readonly genomeBank = new Map<string, BotGenome>();
	private pendingPopulation: BotGenome[] = [];

	constructor(config: Partial<EvolutionConfig> = {}) {
		this.config = normalizeEvolutionConfig(config);
		this.population = createInitialPopulation(this.config);
		this.registerGenomes(this.population);
	}

	private registerGenomes(genomes: readonly BotGenome[]): void {
		for (const genome of genomes) this.genomeBank.set(genome.id, genome);
	}

	get latestRows(): GenomePerformance[] {
		return this.reports.length > 0 ? this.reports[this.reports.length - 1].rows : [];
	}

	get progress(): { match: number; matches: number; generation: number } {
		return {
			match:
				this.schedule.length === 0 ? 0 : Math.min(this.schedule.length, this.currentMatchIndex + 1),
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
		this.archive.clear();
		this.genomeBank.clear();
		this.registerGenomes(this.population);
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
		const seed =
			this.scheduleSeeds[this.currentMatchIndex] ??
			hash32(hash32(this.config.seed, this.generation, this.currentMatchIndex), 0x51ed270b, 0);
		this.currentMatchSeed = seed;
		this.currentSeats = seats;
		this.currentSimulation = new TerritorySimulation({
			seed,
			width: this.config.width,
			height: this.config.height,
			playerCount: this.config.playerCount,
			allPlayersBots: true,
			botGenomes: seats,
			teamIds:
				this.config.teamCount > 1
					? seats.map((_, index) => (index % this.config.teamCount) + 1)
					: undefined,
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
				existing.economy += value.economy;
				existing.defense += value.defense;
				existing.naval += value.naval;
				existing.aggression += value.aggression;
				existing.cooperation += value.cooperation;
				existing.lineageDelta += value.lineageDelta;
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
		this.registerGenomes(this.population);
		this.schedule = this.buildSchedule();
		for (const genome of this.population) {
			this.evaluations.set(genome.id, {
				genome,
				matches: 0,
				wins: 0,
				landShare: 0,
				income: 0,
				attackStrength: 0,
				fitness: 0,
				economy: 0,
				defense: 0,
				naval: 0,
				aggression: 0,
				cooperation: 0,
				lineageWins: 0,
				lineageLosses: 0,
				lineageDelta: 0
			});
		}
		this.startNextMatch();
	}

	private buildSchedule(): BotGenome[][] {
		this.scheduleSeeds = [];
		if (this.config.playerCount === 2 && this.config.lineageDuels) {
			return this.buildLineageSchedule();
		}
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

	/**
	 * Every current genome meets one parent in both seat orders. Comparing the
	 * two match performances isolates the mutation from mixed-pair noise: losing
	 * both is a lineage loss, winning both is a lineage win.
	 */
	private buildLineageSchedule(): BotGenome[][] {
		const schedule: BotGenome[][] = [];
		const passes = Math.max(1, Math.ceil(this.config.matchesPerRound / 2));
		for (let index = 0; index < this.population.length; index++) {
			const child = this.population[index];
			const ancestors = child.parents
				.map((id) => this.genomeBank.get(id))
				.filter((genome): genome is BotGenome => !!genome && genome.id !== child.id);
			let opponent: BotGenome | undefined;
			if (ancestors.length > 0) {
				const pick = hash32(hash32(this.config.seed, this.generation, index), 0x85ebca6b, index);
				opponent = ancestors[pick % ancestors.length];
			} else {
				opponent = this.population[(index + 1) % this.population.length];
				if (opponent.id === child.id)
					opponent = this.population[(index + 2) % this.population.length];
			}
			if (!opponent || opponent.id === child.id) continue;
			for (let pass = 0; pass < passes; pass++) {
				const pairSeed = hash32(hash32(this.config.seed, this.generation, index), 0x9e3779b9, pass);
				schedule.push([child, opponent], [opponent, child]);
				this.scheduleSeeds.push(pairSeed, pairSeed);
			}
		}
		return schedule;
	}

	private completeGeneration(): void {
		const populationIds = new Set(this.population.map((genome) => genome.id));
		const rows = aggregateEvaluations(this.evaluations, populationIds);
		const buckets = bucketRows(rows);
		for (const row of rows) {
			// A genome that lost both mirrored ancestor duels does not earn a
			// quality-diversity slot; otherwise the archive would rescue it.
			if (row.lineageLosses > row.lineageWins) continue;
			const existing = this.archive.get(row.descriptor);
			if (!existing || row.fitness > existing.fitness) {
				this.archive.set(row.descriptor, { ...row });
			}
		}
		const archiveRows = Array.from(this.archive.values()).sort(
			(left, right) => right.fitness - left.fitness
		);
		this.reports.push({
			generation: this.generation,
			rows,
			buckets,
			archive: archiveRows
		});
		if (this.generation + 1 >= this.config.generations) {
			this.phase = 'finished';
			this.pendingPopulation = [];
			return;
		}
		this.pendingPopulation = nextPopulation(rows, this.config, this.generation + 1, this.archive);
		this.phase = 'generation-complete';
	}

	nextGeneration(): void {
		if (this.phase !== 'generation-complete') return;
		this.generation++;
		this.population = this.pendingPopulation;
		this.pendingPopulation = [];
		this.registerGenomes(this.population);
		this.startGeneration();
	}

	report(): EvolutionReport {
		return {
			config: this.config,
			generations: this.reports,
			final: this.reports[this.reports.length - 1],
			archive: Array.from(this.archive.values()).sort((left, right) => right.fitness - left.fitness)
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
