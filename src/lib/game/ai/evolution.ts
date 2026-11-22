import { hash32 } from '../map';
import {
	TerritorySimulation,
	type GameSnapshot,
	type PublicPlayer,
	type StepResult
} from '../simulation';
import {
	createRandomGenome,
	crossoverGenomes,
	cloneGenome,
	mutateGenome,
	type BotGenome
} from './genome';

export type BotBucket = 'poor' | 'good' | 'top';
export const BOT_BUCKETS: readonly BotBucket[] = ['poor', 'good', 'top'];
export const GAUNTLET_SEATS = 64;

export interface FitnessWeights {
	land: number;
	income: number;
	attack: number;
	win: number;
	survival: number;
	economy: number;
	defense: number;
	naval: number;
	aggression: number;
	cooperation: number;
	eliminations: number;
	weakAttacks: number;
	defenseStops: number;
	defenseDamage: number;
}

export const FITNESS_WEIGHT_KEYS = [
	'land',
	'income',
	'attack',
	'win',
	'survival',
	'economy',
	'defense',
	'naval',
	'aggression',
	'cooperation',
	'eliminations',
	'weakAttacks',
	'defenseStops',
	'defenseDamage'
] as const;

export const FITNESS_WEIGHT_LABELS: Record<keyof FitnessWeights, string> = {
	land: 'Land share',
	income: 'Income /s',
	attack: 'Attack strength',
	win: 'Match win',
	survival: 'Survival',
	economy: 'Economy structures',
	defense: 'Defense structures',
	naval: 'Naval reach',
	aggression: 'Attacks launched',
	cooperation: 'Allied support',
	eliminations: 'State eliminations',
	weakAttacks: 'Weak-state attacks',
	defenseStops: 'Attacks repelled',
	defenseDamage: 'Defense damage'
};

/**
 * Land was 120k in the original fitness. That made territorial score dominate
 * every decision; the default is halved and every term is now user-tunable.
 */
export const DEFAULT_FITNESS_WEIGHTS: FitnessWeights = {
	land: 60_000,
	income: 120,
	attack: 0.3,
	win: 75_000,
	survival: 1_000,
	economy: 8,
	defense: 10,
	naval: 25,
	aggression: 2,
	cooperation: 8,
	eliminations: 20_000,
	weakAttacks: 25,
	defenseStops: 1_000,
	defenseDamage: 0.1
};

export function normalizeFitnessWeights(
	weights: Partial<FitnessWeights> | undefined
): FitnessWeights {
	const normalized = { ...DEFAULT_FITNESS_WEIGHTS };
	for (const key of FITNESS_WEIGHT_KEYS) {
		const raw = weights?.[key];
		if (raw === undefined) continue;
		const value = Number(raw);
		if (!Number.isFinite(value)) continue;
		normalized[key] = Math.max(0, Math.min(10_000_000, value));
	}
	return normalized;
}

export type EvolutionMode = 'evolution' | 'gauntlet';

export interface EvolutionConfig {
	mode: EvolutionMode;
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
	fitnessWeights: FitnessWeights;
	/** Gauntlet: lives per genome across runs. */
	gauntletLives: number;
	/** Gauntlet: top fitness survivors that recover one life per run. */
	gauntletRecoveryCount: number;
	/** Gauntlet: finish once at most this many genomes remain. */
	gauntletRemainingTarget: number;
}

export const DEFAULT_EVOLUTION_CONFIG: EvolutionConfig = {
	mode: 'evolution',
	seed: 1234,
	populationSize: 16,
	generations: 4,
	playerCount: 8,
	matchesPerRound: 2,
	ticks: 1600,
	width: 1280,
	height: 720,
	teamCount: 1,
	lineageDuels: true,
	fitnessWeights: DEFAULT_FITNESS_WEIGHTS,
	gauntletLives: 3,
	gauntletRecoveryCount: 16,
	gauntletRemainingTarget: 16
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
	eliminations: number;
	weakAttacks: number;
	defenseStops: number;
	defenseDamage: number;
	/** Direct parent-duel record; zero matches means no lineage duel was played. */
	lineageWins: number;
	lineageLosses: number;
	lineageDelta: number;
	/** Gauntlet state after the run, when this row came from a gauntlet. */
	gauntletLives?: number;
	gauntletLostLife?: boolean;
	gauntletRecovered?: boolean;
	gauntletRemoved?: boolean;
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

/** Serializable checkpoint restored by the Evolution Lab worker. */
export interface EvolutionSessionSnapshot {
	version: 1;
	config: EvolutionConfig;
	population: BotGenome[];
	reports: GenerationResult[];
	archive: GenomePerformance[];
	generation: number;
	phase: 'generation-complete' | 'finished';
	/** Gauntlet lives by genome id; omitted for ordinary evolution. */
	gauntletLives?: Record<string, number>;
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
	eliminations: number;
	weakAttacks: number;
	defenseStops: number;
	defenseDamage: number;
	lineageWins: number;
	lineageLosses: number;
	lineageDelta: number;
}

export function normalizeEvolutionConfig(config: Partial<EvolutionConfig> = {}): EvolutionConfig {
	const merged = { ...DEFAULT_EVOLUTION_CONFIG, ...config };
	const mode: EvolutionMode = merged.mode === 'gauntlet' ? 'gauntlet' : 'evolution';
	const requestedPopulation =
		mode === 'gauntlet' && config.populationSize === undefined
			? 64
			: Math.trunc(merged.populationSize);
	const populationSize = Math.max(2, Math.min(64, requestedPopulation));
	const playerCount =
		mode === 'gauntlet'
			? populationSize
			: Math.max(2, Math.min(51, Math.trunc(merged.playerCount)));
	return {
		mode,
		seed: merged.seed >>> 0,
		populationSize: Math.max(playerCount, populationSize),
		generations: Math.max(1, Math.min(50, Math.trunc(merged.generations))),
		playerCount,
		matchesPerRound: Math.max(1, Math.min(8, Math.trunc(merged.matchesPerRound))),
		ticks: Math.max(200, Math.min(30_000, Math.trunc(merged.ticks))),
		width:
			mode === 'gauntlet'
				? Math.max(512, config.width === undefined ? 2048 : Math.trunc(merged.width))
				: Math.max(512, Math.trunc(merged.width)),
		height:
			mode === 'gauntlet'
				? Math.max(256, config.height === undefined ? 1024 : Math.trunc(merged.height))
				: Math.max(256, Math.trunc(merged.height)),
		teamCount: Math.max(1, Math.min(playerCount, Math.trunc(merged.teamCount))),
		lineageDuels: mode === 'evolution' && merged.lineageDuels !== false,
		fitnessWeights: normalizeFitnessWeights(merged.fitnessWeights),
		gauntletLives: Math.max(1, Math.min(9, Math.trunc(merged.gauntletLives))),
		gauntletRecoveryCount: Math.max(1, Math.min(64, Math.trunc(merged.gauntletRecoveryCount))),
		gauntletRemainingTarget: Math.max(1, Math.min(64, Math.trunc(merged.gauntletRemainingTarget)))
	};
}

export function createInitialPopulation(config: EvolutionConfig): BotGenome[] {
	return Array.from({ length: config.populationSize }, (_, index) =>
		createRandomGenome(hash32(config.seed, index, 0x165667b1), 0)
	);
}

/** Final fitness is deliberately multi-objective and fully weight-driven. */
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
		eliminations: number;
		weakAttacks: number;
		defenseStops: number;
		defenseDamage: number;
	} = {
		economy: 0,
		defense: 0,
		naval: 0,
		aggression: 0,
		cooperation: 0,
		eliminations: 0,
		weakAttacks: 0,
		defenseStops: 0,
		defenseDamage: 0
	},
	weights: FitnessWeights = DEFAULT_FITNESS_WEIGHTS
): number {
	return Math.round(
		player.landShare * weights.land +
			income * weights.income +
			attackStrength * weights.attack +
			(won ? weights.win : 0) +
			(player.alive ? weights.survival : 0) +
			strategy.economy * weights.economy +
			strategy.defense * weights.defense +
			strategy.naval * weights.naval +
			strategy.aggression * weights.aggression +
			strategy.cooperation * weights.cooperation +
			strategy.eliminations * weights.eliminations +
			strategy.weakAttacks * weights.weakAttacks +
			strategy.defenseStops * weights.defenseStops +
			strategy.defenseDamage * weights.defenseDamage
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
	seats: readonly BotGenome[],
	weights: FitnessWeights
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
			cooperation: behavior.supportedAttacks,
			// Combat/defense credit only applies while the state is still alive;
			// otherwise a zero-territory corpse could outrank survivors on the
			// strength of damage it absorbed before dying.
			eliminations: player.alive ? behavior.statesEliminated : 0,
			weakAttacks: player.alive ? behavior.attacksVsWeakerStates : 0,
			defenseStops: player.alive ? behavior.attacksRepelled : 0,
			defenseDamage: player.alive ? behavior.defenseDamage : 0
		};
		const fitness = genomeFitness(
			player,
			simulation.incomeOf(playerId),
			attackStrength,
			snapshot.winnerId === playerId,
			strategy,
			weights
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
			eliminations: evaluation.matches ? evaluation.eliminations / evaluation.matches : 0,
			weakAttacks: evaluation.matches ? evaluation.weakAttacks / evaluation.matches : 0,
			defenseStops: evaluation.matches ? evaluation.defenseStops / evaluation.matches : 0,
			defenseDamage: evaluation.matches ? evaluation.defenseDamage / evaluation.matches : 0,
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

/**
 * Apply one gauntlet run to the global lives pool. Every seat that died loses a
 * life; genomes at zero are removed. The highest-fitness survivors (still above
 * zero lives) recover one life, capped at the configured maximum.
 */
export function applyGauntletOutcome(
	rows: GenomePerformance[],
	lives: ReadonlyMap<string, number>,
	eliminatedIds: ReadonlySet<string>,
	recoveryCount: number,
	maxLives: number
): { lives: Map<string, number>; remaining: number } {
	const nextLives = new Map(lives);
	for (const row of rows) {
		const before = nextLives.get(row.genome.id) ?? maxLives;
		const lostLife = eliminatedIds.has(row.genome.id) && before > 0;
		const after = Math.max(0, before - (lostLife ? 1 : 0));
		nextLives.set(row.genome.id, after);
		row.gauntletLives = after;
		row.gauntletLostLife = lostLife;
		row.gauntletRemoved = after <= 0;
		row.gauntletRecovered = false;
	}

	const eligible = rows
		.filter((row) => !eliminatedIds.has(row.genome.id) && (nextLives.get(row.genome.id) ?? 0) > 0)
		.sort(
			(left, right) => right.fitness - left.fitness || left.genome.id.localeCompare(right.genome.id)
		);
	for (let index = 0; index < eligible.length && index < recoveryCount; index++) {
		const row = eligible[index];
		const current = nextLives.get(row.genome.id) ?? 0;
		if (current >= maxLives) continue;
		nextLives.set(row.genome.id, current + 1);
		row.gauntletLives = current + 1;
		row.gauntletRecovered = true;
	}

	return {
		lives: nextLives,
		remaining: rows.filter((row) => (nextLives.get(row.genome.id) ?? 0) > 0).length
	};
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
	config: EvolutionConfig;
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
	/** Gauntlet lives by genome id, global across every run. */
	private gauntletLives = new Map<string, number>();
	private stopRequested = false;

	constructor(config: Partial<EvolutionConfig> = {}) {
		this.config = normalizeEvolutionConfig(config);
		this.population = createInitialPopulation(this.config);
		this.registerGenomes(this.population);
	}

	private registerGenomes(genomes: readonly BotGenome[]): void {
		for (const genome of genomes) this.genomeBank.set(genome.id, genome);
	}

	get latestRows(): GenomePerformance[] {
		const rows = this.reports.length > 0 ? this.reports[this.reports.length - 1].rows : [];
		if (this.config.mode !== 'gauntlet') return rows;
		const activeIds = new Set(this.population.map((genome) => genome.id));
		return rows.filter((row) => activeIds.has(row.genome.id));
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
		if (this.config.mode === 'gauntlet') {
			this.reports = [];
			this.archive.clear();
			this.gauntletLives.clear();
			for (const genome of this.population) {
				this.gauntletLives.set(genome.id, this.config.gauntletLives);
			}
		}
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
		if (this.config.mode === 'gauntlet') {
			this.gauntletLives.clear();
			for (const genome of this.population) {
				this.gauntletLives.set(genome.id, this.config.gauntletLives);
			}
		}
		if (restart) this.startGeneration();
		return true;
	}

	/**
	 * Refill gauntlet slots with fresh random genomes. Only allowed between
	 * runs; new genomes start with the configured number of lives.
	 */
	fillGauntletSeats(target = GAUNTLET_SEATS): number {
		if (
			this.config.mode !== 'gauntlet' ||
			this.currentSimulation ||
			this.population.length >= target
		) {
			return 0;
		}
		const existing = new Set(this.population.map((genome) => genome.id));
		let added = 0;
		let salt = 0;
		while (this.population.length < target && added < target && salt < target * 4) {
			const seed = hash32(
				hash32(this.config.seed, this.generation, this.population.length),
				0x27d4eb2d,
				salt++
			);
			const genome = createRandomGenome(seed, this.generation);
			if (existing.has(genome.id)) continue;
			existing.add(genome.id);
			this.population.push(genome);
			this.gauntletLives.set(genome.id, this.config.gauntletLives);
			this.registerGenomes([genome]);
			added++;
		}
		if (
			added > 0 &&
			this.phase === 'finished' &&
			this.population.length > this.config.gauntletRemainingTarget
		) {
			this.phase = 'generation-complete';
			this.pendingPopulation = [];
		}
		return added;
	}

	/**
	 * Apply run-setup edits before continuing. The mode is fixed for the life of
	 * a sandbox; all other settings take effect on the next match/generation.
	 */
	applyConfig(config: Partial<EvolutionConfig>): void {
		const next = normalizeEvolutionConfig({
			...this.config,
			...config,
			mode: this.config.mode
		});
		this.config = next;
		if (next.mode === 'gauntlet') {
			for (const [id, lives] of this.gauntletLives) {
				if (lives > next.gauntletLives) this.gauntletLives.set(id, next.gauntletLives);
			}
		}
	}

	/**
	 * Graceful stop. During a run, finish the current run/generation and then
	 * stop. Between runs/generations, stop immediately. Returns true when the
	 * sandbox is already stopped.
	 */
	requestStop(): boolean {
		if (this.phase === 'generation-complete') {
			this.phase = 'finished';
			this.pendingPopulation = [];
			this.stopRequested = false;
			return true;
		}
		if (this.phase === 'match') {
			this.stopRequested = true;
			return false;
		}
		return this.phase === 'finished';
	}

	/** Abort the active run without processing its remaining ticks. */
	stopImmediately(): void {
		this.stopRequested = false;
		this.currentSimulation = null;
		this.currentSeats = [];
		this.pendingPopulation = [];
		this.evaluations = new Map();
		this.schedule = [];
		this.scheduleSeeds = [];
		this.phase = 'finished';
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
			playerCount: seats.length,
			allPlayersBots: true,
			botGenomes: seats,
			teamIds:
				this.config.mode === 'evolution' && this.config.teamCount > 1
					? seats.map((_, index) => (index % this.config.teamCount) + 1)
					: undefined,
			matchDurationTicks: this.config.ticks
		});
		return true;
	}

	/**
	 * Advance exactly one simulation tick and return its renderer-visible
	 * result. The worker uses this so it can stream changes without replaying
	 * the whole match on the main thread.
	 */
	stepOnce(): StepResult | null {
		if (!this.currentSimulation) {
			if (!this.startNextMatch()) return null;
		}
		const simulation = this.currentSimulation;
		if (!simulation) return null;
		return simulation.step();
	}

	/** End a gauntlet run early once only the survivor target remains alive. */
	shouldEndMatch(): boolean {
		const simulation = this.currentSimulation;
		if (
			this.config.mode !== 'gauntlet' ||
			!simulation ||
			this.config.gauntletRemainingTarget >= this.currentSeats.length
		) {
			return false;
		}
		let alive = 0;
		for (const player of simulation.players) {
			if (player.alive) alive++;
		}
		return alive <= this.config.gauntletRemainingTarget;
	}

	/** Advance the current match. Returns true when the match is complete. */
	step(ticks = 1): boolean {
		if (!this.currentSimulation && !this.startNextMatch()) return true;
		const simulation = this.currentSimulation;
		if (!simulation) return true;
		for (let index = 0; index < ticks && !simulation.ended; index++) {
			simulation.step();
			if (simulation.tick >= this.config.ticks || this.shouldEndMatch()) break;
		}
		return simulation.ended || simulation.tick >= this.config.ticks || this.shouldEndMatch();
	}

	finishMatch(): void {
		const simulation = this.currentSimulation;
		if (!simulation) return;
		const snapshot = simulation.getSnapshot();
		const scored = scoreMatch(simulation, snapshot, this.currentSeats, this.config.fitnessWeights);
		if (this.config.mode === 'gauntlet') {
			this.finishGauntletRun(snapshot, scored);
			return;
		}
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
				existing.eliminations += value.eliminations;
				existing.weakAttacks += value.weakAttacks;
				existing.defenseStops += value.defenseStops;
				existing.defenseDamage += value.defenseDamage;
				existing.lineageDelta += value.lineageDelta;
			}
		}
		this.currentSimulation = null;
		this.currentSeats = [];
		this.currentMatchIndex++;
		if (this.currentMatchIndex >= this.schedule.length) this.completeGeneration();
	}

	private finishGauntletRun(snapshot: GameSnapshot, scored: Map<string, Evaluation>): void {
		const seatIds = new Set(this.currentSeats.map((genome) => genome.id));
		const rows = aggregateEvaluations(scored, seatIds);
		const eliminatedIds = new Set<string>();
		for (let seat = 0; seat < this.currentSeats.length; seat++) {
			const player = snapshot.players.find((entry) => entry.id === seat + 1);
			if (!player || !player.alive) eliminatedIds.add(this.currentSeats[seat].id);
		}
		const outcome = applyGauntletOutcome(
			rows,
			this.gauntletLives,
			eliminatedIds,
			this.config.gauntletRecoveryCount,
			this.config.gauntletLives
		);
		this.gauntletLives = outcome.lives;
		const buckets = bucketRows(rows);
		this.reports.push({
			generation: this.generation,
			rows,
			buckets,
			archive: []
		});
		this.currentSimulation = null;
		this.currentSeats = [];
		this.currentMatchIndex++;
		const removed: string[] = [];
		this.population = this.population.filter((genome) => {
			if ((this.gauntletLives.get(genome.id) ?? 0) > 0) return true;
			removed.push(genome.id);
			return false;
		});
		for (const id of removed) {
			this.gauntletLives.delete(id);
			this.genomeBank.delete(id);
		}
		this.generation++;
		if (
			this.stopRequested ||
			this.population.length <= this.config.gauntletRemainingTarget ||
			this.population.length < 2
		) {
			this.stopRequested = false;
			this.phase = 'finished';
			this.pendingPopulation = [];
			return;
		}
		this.phase = 'generation-complete';
	}

	nextMatch(): boolean {
		if (this.currentSimulation) return false;
		if (this.config.mode === 'gauntlet' && this.phase === 'generation-complete') {
			this.phase = 'match';
			this.currentMatchIndex = 0;
			this.currentSimulation = null;
			this.schedule = [this.population];
			this.startNextMatch();
			return this.currentSimulation !== null;
		}
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
		if (this.config.mode === 'gauntlet') {
			this.schedule = [this.population];
			this.scheduleSeeds = [hash32(this.config.seed, this.generation, 0x51ed270b)];
			this.startNextMatch();
			return;
		}
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
				eliminations: 0,
				weakAttacks: 0,
				defenseStops: 0,
				defenseDamage: 0,
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
		// Rotate a single population order by playerCount each match. The windows
		// tile the population instead of sampling random starts, so no genome can
		// sit out a generation and end with fitness 0.
		const base = hash32(this.config.seed, this.generation, 0x9e3779b9) % this.population.length;
		for (let round = 0; round < rounds * this.config.matchesPerRound; round++) {
			const offset = (base + round * this.config.playerCount) % this.population.length;
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
		const seenPairs = new Set<string>();
		const appeared = new Set<string>();
		const addPair = (first: BotGenome, second: BotGenome, salt: number): void => {
			if (first.id === second.id) return;
			const key = first.id < second.id ? `${first.id}|${second.id}` : `${second.id}|${first.id}`;
			if (seenPairs.has(key)) return;
			seenPairs.add(key);
			appeared.add(first.id);
			appeared.add(second.id);
			for (let pass = 0; pass < passes; pass++) {
				const pairSeed = hash32(hash32(this.config.seed, this.generation, salt), 0x9e3779b9, pass);
				schedule.push([first, second], [second, first]);
				this.scheduleSeeds.push(pairSeed, pairSeed);
			}
		};

		// Lineage pairs take priority; fallback mirrors only fill genomes that
		// were not covered as either side of a parent duel.
		for (let index = 0; index < this.population.length; index++) {
			const child = this.population[index];
			const ancestors = child.parents
				.map((id) => this.genomeBank.get(id))
				.filter((genome): genome is BotGenome => !!genome && genome.id !== child.id);
			if (ancestors.length === 0) continue;
			const pick = hash32(hash32(this.config.seed, this.generation, index), 0x85ebca6b, index);
			addPair(child, ancestors[pick % ancestors.length], index);
		}
		for (let index = 0; index < this.population.length; index++) {
			const genome = this.population[index];
			if (appeared.has(genome.id)) continue;
			const unseenPair = (candidate: BotGenome): boolean =>
				candidate.id !== genome.id &&
				!seenPairs.has(
					genome.id < candidate.id ? `${genome.id}|${candidate.id}` : `${candidate.id}|${genome.id}`
				);
			const opponent =
				this.population.find((candidate) => !appeared.has(candidate.id) && unseenPair(candidate)) ??
				this.population.find(unseenPair);
			if (opponent) addPair(genome, opponent, index);
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
		if (this.stopRequested) {
			this.stopRequested = false;
			this.phase = 'finished';
			this.pendingPopulation = [];
			return;
		}
		if (this.generation + 1 >= this.config.generations) {
			this.phase = 'finished';
			this.pendingPopulation = [];
			return;
		}
		this.pendingPopulation = nextPopulation(rows, this.config, this.generation + 1, this.archive);
		this.phase = 'generation-complete';
	}

	/**
	 * Continue a finished run by extending its generation budget and breeding
	 * the final population once more from the existing survivors and archive.
	 */
	continueEvolution(extraGenerations = 1): boolean {
		if (this.config.mode === 'gauntlet') {
			if (this.population.length < 2) return false;
			if (this.phase === 'finished') {
				this.phase = 'generation-complete';
				this.stopRequested = false;
				return true;
			}
			if (this.phase !== 'generation-complete') return false;
			this.phase = 'match';
			this.currentSimulation = null;
			this.schedule = [this.population];
			this.startNextMatch();
			return this.currentSimulation !== null;
		}
		if (this.phase !== 'finished' || this.reports.length === 0) return false;
		if (this.config.generations >= 50) return false;
		const latest = this.reports[this.reports.length - 1];
		this.config.generations = Math.min(
			50,
			this.config.generations + Math.max(1, Math.trunc(extraGenerations))
		);
		this.pendingPopulation = nextPopulation(
			latest.rows,
			this.config,
			this.generation + 1,
			this.archive
		);
		this.phase = 'generation-complete';
		return true;
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

	/**
	 * Capture a reload-safe checkpoint at a generation boundary. The worker
	 * persists this in IndexedDB; restoring it leaves the run paused so the
	 * user can continue from the last completed generation.
	 */
	captureSession(): EvolutionSessionSnapshot | null {
		if (
			(this.phase !== 'generation-complete' && this.phase !== 'finished') ||
			this.reports.length === 0
		) {
			return null;
		}
		return {
			version: 1,
			config: {
				...this.config,
				fitnessWeights: { ...this.config.fitnessWeights }
			},
			population: this.population.map(cloneGenome),
			reports: structuredClone(this.reports),
			archive: Array.from(this.archive.values()).map((row) => ({
				...row,
				genome: cloneGenome(row.genome)
			})),
			generation: this.generation,
			phase: this.phase,
			gauntletLives:
				this.config.mode === 'gauntlet'
					? Object.fromEntries(this.gauntletLives.entries())
					: undefined
		};
	}

	restoreSession(snapshot: EvolutionSessionSnapshot): boolean {
		if (
			snapshot.version !== 1 ||
			(snapshot.phase !== 'generation-complete' && snapshot.phase !== 'finished') ||
			snapshot.population.length <
				(this.config.mode === 'gauntlet' ? 2 : this.config.playerCount) ||
			snapshot.reports.length === 0
		) {
			return false;
		}
		this.population = snapshot.population.map(cloneGenome);
		this.reports = structuredClone(snapshot.reports);
		this.archive.clear();
		for (const row of snapshot.archive) {
			this.archive.set(row.descriptor, { ...row, genome: cloneGenome(row.genome) });
		}
		this.generation = snapshot.generation;
		this.phase = snapshot.phase;
		this.currentSimulation = null;
		this.currentSeats = [];
		this.currentMatchIndex = 0;
		this.schedule = [];
		this.scheduleSeeds = [];
		this.evaluations = new Map();
		this.genomeBank.clear();
		this.gauntletLives.clear();
		if (this.config.mode === 'gauntlet' && snapshot.gauntletLives) {
			for (const genome of this.population) {
				this.gauntletLives.set(
					genome.id,
					snapshot.gauntletLives[genome.id] ?? this.config.gauntletLives
				);
			}
		}
		this.registerGenomes(this.population);
		for (const report of this.reports) {
			for (const row of report.rows) this.registerGenomes([row.genome]);
			for (const row of report.archive) this.registerGenomes([row.genome]);
		}
		for (const row of this.archive.values()) this.registerGenomes([row.genome]);
		this.pendingPopulation =
			snapshot.phase === 'generation-complete'
				? nextPopulation(
						this.reports[this.reports.length - 1].rows,
						this.config,
						this.generation + 1,
						this.archive
					)
				: [];
		return true;
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
