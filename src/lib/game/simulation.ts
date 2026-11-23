import {
	ANNEX_INTERVAL_TICKS,
	ARTILLERY_BLAST_RADIUS,
	ARTILLERY_BUILD_CLEARANCE,
	ARTILLERY_COOLDOWN_TICKS,
	ARTILLERY_RANGE,
	ARTILLERY_SHELL_SPREAD,
	ARTILLERY_SHELL_TRAVEL_TICKS,
	ARTILLERY_SUPPLY_COST_PER_LEVEL,
	ARTILLERY_TARGET_SNAP_RADIUS,
	ATTACK_ATTRITION_BASE,
	ATTACK_ATTRITION_BONUS,
	ATTACK_DAMAGE_PER_TICK,
	ATTACK_IDLE_TICKS,
	ATTACK_ORDER_DAMAGE_BONUS,
	ATTACK_ORDER_DEFENSE_PIERCE,
	ATTACK_SEARCH_RADIUS,
	ATTACK_STRENGTH_BASE,
	ATTACK_STRENGTH_BONUS,
	ATTACK_SUPPLY_COST_BASE,
	ATTACK_SUPPLY_COST_BONUS,
	BASE_DEFENSE_OFFSET,
	BASE_GOLD_INCOME,
	ELIMINATION_SUPPLY_INCOME_BONUS,
	BOT_ACTION_MAX_PER_INTERVAL,
	BOT_ACTION_NOVELTY_BONUS,
	BOT_ACTION_REPEAT_PENALTY,
	BOT_STRATEGIC_SAVE_MIN_STRUCTURES,
	BOT_ATTACK_AGGRESSION_WEIGHT,
	BOT_ATTACK_BASE_CHANCE,
	BOT_ATTACK_DEFENSE_WEIGHT,
	BOT_ATTACK_ECONOMIC_BUFFER_CAP,
	BOT_ATTACK_SAVE_KEEP_FLOOR,
	BOT_ATTACK_SAVE_KEEP_FRACTION,
	BOT_EARLY_ECONOMY_PER_TYPE,
	BOT_EARLY_ECONOMY_RESERVE_MAX,
	BOT_EARLY_ECONOMY_TICK_LIMIT,
	BOT_EARLY_ECONOMY_UTILITY,
	BOT_ATTACK_SCORE_CENTER,
	BOT_ATTACK_SCORE_WEIGHT,
	BOT_ATTACK_SUPPLY_PRESSURE_WEIGHT,
	BOT_ARTILLERY_OPENING_AGGRESSION,
	BOT_ARTILLERY_OPENING_TERRITORY,
	BOT_ARTILLERY_OPENING_TICK,
	BOT_BARRACKS_OPENING_UTILITY,
	BOT_BUILD_INTERVAL,
	BOT_EARLY_ECONOMY_MILITARY_TICK,
	BOT_DEFENSE_FIRST_UTILITY,
	BOT_DEFENSE_RESERVE_MAX,
	BOT_DEFENSE_STALL_INTERVALS,
	BOT_DECISION_INTERVAL,
	BOT_DETERRENCE_FORT_UTILITY,
	BOT_DETERRENCE_MAX_EXTRA_COPIES,
	BOT_DETERRENCE_MAX_EXTRA_LEVELS,
	BOT_DETERRENCE_STRENGTH_DIVISOR,
	BOT_INCOME_GAP_ATTACK_PENALTY,
	BOT_INCOME_GAP_ATTACK_PENALTY_CAP,
	BOT_INCOME_GAP_COMMAND_POST_WEIGHT,
	BOT_INCOME_GAP_WAR_ACADEMY_WEIGHT,
	BOT_INCOME_UTILITY,
	BOT_OPPORTUNITY_CHANCE_BONUS,
	BOT_OPPORTUNITY_LOW_SUPPLY_PERCENT,
	BOT_OPPORTUNITY_STRONGER_BONUS,
	BOT_THREAT_DETERRENCE_CAP,
	BOT_THREAT_PER_DETERRENCE,
	BOT_STARTING_GOLD,
	BOT_THREAT_ATTACK_CAP,
	BOT_THREAT_CONTACT_CAP,
	BOT_THREAT_COUNTER_BONUS,
	BOT_THREAT_DEFENSIVE,
	BOT_THREAT_LOSS_CAP,
	BOT_THREAT_NEUTRAL_BIAS,
	BOT_THREAT_PER_ATTACK,
	BOT_THREAT_PER_CONTACT,
	BOT_THREAT_PER_LOSS,
	BOT_THREAT_RETALIATE_BONUS,
	BOT_THREAT_SAFE,
	BOT_THREAT_UNRELATED_PENALTY,
	BOT_TEAM_COORDINATION_BONUS,
	DISTRICT_NOISE_CELL,
	DISTRICT_NOISE_MARGIN,
	BOT_SEARCH_TRIES,
	HUMAN_PLAYER_ID,
	INCOME_INTERVAL_TICKS,
	LEAST_RESISTANCE_SAMPLE_SIZE,
	NAVAL_SPEED_PX_PER_SECOND,
	BOT_NAVAL_DISTANCE_PENALTY_DIVISOR,
	BOT_NAVAL_LAUNCH_CHANCE,
	BOT_NAVAL_MIN_SCORE,
	BOT_NAVAL_SEARCH_TRIES,
	BOT_OPTION_MAX_TICKS,
	BOT_OPTION_MIN_TICKS,
	BOT_OPTION_SWITCH_MARGIN,
	OCCUPIED_DEFENSE_BONUS,
	MAX_PLAYER_COUNT,
	PLAYER_COUNT,
	PLAYER_NAMES,
	PORT_BUILD_SNAP_RADIUS,
	RENDER_TILE_SIZE,
	STARTING_GOLD,
	START_RADIUS,
	SUPPLY_CAP_BASE,
	SUPPLY_CAP_TERRITORY_DIVISOR,
	SUPPLY_INCOME_TERRITORY_DIVISOR,
	SUPPLY_WIN_SHARE,
	STRUCTURE_MIN_SPACING,
	UPGRADE_LEVEL_COST_STEP,
	TICK_RATE,
	UNCLAIMED_CLEANUP_INTERVAL_TICKS,
	UNCLAIMED_POCKET_MAX_AREA
} from './constants';
import {
	createGrowthLayer,
	DEFAULT_GROWTH_MODE,
	isGrowthMode,
	type GrowthLayer,
	type GrowthMode
} from './growth';
import { TerritoryIntegrity, type IntegrityAnchor } from './integrity';
import { generateMap, hash32, type GeneratedMap, type StartPoint } from './map';
import { adjacentWater, computeSeaComponents, isShoreIndex, SeaRouter } from './naval';
import {
	BUILDABLE_STRUCTURE_TYPES,
	StructureRegistry,
	STRUCTURE_DEFINITIONS,
	STRUCTURE_TYPE_CODES,
	STRUCTURE_TYPES,
	structureTypeFromCode,
	type BuildableStructureType,
	type Card,
	type PublicCard,
	type PublicStructure,
	type Structure,
	type StructureType
} from './Structures';
import { DeterministicRng } from './rng';
import { BOT_MODULE_IDS, scaledBonus, type BotGenome, type BotModules } from './ai/genome';
import {
	BOT_OPTION_CODES,
	botOptionFromCode,
	emptyOptionCounts,
	type BotOptionId
} from './ai/options';
import type { MarkovCondition, MarkovController } from './ai/markov';

export interface PlayerState {
	id: number;
	name: string;
	isBot: boolean;
	alive: boolean;
	territory: number;
	/** 0 = free-for-all; equal nonzero ids are allies. */
	teamId: number;
	/** Land frontier cells. Derived from owners + land; never trusted across a network. */
	border: Set<number>;
}

export interface AttackState {
	id: number;
	attackerId: number;
	defenderId: number;
	targetX: number;
	targetY: number;
	anchorX: number;
	anchorY: number;
	growthMode: GrowthMode;
	frontier: GrowthLayer;
	createdAtTick: number;
	lifetimeTicks: number;
	/** Orders still embedded in this attack; reaching 0 halts it. */
	orders: number;
	initialOrders: number;
	/** Durable Frontage strength pool; captures and attrition spend it. */
	strength: number;
	initialStrength: number;
	/** Supply paid at launch; cancellation refunds a ratio of it. */
	supplyCost: number;
	/** Captures per tick allowed by this front's power. */
	power: number;
	pierce: number;
	/** Consecutive ticks without a capture. */
	idleTicks: number;
	captures: number;
	done: boolean;
}

export interface BotBehaviorTelemetry {
	threatenedFortificationBuilds: number;
	threatenedFortificationUpgrades: number;
	deterrencePostures: number;
	incomeGapCommandPosts: number;
	incomeGapWarAcademies: number;
	opportunityAttacks: number;
	botPortBuilds: number;
	botNavalLandings: number;
	optionSelections: Record<BotOptionId, number>;
}

/** Per-player behavior used by evolution descriptors and reward shaping. */
export interface BotPlayerBehaviorMetrics {
	attacksLaunched: number;
	supportedAttacks: number;
	fortificationsBuilt: number;
	fortificationUpgrades: number;
	commandPostsBuilt: number;
	warAcademiesBuilt: number;
	portsBuilt: number;
	navalLandings: number;
	/** Opponent states erased by this player's pressure. */
	statesEliminated: number;
	/** Attacks launched against a materially weaker state. */
	attacksVsWeakerStates: number;
	/** Hostile fronts that died in combat or stalled out against this player. */
	attacksRepelled: number;
	/** Durable strength this player's defense forced attacking fronts to spend. */
	defenseDamage: number;
}

export interface PublicPlayer {
	id: number;
	name: string;
	isBot: boolean;
	alive: boolean;
	territory: number;
	landShare: number;
	supply: number;
	/** Fronts this player could launch right now at their current attack cost. */
	attacksAffordable: number;
}

interface BotProfile {
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

const DEFAULT_BOT_MODULES: BotModules = {
	income: 50,
	defense: 50,
	deterrence: 50,
	opportunity: 50,
	expansion: 50,
	retaliation: 50
};

interface BotEconomicAction {
	type: BuildableStructureType;
	kind: 'build' | 'upgrade';
	cost: number;
	score: number;
	cell?: number;
	structure?: Structure;
}

export interface PublicAttack {
	id: number;
	attackerId: number;
	defenderId: number;
	targetX: number;
	targetY: number;
	orders: number;
	strength: number;
	initialStrength: number;
	power: number;
	pierce: number;
	captures: number;
	growthMode: GrowthMode;
}

export interface ArtilleryShell {
	id: number;
	ownerId: number;
	fromX: number;
	fromY: number;
	targetX: number;
	targetY: number;
	launchedAtTick: number;
	arriveAtTick: number;
}

export interface PublicArtilleryShell extends ArtilleryShell {
	/** Render-only interpolation in `[0, 1]`; not checksummed. */
	progress: number;
}

export interface NavalLanding {
	id: number;
	ownerId: number;
	portId: number;
	targetIndex: number;
	/** Water route plus the final target shore cell. */
	path: number[];
	launchedAtTick: number;
	arriveAtTick: number;
}

export interface PublicNavalLanding extends NavalLanding {
	/** Render-only interpolation in `[0, 1]`; not checksummed. */
	progress: number;
}

export interface GameSnapshot {
	tick: number;
	seed: number;
	landCount: number;
	claimedLand: number;
	players: PublicPlayer[];
	attacks: PublicAttack[];
	shells: PublicArtilleryShell[];
	navalLandings: PublicNavalLanding[];
	structures: PublicStructure[];
	/** Human state's economy. Bots do not build cards yet. */
	gold: number;
	income: number;
	supply: number;
	supplyCap: number;
	supplyIncome: number;
	hand: PublicCard[];
	attackOrders: number;
	attackOrderCap: number;
	winnerId: number | null;
	ended: boolean;
	humanId: number;
	/** Growth layer used by attacks created from now on. */
	growthMode: GrowthMode;
}

export type SimEventKind =
	'elimination' | 'victory' | 'structure' | 'build' | 'attack' | 'artillery' | 'naval' | 'system';

export interface SimEvent {
	id: number;
	tick: number;
	kind: SimEventKind;
	message: string;
	playerId?: number;
}

export type AttackFailure =
	| 'ended'
	| 'eliminated'
	| 'ocean'
	| 'own-territory'
	| 'no-shared-border'
	| 'no-orders'
	| 'invalid'
	| 'no-artillery'
	| 'cooling'
	| 'no-supply'
	| 'out-of-range'
	| 'district-clearance'
	| 'no-port'
	| 'not-shore'
	| 'no-sea-path'
	| 'friendly-shore';

export interface AttackOrderResult {
	ok: boolean;
	reason?: AttackFailure;
	message: string;
}

export interface AttackCommand {
	type: 'attack';
	playerId: number;
	x: number;
	y: number;
	sequence: number;
}

export interface ArtilleryFireCommand {
	type: 'artillery';
	playerId: number;
	x: number;
	y: number;
	sequence: number;
}

export interface NavalCommand {
	type: 'naval';
	playerId: number;
	x: number;
	y: number;
	sequence: number;
}

export interface BuildCommand {
	type: 'build';
	playerId: number;
	cardId: number;
	x: number;
	y: number;
	sequence: number;
}

export interface UpgradeCommand {
	type: 'upgrade';
	playerId: number;
	x: number;
	y: number;
	/** Quoted base card cost plus the projected current level. */
	cost: number;
	/** Merged-district upgrades pin the lowest participating structure. */
	structureId?: number;
	sequence: number;
}

export interface DemolishCommand {
	type: 'demolish';
	playerId: number;
	structureId: number;
	sequence: number;
}

export type GameCommand =
	| AttackCommand
	| ArtilleryFireCommand
	| NavalCommand
	| BuildCommand
	| UpgradeCommand
	| DemolishCommand;

export type BuildFailure =
	| 'ended'
	| 'eliminated'
	| 'no-card'
	| 'no-gold'
	| 'ocean'
	| 'not-owned'
	| 'not-shore'
	| 'occupied'
	| 'too-close'
	| 'inside-district'
	| 'district-clearance'
	| 'no-district'
	| 'invalid';

export interface BuildOrderResult {
	ok: boolean;
	reason?: BuildFailure;
	message: string;
	/** Resolved cell when a Port snap moves the build away from the cursor. */
	targetX?: number;
	targetY?: number;
}

export interface UpgradeQuote extends BuildOrderResult {
	levels: number;
	cost: number;
	currentLevel: number;
	projectedLevel: number;
	merged: boolean;
	structureCount: number;
}

/** A visual/upgrade group of touching same-owner districts of one structure type. */
export interface MergedDistrictGroup {
	ownerId: number;
	type: BuildableStructureType;
	totalStacks: number;
	structureIds: number[];
	centerX: number;
	centerY: number;
	lowestStructureId: number;
}

export interface StepResult {
	tick: number;
	/** Packed as `(owner << 21) | pixelIndex`. Consumed before the next step. */
	changes: Uint32Array;
	changeCount: number;
	changesOverflow: boolean;
	districtsChanged: boolean;
	/** Renderer tiles whose district palette changed this tick. */
	districtTiles: number[];
	events: SimEvent[];
	snapshot: GameSnapshot;
}

export type BotDifficulty = 'relaxed' | 'standard' | 'ruthless';

export interface SimulationOptions {
	seed: number;
	width?: number;
	height?: number;
	playerCount?: number;
	growthMode?: GrowthMode;
	botDifficulty?: BotDifficulty;
	/** 0 disables the timer. At expiry the largest alive state wins. */
	matchDurationTicks?: number;
	/** Optional evolved genomes per player id-1; null keeps the default profile. */
	botGenomes?: readonly (BotGenome | null)[];
	/** Evolution/spectator mode: make every seat, including the human seat, a bot. */
	allPlayersBots?: boolean;
	/** Optional team id per player (1-indexed array); 0 means free-for-all. */
	teamIds?: readonly number[];
}

const CHANGE_BUFFER_SIZE = 16_384;
/** Keep the full annex scan off the bot decision tick. */
const ANNEX_PHASE_OFFSET_TICKS = 5;
/** Annex transfers are applied across ticks so a large cleanup cannot block a frame. */
const ANNEX_TRANSFER_BUDGET = 500;

interface AnnexTransfer {
	index: number;
	from: number;
	to: number;
}

function indexToX(index: number, width: number): number {
	return index % width;
}

function indexToY(index: number, width: number): number {
	return (index - (index % width)) / width;
}

export class TerritorySimulation {
	readonly seed: number;
	readonly width: number;
	readonly height: number;
	readonly playerCount: number;
	readonly map: GeneratedMap;
	readonly botDifficulty: BotDifficulty;
	private readonly allPlayersBots: boolean;
	readonly matchDurationTicks: number;
	readonly owners: Uint16Array;
	/** Attack id that most recently captured each cell; 0 for starting land. */
	readonly claimedBy: Uint32Array;
	/** Structure aura defense bonus per cell. Derived from live structures. */
	private readonly auraDefense: Uint16Array;
	/** Structure type code of the district covering each cell, or 0. */
	readonly districtTypes: Uint8Array;
	/** Structure id owning each district cell, or 0. */
	readonly districtStructureIds: Uint32Array;
	/** Compact 5-bit render palette code for the district; 0 = none. */
	readonly districtColorCodes: Uint8Array;
	private districtsChanged = false;
	private readonly districtDirtyTiles = new Set<number>();
	readonly players: PlayerState[];

	tick = 0;
	winnerId: number | null = null;
	ended = false;
	growthMode: GrowthMode;
	gold = STARTING_GOLD;
	hand: Card[] = [];

	private pendingGrowthMode: GrowthMode | null = null;
	private goldAccrual = 0;
	private attackOrders: number[] = [];
	private artilleryShells: ArtilleryShell[] = [];
	private nextShellId = 1;
	/** structure id -> earliest tick it may fire again. */
	private readonly artilleryCooldownUntil = new Map<number, number>();
	private readonly botGold: number[];
	private readonly botGoldAccrual: Uint16Array;
	private readonly botProfiles: BotProfile[];
	/** Per-defender grievance counts, indexed defender * PLAYER_COUNT + attacker. */
	private readonly botGrievance: Uint16Array;
	private readonly botPressure: Uint16Array;
	/** Integer threat score per bot, refreshed once per decision tick. */
	private readonly botThreat: Uint16Array;
	/** 1 while a bot is in defensive posture. Hysteresis avoids per-tick flapping. */
	private readonly botDefensive: Uint8Array;
	/** Gold a threatened bot withholds from non-defence spending. */
	private readonly botReserve: Uint8Array;
	/** Consecutive build intervals without an affordable defensive action. */
	private readonly botDefenseStall: Uint8Array;
	/** Supply-income deficit versus the strongest bordering neighbour. */
	private readonly botIncomeGap: Uint8Array;
	/** Military-strength deficit versus the strongest bordering neighbour. */
	private readonly botDeterrence: Uint16Array;
	/** Non-gameplay counters for AI balancing and post-match analysis. */
	private readonly botTelemetry: BotBehaviorTelemetry = {
		threatenedFortificationBuilds: 0,
		threatenedFortificationUpgrades: 0,
		deterrencePostures: 0,
		incomeGapCommandPosts: 0,
		incomeGapWarAcademies: 0,
		opportunityAttacks: 0,
		botPortBuilds: 0,
		botNavalLandings: 0,
		optionSelections: emptyOptionCounts()
	};
	/** Strategic option layer: committed goal, expiry, and optional target player. */
	private readonly botOption: Uint8Array;
	private readonly botOptionUntil: Uint32Array;
	private readonly botOptionTarget: Uint16Array;
	/** Semi-Markov strategic controller runtime state. */
	private readonly botMarkovState: Uint8Array;
	private readonly botMarkovEntry: Uint32Array;
	private readonly botMarkovBias: Uint8Array;
	/** Reuse only a positive expansion result; a negative one can block attacks. */
	private readonly botExpansionCached: Uint8Array;
	private readonly botExpansionTick: Uint32Array;
	/** Per-bot decision cadence and stable attack-roll epoch. */
	private readonly botDecisionEpoch: Uint32Array;
	private readonly botStrengthCache: Uint32Array;
	private botStrengthCacheReady = false;
	/** Scratch cache for per-defender target utility within one decision. */
	private readonly botTargetScoreStamp: Uint32Array;
	private readonly botTargetScore: Int32Array;
	private readonly botTargetOpportunity: Uint8Array;
	private botTargetStamp = 0;
	/** Last player to launch a front against this bot (blackboard memory). */
	private readonly botLastAttacker: Uint16Array;
	/** Last player to capture one of this player's cells, for elimination credit. */
	private readonly lastAttackerOf: Uint16Array;
	/** Permanent elimination rewards, one stack per state erased. */
	private readonly eliminationIncomeStacks: Uint32Array;
	private readonly botPlayerMetrics: BotPlayerBehaviorMetrics[];
	/** Grievance total each bot held at the previous threat refresh. */
	private readonly botGrievanceMark: Uint32Array;
	/** botAttackers[attacker * PLAYER_COUNT + defender] = 1 while a front is live. */
	private readonly botAttackers: Uint8Array;
	private readonly rng: DeterministicRng;
	private readonly land: Uint8Array;
	private readonly shade: Uint8Array;
	private readonly elevation: Uint8Array;
	private landCount: number;
	private readonly seaComponents: Uint32Array;
	private readonly seaRouter: SeaRouter;
	private readonly shoreIndices: number[] = [];
	/** Scratch land-component labels used for Port annexation protection. */
	private readonly portComponentOf: Uint32Array;
	private readonly portComponentQueue: Uint32Array;
	private portVisitToken = 0;
	/** Reuse one land-component walk for multiple Ports in this scan. */
	private readonly portComponentMeta = new Map<
		number,
		{ ownerId: number; reachesState: boolean }
	>();
	private navalLandings: NavalLanding[] = [];
	private nextNavalId = 1;
	private attacks: AttackState[] = [];
	private nextAttackId = 1;
	private pendingCommands: GameCommand[] = [];
	private nextCommandSequence = 1;
	private events: SimEvent[] = [];
	private nextEventId = 1;
	private changes = new Uint32Array(CHANGE_BUFFER_SIZE);
	private changeCount = 0;
	private changesOverflow = false;
	private lastSnapshot: GameSnapshot | null = null;
	private annexRequested = false;
	private lastAnnexTick = -ANNEX_INTERVAL_TICKS;
	private annexTransferQueue: AnnexTransfer[] = [];
	private annexTransferIndex = 0;
	private ownershipChangedSinceAnnex = true;
	private ownershipChangedSinceCleanup = true;
	private ownershipVersion = 0;
	/** Per-player/type build-site lookups valid for one tick and structure layout. */
	private buildSiteCache = new Int32Array(0);
	private needsExpansionCache = new Int8Array(0);
	private needsExpansionCacheOwnershipVersion = -1;
	private needsExpansionCacheStructureVersion = -1;
	private needsExpansionCacheLayoutVersion = -1;
	private buildSiteCacheTick = -1;
	private buildSiteCacheVersion = -1;
	private buildSiteCacheLayoutVersion = -1;
	/** Port/core sites are tick-independent and can survive across ticks. */
	private stableBuildSiteCache = new Int32Array(0);
	private stableBuildSiteTick = new Uint32Array(0);
	private stableBuildSiteCacheVersion = -1;
	private stableBuildSiteCacheLayoutVersion = -1;
	private readonly integrity: TerritoryIntegrity;
	readonly structures: StructureRegistry;
	/** Derived stack totals per owner/type code; refreshed only when the registry mutates. */
	private readonly structureStacksByType: Uint32Array;
	private structureCacheVersion = -1;
	private mergedGroupsCache: MergedDistrictGroup[] = [];
	private mergedGroupsLayoutVersion = -1;
	private mergedGroupsComputedTick = -1000;

	constructor(options: SimulationOptions) {
		this.seed = options.seed >>> 0;
		this.allPlayersBots = options.allPlayersBots === true;
		const playerCount = Math.trunc(options.playerCount ?? PLAYER_COUNT);
		if (playerCount < 2 || playerCount > MAX_PLAYER_COUNT) {
			throw new Error(`playerCount must be between 2 and ${MAX_PLAYER_COUNT}.`);
		}
		this.playerCount = playerCount;
		this.botDifficulty = options.botDifficulty ?? 'standard';
		this.matchDurationTicks =
			options.matchDurationTicks === undefined
				? 0
				: Math.max(0, Math.trunc(options.matchDurationTicks));
		this.growthMode =
			options.growthMode && isGrowthMode(options.growthMode)
				? options.growthMode
				: DEFAULT_GROWTH_MODE;
		this.map = generateMap(this.seed, {
			width: options.width,
			height: options.height,
			playerCount: this.playerCount
		});
		this.width = this.map.width;
		this.height = this.map.height;
		this.structureStacksByType = new Uint32Array(this.playerCount * 8);
		this.land = this.map.land;
		this.shade = this.map.shade;
		this.elevation = this.map.elevation;
		this.landCount = this.map.landCount;
		this.seaComponents = computeSeaComponents(this.land, this.width, this.height);
		this.seaRouter = new SeaRouter(this.land, this.width, this.height);
		for (let index = 0; index < this.land.length; index++) {
			if (isShoreIndex(this.land, this.width, this.height, index)) {
				this.shoreIndices.push(index);
			}
		}
		this.portComponentOf = new Uint32Array(this.width * this.height);
		this.portComponentQueue = new Uint32Array(this.width * this.height);
		this.owners = new Uint16Array(this.width * this.height);
		this.claimedBy = new Uint32Array(this.width * this.height);
		this.auraDefense = new Uint16Array(this.width * this.height);
		this.districtTypes = new Uint8Array(this.width * this.height);
		this.districtStructureIds = new Uint32Array(this.width * this.height);
		this.districtColorCodes = new Uint8Array(this.width * this.height);
		this.integrity = new TerritoryIntegrity(this.width, this.height, this.playerCount);

		if (this.landCount <= 0) throw new Error('Generated map has no land.');

		this.players = Array.from({ length: this.playerCount }, (_, i) => ({
			id: i + 1,
			name: PLAYER_NAMES[i] ?? `State ${i + 1}`,
			isBot: options.allPlayersBots === true || i !== HUMAN_PLAYER_ID - 1,
			alive: true,
			territory: 0,
			teamId: Math.max(0, Math.trunc(options.teamIds?.[i] ?? 0)),
			border: new Set<number>()
		}));

		this.rng = new DeterministicRng((this.seed ^ 0x6a09e667) >>> 0);
		this.botGold = new Array<number>(this.playerCount).fill(0);
		this.buildSiteCache = new Int32Array(this.playerCount * BUILDABLE_STRUCTURE_TYPES.length).fill(
			-2
		);
		this.stableBuildSiteCache = new Int32Array(this.playerCount * 4).fill(-2);
		this.stableBuildSiteTick = new Uint32Array(this.playerCount * 4);
		this.needsExpansionCache = new Int8Array(this.playerCount).fill(-1);
		this.botGoldAccrual = new Uint16Array(this.playerCount);
		this.botGrievance = new Uint16Array(this.playerCount * this.playerCount);
		this.botPressure = new Uint16Array(this.playerCount);
		this.botThreat = new Uint16Array(this.playerCount);
		this.botDefensive = new Uint8Array(this.playerCount);
		this.botReserve = new Uint8Array(this.playerCount);
		this.botDefenseStall = new Uint8Array(this.playerCount);
		this.botIncomeGap = new Uint8Array(this.playerCount);
		this.botDeterrence = new Uint16Array(this.playerCount);
		this.botOption = new Uint8Array(this.playerCount);
		this.botOptionUntil = new Uint32Array(this.playerCount);
		this.botOptionTarget = new Uint16Array(this.playerCount);
		this.botMarkovState = new Uint8Array(this.playerCount);
		this.botMarkovEntry = new Uint32Array(this.playerCount);
		this.botMarkovBias = new Uint8Array(this.playerCount * 5);
		this.botExpansionCached = new Uint8Array(this.playerCount);
		this.botExpansionTick = new Uint32Array(this.playerCount);
		this.botDecisionEpoch = new Uint32Array(this.playerCount);
		this.botStrengthCache = new Uint32Array(this.playerCount);
		this.botTargetScoreStamp = new Uint32Array(this.playerCount + 1);
		this.botTargetScore = new Int32Array(this.playerCount + 1);
		this.botTargetOpportunity = new Uint8Array(this.playerCount + 1);
		this.botLastAttacker = new Uint16Array(this.playerCount);
		this.lastAttackerOf = new Uint16Array(this.playerCount);
		this.eliminationIncomeStacks = new Uint32Array(this.playerCount);
		this.botPlayerMetrics = Array.from({ length: this.playerCount }, () => ({
			attacksLaunched: 0,
			supportedAttacks: 0,
			fortificationsBuilt: 0,
			fortificationUpgrades: 0,
			commandPostsBuilt: 0,
			warAcademiesBuilt: 0,
			portsBuilt: 0,
			navalLandings: 0,
			statesEliminated: 0,
			attacksVsWeakerStates: 0,
			attacksRepelled: 0,
			defenseDamage: 0
		}));
		this.botGrievanceMark = new Uint32Array(this.playerCount);
		this.botAttackers = new Uint8Array(this.playerCount * this.playerCount);
		this.botProfiles = Array.from({ length: this.playerCount }, (_, index) => {
			const genome = options.botGenomes?.[index] ?? null;
			return genome ? this.createProfileFromGenome(genome) : this.createBotProfile(index + 1);
		});
		for (let index = 0; index < this.playerCount; index++) {
			const controller = this.botProfiles[index].markov;
			if (controller) this.enterBotMarkovState(index, controller.initial);
		}
		for (const player of this.players) {
			if (player.isBot) this.botGold[player.id - 1] = BOT_STARTING_GOLD;
		}

		this.placeStartingTerritories(this.map.starts);
		this.ensureEveryStateHasLand();
		this.rebuildBorders();

		this.structures = new StructureRegistry();
		for (let i = 0; i < this.map.starts.length; i++) {
			const start = this.map.starts[i];
			this.structures.create('state', i + 1, start.x, start.y, this.width);
		}
		this.rebuildDistricts();
		this.rebuildAuraDefense();
		this.hand = BUILDABLE_STRUCTURE_TYPES.map((type, index) => ({ id: index + 1, type }));
		this.attackOrders = new Array<number>(this.playerCount).fill(0);
		this.setSupply(HUMAN_PLAYER_ID, STARTING_GOLD);
		for (const player of this.players) {
			if (player.isBot) this.setSupply(player.id, BOT_STARTING_GOLD);
		}

		this.pushEvent('system', `${this.playerCount} states deployed. Attack freely.`);
	}

	/**
	 * Select the growth layer for attacks created from the next tick onward.
	 * Existing orders retain the layer they were created with. This is a test
	 * control; a networked build must carry this as authoritative match config
	 * or a tick-stamped command.
	 */
	setGrowthMode(mode: GrowthMode): void {
		if (isGrowthMode(mode)) this.pendingGrowthMode = mode;
	}

	get income(): number {
		return this.supplyIncomeFor(HUMAN_PLAYER_ID);
	}

	/**
	 * Effects are queried every tick and on every launch. Cache total structure
	 * stacks per owner/type so high-frequency triggers are O(types), not O(structures).
	 */
	private ensureStructureCache(): void {
		const version = this.structures.version;
		if (version === this.structureCacheVersion) return;
		this.structureStacksByType.fill(0);
		for (const structure of this.structures.all) {
			const slot = (structure.ownerId - 1) * 8 + (STRUCTURE_TYPE_CODES[structure.type] - 1);
			this.structureStacksByType[slot] += structure.stacks;
		}
		this.structureCacheVersion = version;
	}

	private stacksOfType(playerId: number, type: StructureType): number {
		this.ensureStructureCache();
		return this.structureStacksByType[(playerId - 1) * 8 + (STRUCTURE_TYPE_CODES[type] - 1)];
	}

	getBarracksLevels(playerId: number): number {
		return this.stacksOfType(playerId, 'barracks');
	}

	private jammerLevels(playerId: number): number {
		return this.stacksOfType(playerId, 'jammer');
	}

	private supplyIncomeFor(playerId: number): number {
		const player = this.players[playerId - 1];
		if (!player) return 0;
		let income =
			BASE_GOLD_INCOME +
			Math.floor(player.territory / SUPPLY_INCOME_TERRITORY_DIVISOR) +
			this.eliminationIncomeStacks[playerId - 1] * ELIMINATION_SUPPLY_INCOME_BONUS;
		for (const type of STRUCTURE_TYPES) {
			const stacks = this.stacksOfType(playerId, type);
			if (stacks === 0) continue;
			for (const effect of STRUCTURE_DEFINITIONS[type].effects) {
				if (effect.kind === 'supply-income') income += effect.perSecond * stacks;
			}
		}
		return income;
	}

	/** Public economy read for telemetry and the evolution fitness function. */
	incomeOf(playerId: number): number {
		return this.supplyIncomeFor(playerId);
	}

	/** Non-gameplay AI behavior counters for balancing and analysis. */
	getBotBehaviorTelemetry(): BotBehaviorTelemetry {
		return {
			...this.botTelemetry,
			optionSelections: { ...this.botTelemetry.optionSelections }
		};
	}

	getBotOption(playerId: number): BotOptionId | null {
		return botOptionFromCode(this.botOption[playerId - 1] ?? 0);
	}

	getBotMarkovState(playerId: number): number | null {
		return this.botProfiles[playerId - 1]?.markov ? (this.botMarkovState[playerId - 1] ?? 0) : null;
	}

	getPlayerBehaviorMetrics(playerId: number): BotPlayerBehaviorMetrics {
		const metrics = this.botPlayerMetrics[playerId - 1];
		return metrics
			? { ...metrics }
			: {
					attacksLaunched: 0,
					supportedAttacks: 0,
					fortificationsBuilt: 0,
					fortificationUpgrades: 0,
					commandPostsBuilt: 0,
					warAcademiesBuilt: 0,
					portsBuilt: 0,
					navalLandings: 0,
					statesEliminated: 0,
					attacksVsWeakerStates: 0,
					attacksRepelled: 0,
					defenseDamage: 0
				};
	}

	supplyCap(playerId: number): number {
		const player = this.players[playerId - 1];
		if (!player) return SUPPLY_CAP_BASE;
		let cap = SUPPLY_CAP_BASE + Math.floor(player.territory / SUPPLY_CAP_TERRITORY_DIVISOR);
		for (const type of STRUCTURE_TYPES) {
			const stacks = this.stacksOfType(playerId, type);
			if (stacks === 0) continue;
			for (const effect of STRUCTURE_DEFINITIONS[type].effects) {
				if (effect.kind === 'supply-cap') cap += effect.amount * stacks;
			}
		}
		return cap;
	}

	private supplyOf(playerId: number): number {
		if (playerId === HUMAN_PLAYER_ID && !this.allPlayersBots) return this.gold;
		return this.botGold[playerId - 1] ?? 0;
	}

	private setSupply(playerId: number, value: number): void {
		const clamped = Math.max(0, Math.min(this.supplyCap(playerId), value));
		if (playerId === HUMAN_PLAYER_ID && !this.allPlayersBots) this.gold = clamped;
		else this.botGold[playerId - 1] = clamped;
	}

	private creditSupply(playerId: number, amount: number): void {
		if (amount <= 0) return;
		this.setSupply(playerId, this.supplyOf(playerId) + amount);
	}

	private spendSupply(playerId: number, amount: number): boolean {
		if (amount < 0 || this.supplyOf(playerId) < amount) return false;
		this.setSupply(playerId, this.supplyOf(playerId) - amount);
		return true;
	}

	getAttackStats(
		attackerId: number,
		defenderId: number
	): {
		levels: number;
		effectiveLevels: number;
		logTier: number;
		power: number;
		pierce: number;
		strength: number;
		cost: number;
	} {
		const levels = this.getBarracksLevels(attackerId);
		const suppression = defenderId > 0 ? this.jammerLevels(defenderId) : 0;
		const effectiveLevels = Math.max(0, levels - suppression);
		const logTier = effectiveLevels > 0 ? 31 - Math.clz32(effectiveLevels + 1) : 0;
		return {
			levels,
			effectiveLevels,
			logTier,
			power: ATTACK_DAMAGE_PER_TICK + logTier * ATTACK_ORDER_DAMAGE_BONUS,
			pierce: logTier * ATTACK_ORDER_DEFENSE_PIERCE,
			strength: ATTACK_STRENGTH_BASE + effectiveLevels * ATTACK_STRENGTH_BONUS,
			cost: ATTACK_SUPPLY_COST_BASE + effectiveLevels * ATTACK_SUPPLY_COST_BONUS
		};
	}

	private attackSupplyCost(attackerId: number, defenderId: number): number {
		return this.getAttackStats(attackerId, defenderId).cost;
	}

	private affordableAttackCount(attackerId: number, defenderId: number): number {
		const cost = this.attackSupplyCost(attackerId, defenderId);
		if (cost <= 0) return 0;
		return Math.floor(this.supplyOf(attackerId) / cost);
	}

	/**
	 * Supply accrues continuously from territory and live resource structures.
	 * Rates are per second and converted with an integer remainder at 10 Hz.
	 */
	private accrueResources(): void {
		if (!this.allPlayersBots) {
			this.goldAccrual += this.income * TICK_RATE;
			const earnedGold = Math.floor(this.goldAccrual / INCOME_INTERVAL_TICKS);
			if (earnedGold > 0) {
				this.creditSupply(HUMAN_PLAYER_ID, earnedGold);
				this.goldAccrual -= earnedGold * INCOME_INTERVAL_TICKS;
			}
		}

		for (const player of this.players) {
			if (!player.alive || !player.isBot) continue;
			const rate = this.supplyIncomeFor(player.id);
			this.botGoldAccrual[player.id - 1] += rate * TICK_RATE;
			const earned = Math.floor(this.botGoldAccrual[player.id - 1] / INCOME_INTERVAL_TICKS);
			if (earned > 0) {
				this.creditSupply(player.id, earned);
				this.botGoldAccrual[player.id - 1] -= earned * INCOME_INTERVAL_TICKS;
			}
		}
	}

	private pendingAttackSupply(playerId: number): number {
		let reserved = 0;
		for (const command of this.pendingCommands) {
			if (command.type !== 'attack' || command.playerId !== playerId) continue;
			const index = command.y * this.width + command.x;
			const defenderId = index >= 0 && index < this.owners.length ? this.owners[index] : 0;
			reserved += this.attackSupplyCost(playerId, defenderId);
		}
		return reserved;
	}

	/** Queue a human attack. It is applied at the start of the next tick. */
	enqueueAttack(playerId: number, x: number, y: number): AttackOrderResult {
		const validation = this.validateAttack(playerId, x, y);
		if (!validation.ok) return validation;

		this.pendingCommands.push({
			type: 'attack',
			playerId,
			x: Math.floor(x),
			y: Math.floor(y),
			sequence: this.nextCommandSequence++
		});

		return validation;
	}

	/** Cancel one active front and refund its remaining strength share. */
	cancelAttack(playerId: number, attackId: number): AttackOrderResult {
		const attack = this.attacks.find(
			(entry) => entry.id === attackId && entry.attackerId === playerId && !entry.done
		);
		if (!attack) return fail('invalid', 'That front is no longer active.');
		const refund = Math.floor((attack.supplyCost * attack.strength) / attack.initialStrength);
		attack.done = true;
		this.creditSupply(playerId, refund);
		this.attacks = this.attacks.filter((entry) => !entry.done);
		this.pushEvent('attack', `Front #${attack.id} cancelled; ${refund} supply refunded.`, playerId);
		this.lastSnapshot = this.buildSnapshot();
		return { ok: true, message: `Front cancelled. ${refund} supply refunded.` };
	}

	/** Queue demolition of one owned, non-State structure. */
	demolishStructure(playerId: number, structureId: number): BuildOrderResult {
		const fail = (reason: BuildFailure, message: string): BuildOrderResult => ({
			ok: false,
			reason,
			message
		});
		if (this.ended) return fail('ended', 'The conflict is over.');
		const player = this.players[playerId - 1];
		if (!player?.alive) return fail('eliminated', 'Your state has been eliminated.');
		const structure = this.structures.byId(structureId);
		if (!structure || this.owners[structure.index] !== playerId) {
			return fail('invalid', 'That structure is no longer here.');
		}
		if (structure.ownerId !== playerId) {
			return fail('not-owned', 'You can only demolish your own structures.');
		}
		if (structure.type === 'state') {
			return fail('invalid', 'The State structure cannot be demolished.');
		}
		this.pendingCommands.push({
			type: 'demolish',
			playerId,
			structureId,
			sequence: this.nextCommandSequence++
		});
		return { ok: true, message: 'Demolition ordered.' };
	}

	/** Cancel the most recently launched active front for a player. */
	cancelLatestAttack(playerId: number): AttackOrderResult {
		let latest: AttackState | null = null;
		for (const attack of this.attacks) {
			if (attack.attackerId !== playerId || attack.done) continue;
			if (!latest || attack.id > latest.id) latest = attack;
		}
		if (!latest) return fail('invalid', 'No active fronts to cancel.');
		return this.cancelAttack(playerId, latest.id);
	}

	private artilleryReadyAt(structure: Structure): number {
		return this.artilleryCooldownUntil.get(structure.id) ?? 0;
	}

	private artilleryBatteries(playerId: number, targetX: number, targetY: number): Structure[] {
		const rangeSq = ARTILLERY_RANGE * ARTILLERY_RANGE;
		const batteries: Structure[] = [];
		for (const structure of this.structures.forOwner(playerId)) {
			if (structure.type !== 'artillery') continue;
			if (this.artilleryReadyAt(structure) > this.tick) continue;
			const dx = structure.x - targetX;
			const dy = structure.y - targetY;
			if (dx * dx + dy * dy > rangeSq) continue;
			batteries.push(structure);
		}
		batteries.sort((a, b) => a.id - b.id);
		return batteries;
	}

	/** Snap a click to a nearby hostile structure so artillery targeting stays usable. */
	private snapArtilleryTarget(playerId: number, x: number, y: number): { x: number; y: number } {
		if (ARTILLERY_TARGET_SNAP_RADIUS <= 0) return { x, y };
		const radiusSq = ARTILLERY_TARGET_SNAP_RADIUS * ARTILLERY_TARGET_SNAP_RADIUS;
		let best: Structure | null = null;
		let bestDistance = radiusSq + 1;
		for (const structure of this.structures.all) {
			if (structure.ownerId === playerId) continue;
			const dx = structure.x - x;
			const dy = structure.y - y;
			const distance = dx * dx + dy * dy;
			if (distance > radiusSq) continue;
			if (
				distance < bestDistance ||
				(distance === bestDistance && structure.id < (best?.id ?? 0))
			) {
				best = structure;
				bestDistance = distance;
			}
		}
		return best ? { x: best.x, y: best.y } : { x, y };
	}

	/** Queue one active artillery volley. It resolves at the start of the next tick. */
	enqueueArtillery(playerId: number, x: number, y: number): AttackOrderResult {
		const validation = this.validateArtillery(playerId, x, y);
		if (!validation.ok) return validation;
		const target = this.snapArtilleryTarget(playerId, Math.floor(x), Math.floor(y));
		this.pendingCommands.push({
			type: 'artillery',
			playerId,
			x: target.x,
			y: target.y,
			sequence: this.nextCommandSequence++
		});
		return validation;
	}

	validateArtillery(playerId: number, x: number, y: number): AttackOrderResult {
		if (this.ended) return fail('ended', 'The conflict is over.');
		const player = this.players[playerId - 1];
		if (!player || !player.alive) return fail('eliminated', 'Your state has been eliminated.');
		const roundedX = Math.floor(x);
		const roundedY = Math.floor(y);
		if (roundedX < 0 || roundedY < 0 || roundedX >= this.width || roundedY >= this.height) {
			return fail('invalid', 'Outside the map.');
		}
		for (const command of this.pendingCommands) {
			if (command.type === 'artillery' && command.playerId === playerId) {
				return fail('cooling', 'An artillery barrage is already queued.');
			}
		}

		const target = this.snapArtilleryTarget(playerId, roundedX, roundedY);
		const batteries = this.artilleryBatteries(playerId, target.x, target.y);
		if (batteries.length > 0) {
			const levels = batteries.reduce((total, battery) => total + battery.stacks, 0);
			const cost = levels * ARTILLERY_SUPPLY_COST_PER_LEVEL;
			if (this.supplyOf(playerId) < cost) {
				return fail('no-supply', `Need ${cost} supply to fire ${levels} shells.`);
			}
			return {
				ok: true,
				message: `${batteries.length} artillery ${batteries.length === 1 ? 'battery' : 'batteries'} ready: ${levels} shells for ${cost} supply.`
			};
		}

		let hasArtillery = false;
		let hasReady = false;
		for (const structure of this.structures.forOwner(playerId)) {
			if (structure.type !== 'artillery') continue;
			hasArtillery = true;
			if (this.artilleryReadyAt(structure) <= this.tick) hasReady = true;
		}
		if (!hasArtillery) return fail('no-artillery', 'Build an Artillery card first.');
		if (!hasReady) return fail('cooling', 'All artillery is reloading.');
		return fail('out-of-range', 'No ready artillery can reach that point.');
	}

	/** Queue a naval landing from any friendly port to this shore. */
	enqueueNavalAttack(playerId: number, x: number, y: number): AttackOrderResult {
		const validation = this.validateNavalAttack(playerId, x, y);
		if (!validation.ok) return validation;
		this.pendingCommands.push({
			type: 'naval',
			playerId,
			x: Math.floor(x),
			y: Math.floor(y),
			sequence: this.nextCommandSequence++
		});
		return validation;
	}

	validateNavalAttack(playerId: number, x: number, y: number): AttackOrderResult {
		const fail = (reason: AttackFailure, message: string): AttackOrderResult => ({
			ok: false,
			reason,
			message
		});
		if (this.ended) return fail('ended', 'The conflict is over.');
		const player = this.players[playerId - 1];
		if (!player || !player.alive) return fail('eliminated', 'Your state has been eliminated.');
		const roundedX = Math.floor(x);
		const roundedY = Math.floor(y);
		if (roundedX < 0 || roundedY < 0 || roundedX >= this.width || roundedY >= this.height) {
			return fail('invalid', 'Choose a shore inside the map.');
		}
		const index = roundedY * this.width + roundedX;
		if (!this.land[index]) return fail('ocean', 'Naval landings target a shore.');
		if (!isShoreIndex(this.land, this.width, this.height, index)) {
			return fail('not-shore', 'Ports can only land on shoreline cells.');
		}
		const targetOwner = this.owners[index];
		if (targetOwner === playerId) return fail('friendly-shore', 'That shore is already friendly.');
		if (this.structures.at(index)) {
			return fail('invalid', 'A structure occupies that shore.');
		}
		const ports = this.structures.forOwner(playerId).filter((entry) => entry.type === 'port');
		if (ports.length === 0) return fail('no-port', 'Build a Port before launching a landing.');
		const cost = this.attackSupplyCost(playerId, targetOwner) + STRUCTURE_DEFINITIONS.port.cost;
		if (
			this.supplyOf(playerId) -
				this.pendingAttackSupply(playerId) -
				this.pendingNavalSupply(playerId) <
			cost
		) {
			return fail('no-supply', `Need ${cost} supply for a naval landing.`);
		}
		const route = this.findNavalRoute(playerId, index);
		if (!route) return fail('no-sea-path', 'No sea route reaches that shore.');
		return { ok: true, message: `Naval landing ordered for ${cost} supply.` };
	}

	private navalSupplyCost(playerId: number, targetIndex: number): number {
		return (
			this.attackSupplyCost(playerId, this.owners[targetIndex]) + STRUCTURE_DEFINITIONS.port.cost
		);
	}

	private pendingNavalSupply(playerId: number): number {
		let total = 0;
		for (const command of this.pendingCommands) {
			if (command.type !== 'naval' || command.playerId !== playerId) continue;
			total += this.navalSupplyCost(playerId, command.y * this.width + command.x);
		}
		return total;
	}

	private findNavalRoute(
		playerId: number,
		targetIndex: number
	): { port: Structure; path: Uint32Array; targetWater: number } | null {
		const ports = this.structures
			.forOwner(playerId)
			.filter((entry) => entry.type === 'port')
			.sort((left, right) => {
				const leftDistance =
					Math.abs(left.x - (targetIndex % this.width)) +
					Math.abs(left.y - Math.floor(targetIndex / this.width));
				const rightDistance =
					Math.abs(right.x - (targetIndex % this.width)) +
					Math.abs(right.y - Math.floor(targetIndex / this.width));
				return leftDistance - rightDistance || left.id - right.id;
			});
		if (ports.length === 0) return null;
		const targetWater: number[] = [];
		adjacentWater(this.land, this.width, this.height, targetIndex, targetWater);
		if (targetWater.length === 0) return null;

		let best: { port: Structure; path: Uint32Array; targetWater: number } | null = null;
		outer: for (const port of ports) {
			const sourceWater: number[] = [];
			adjacentWater(this.land, this.width, this.height, port.index, sourceWater);
			targetWater.sort((left, right) => {
				const leftDistance =
					Math.abs((left % this.width) - port.x) + Math.abs(Math.floor(left / this.width) - port.y);
				const rightDistance =
					Math.abs((right % this.width) - port.x) +
					Math.abs(Math.floor(right / this.width) - port.y);
				return leftDistance - rightDistance || left - right;
			});
			for (const start of sourceWater) {
				for (const end of targetWater) {
					if (this.seaComponents[start] !== this.seaComponents[end]) continue;
					const path = this.seaRouter.findPath(start, end);
					if (!path) continue;
					best = { port, path, targetWater: end };
					break outer;
				}
			}
		}
		return best;
	}

	private tryLaunchNaval(playerId: number, x: number, y: number): boolean {
		const validation = this.validateNavalAttack(playerId, x, y);
		if (!validation.ok) return false;
		const index = Math.floor(y) * this.width + Math.floor(x);
		const route = this.findNavalRoute(playerId, index);
		if (!route) return false;
		const cost = this.navalSupplyCost(playerId, index);
		if (!this.spendSupply(playerId, cost)) return false;
		const path = Array.from(route.path);
		path.push(index);
		const distance = Math.max(1, path.length - 1);
		const travelTicks = Math.max(1, Math.ceil((distance / NAVAL_SPEED_PX_PER_SECOND) * TICK_RATE));
		this.navalLandings.push({
			id: this.nextNavalId++,
			ownerId: playerId,
			portId: route.port.id,
			targetIndex: index,
			path,
			launchedAtTick: this.tick,
			arriveAtTick: this.tick + travelTicks
		});
		this.pushEvent(
			'naval',
			`${this.players[playerId - 1].name} launches a naval landing.`,
			playerId
		);
		return true;
	}

	private processNavalLandings(): void {
		if (this.navalLandings.length === 0) return;
		const remaining: NavalLanding[] = [];
		for (const landing of this.navalLandings) {
			if (this.tick < landing.arriveAtTick) {
				remaining.push(landing);
				continue;
			}
			this.completeNavalLanding(landing);
		}
		this.navalLandings = remaining;
	}

	private completeNavalLanding(landing: NavalLanding): void {
		const owner = this.players[landing.ownerId - 1];
		if (!owner?.alive) return;
		const index = landing.targetIndex;
		if (!this.land[index] || !isShoreIndex(this.land, this.width, this.height, index)) return;
		if (this.owners[index] === landing.ownerId || this.structures.at(index)) return;

		const x = index % this.width;
		const y = (index - x) / this.width;
		this.claim(index, landing.ownerId);
		this.structures.create('port', landing.ownerId, x, y, this.width);
		this.pushEvent(
			'naval',
			`${owner.name}'s landing captures a beachhead and builds a Port.`,
			landing.ownerId
		);
		this.rebuildAuraDefense();

		let beachTarget = -1;
		let bestDefense = Number.POSITIVE_INFINITY;
		const neighbours = [
			x > 0 ? index - 1 : -1,
			x + 1 < this.width ? index + 1 : -1,
			y > 0 ? index - this.width : -1,
			y + 1 < this.height ? index + this.width : -1
		];
		for (const neighbour of neighbours) {
			if (neighbour < 0 || !this.land[neighbour]) continue;
			if (this.owners[neighbour] === landing.ownerId) continue;
			const defense = this.getDefense(neighbour % this.width, Math.floor(neighbour / this.width));
			if (defense < bestDefense) {
				bestDefense = defense;
				beachTarget = neighbour;
			}
		}
		if (beachTarget >= 0) {
			this.createAttack(landing.ownerId, beachTarget, [beachTarget]);
		}
	}

	private fireArtilleryVolley(playerId: number, x: number, y: number): number {
		const player = this.players[playerId - 1];
		if (!player?.alive) return 0;
		const target = this.snapArtilleryTarget(playerId, x, y);
		const batteries = this.artilleryBatteries(playerId, target.x, target.y);
		if (batteries.length === 0) return 0;
		const totalShells = batteries.reduce((total, battery) => total + battery.stacks, 0);
		const totalCost = totalShells * ARTILLERY_SUPPLY_COST_PER_LEVEL;
		if (!this.spendSupply(playerId, totalCost)) return 0;

		let shellsFired = 0;
		for (const battery of batteries) {
			this.artilleryCooldownUntil.set(battery.id, this.tick + ARTILLERY_COOLDOWN_TICKS);
			for (let shell = 0; shell < battery.stacks; shell++) {
				const hashX = hash32(this.seed ^ 0x9e3779b9, battery.id, shell);
				const hashY = hash32(this.seed ^ 0x85ebca6b, battery.id, shell);
				const spread = ARTILLERY_SHELL_SPREAD * 2 + 1;
				const targetX = Math.max(
					0,
					Math.min(this.width - 1, target.x + (hashX % spread) - ARTILLERY_SHELL_SPREAD)
				);
				const targetY = Math.max(
					0,
					Math.min(this.height - 1, target.y + (hashY % spread) - ARTILLERY_SHELL_SPREAD)
				);
				this.artilleryShells.push({
					id: this.nextShellId++,
					ownerId: playerId,
					fromX: battery.x,
					fromY: battery.y,
					targetX,
					targetY,
					launchedAtTick: this.tick,
					arriveAtTick: this.tick + ARTILLERY_SHELL_TRAVEL_TICKS
				});
				shellsFired++;
			}
		}
		if (playerId === HUMAN_PLAYER_ID) {
			this.pushEvent(
				'artillery',
				`Artillery fired ${shellsFired} ${shellsFired === 1 ? 'shell' : 'shells'} from ${batteries.length} ${
					batteries.length === 1 ? 'battery' : 'batteries'
				} for ${totalCost} supply.`,
				playerId
			);
		}
		return shellsFired;
	}

	private processArtilleryShells(): void {
		if (this.artilleryShells.length === 0) return;
		const remaining: ArtilleryShell[] = [];
		for (const shell of this.artilleryShells) {
			if (this.tick < shell.arriveAtTick) {
				remaining.push(shell);
				continue;
			}
			this.resolveArtilleryImpact(shell);
		}
		this.artilleryShells = remaining;
	}

	private resolveArtilleryImpact(shell: ArtilleryShell): void {
		const radiusSq = ARTILLERY_BLAST_RADIUS * ARTILLERY_BLAST_RADIUS;
		let target: Structure | null = null;
		let bestDistance = radiusSq + 1;
		for (const structure of this.structures.all) {
			if (structure.ownerId === shell.ownerId) continue;
			if (structure.type === 'state') continue;
			const dx = structure.x - shell.targetX;
			const dy = structure.y - shell.targetY;
			const distance = dx * dx + dy * dy;
			if (distance > radiusSq) continue;
			if (
				distance < bestDistance ||
				(distance === bestDistance && structure.id < (target?.id ?? 0))
			) {
				target = structure;
				bestDistance = distance;
			}
		}
		if (target) this.damageStructureWithArtillery(target);
	}

	private demolishStructureNow(playerId: number, structureId: number): void {
		const structure = this.structures.byId(structureId);
		if (!structure || structure.ownerId !== playerId) return;
		if (this.owners[structure.index] !== playerId) return;
		if (structure.type === 'state') return;

		this.structures.destroy(structure);
		this.artilleryCooldownUntil.delete(structure.id);
		this.refreshDistrictsAround(structure);
		this.rebuildAuraDefense();
		this.setSupply(structure.ownerId, this.supplyOf(structure.ownerId));
		if (structure.type === 'port') this.annexRequested = true;
		const owner = this.players[structure.ownerId - 1];
		const label = STRUCTURE_DEFINITIONS[structure.type].label;
		this.pushEvent(
			'structure',
			`${owner?.name ?? 'A state'} demolished a ${label}${structure.stacks > 1 ? ` (Lv.${structure.stacks})` : ''}.`,
			structure.ownerId
		);
	}

	private damageStructureWithArtillery(structure: Structure): void {
		const owner = this.players[structure.ownerId - 1];
		const label = STRUCTURE_DEFINITIONS[structure.type].label;
		if (structure.stacks > 1) {
			structure.stacks--;
			this.rebuildAuraDefense();
			this.pushEvent(
				'artillery',
				`${owner?.name ?? 'A state'}'s ${label} hit; now Lv.${structure.stacks}.`,
				structure.ownerId
			);
			return;
		}

		this.structures.destroy(structure);
		this.artilleryCooldownUntil.delete(structure.id);
		this.refreshDistrictsAround(structure);
		this.rebuildAuraDefense();
		this.setSupply(structure.ownerId, this.supplyOf(structure.ownerId));
		if (structure.type === 'state' || structure.type === 'port') this.annexRequested = true;
		this.pushEvent(
			'structure',
			structure.type === 'state'
				? `${owner?.name ?? 'A state'}'s State structure was destroyed by artillery. Its territory is no longer protected from annexation.`
				: `${owner?.name ?? 'A state'}'s ${label} was destroyed by artillery.`,
			structure.ownerId
		);
	}

	/** Validate a click against current state for immediate UI feedback. */
	validateAttack(playerId: number, x: number, y: number): AttackOrderResult {
		if (this.ended) return fail('ended', 'The conflict is over.');
		const player = this.players[playerId - 1];
		if (!player || !player.alive) return fail('eliminated', 'Your state has been eliminated.');

		const roundedX = Math.floor(x);
		const roundedY = Math.floor(y);
		if (roundedX < 0 || roundedY < 0 || roundedX >= this.width || roundedY >= this.height) {
			return fail('invalid', 'Outside the map.');
		}

		const index = roundedY * this.width + roundedX;
		if (!this.land[index]) return fail('ocean', 'Cannot take ocean pixels.');
		if (this.owners[index] === playerId) {
			return fail('own-territory', 'That territory is already yours.');
		}
		const target = this.owners[index];
		const cost = this.attackSupplyCost(playerId, target);
		const reserved = this.pendingAttackSupply(playerId);
		if (this.supplyOf(playerId) - reserved < cost) {
			return fail('no-orders', `Need ${cost} supply to launch a front.`);
		}
		if (this.findAttackSeeds(playerId, index).length === 0) {
			return fail('no-shared-border', 'No friendly border is close enough. Move your frontier.');
		}

		return {
			ok: true,
			message: target === 0 ? 'Expansion ordered.' : `Assault on ${this.players[target - 1].name}.`
		};
	}

	private hasDistrictWithin(x: number, y: number): boolean {
		const radius = ARTILLERY_BUILD_CLEARANCE;
		const radiusSq = radius * radius;
		const minX = Math.max(0, x - radius);
		const maxX = Math.min(this.width - 1, x + radius);
		const minY = Math.max(0, y - radius);
		const maxY = Math.min(this.height - 1, y + radius);
		for (let py = minY; py <= maxY; py++) {
			const dy = py - y;
			for (let px = minX; px <= maxX; px++) {
				const dx = px - x;
				if (dx * dx + dy * dy > radiusSq) continue;
				if (this.districtStructureIds[py * this.width + px] !== 0) return true;
			}
		}
		return false;
	}

	private isPortBuildSite(player: PlayerState, index: number): boolean {
		if (index < 0 || index >= this.owners.length) return false;
		if (this.owners[index] !== player.id) return false;
		if (!this.land[index] || !isShoreIndex(this.land, this.width, this.height, index)) {
			return false;
		}
		if (this.structures.at(index)) return false;
		const x = index % this.width;
		const y = (index - x) / this.width;
		return !this.structures.hasWithinRadius(x, y, STRUCTURE_MIN_SPACING);
	}

	/**
	 * Ports are hard to place pixel-perfectly. Resolve a nearby valid owned
	 * shoreline cell around the cursor (including water clicks near the coast)
	 * so the player does not need to hit a specific shoreline pixel.
	 */
	private resolvePortBuildCell(player: PlayerState, clickedIndex: number): number {
		if (this.isPortBuildSite(player, clickedIndex)) return clickedIndex;
		const clickedX = clickedIndex % this.width;
		const clickedY = Math.floor(clickedIndex / this.width);
		let best = -1;
		let bestDistance = Number.POSITIVE_INFINITY;
		const minX = Math.max(0, clickedX - PORT_BUILD_SNAP_RADIUS);
		const maxX = Math.min(this.width - 1, clickedX + PORT_BUILD_SNAP_RADIUS);
		const minY = Math.max(0, clickedY - PORT_BUILD_SNAP_RADIUS);
		const maxY = Math.min(this.height - 1, clickedY + PORT_BUILD_SNAP_RADIUS);
		for (let y = minY; y <= maxY; y++) {
			for (let x = minX; x <= maxX; x++) {
				const dx = x - clickedX;
				const dy = y - clickedY;
				const distance = dx * dx + dy * dy;
				if (distance > PORT_BUILD_SNAP_RADIUS * PORT_BUILD_SNAP_RADIUS) continue;
				const index = y * this.width + x;
				if (!this.isPortBuildSite(player, index)) continue;
				if (distance < bestDistance || (distance === bestDistance && index < best)) {
					best = index;
					bestDistance = distance;
				}
			}
		}
		return best;
	}

	/** Validate a card drop for immediate UI feedback. */
	validateBuild(playerId: number, cardId: number, x: number, y: number): BuildOrderResult {
		if (this.ended) return { ok: false, reason: 'ended', message: 'The conflict is over.' };
		const player = this.players[playerId - 1];
		if (!player?.alive) {
			return { ok: false, reason: 'eliminated', message: 'Your state has been eliminated.' };
		}
		if (playerId !== HUMAN_PLAYER_ID) {
			return { ok: false, reason: 'invalid', message: 'Only the human commander builds cards.' };
		}
		const card = this.hand.find((entry) => entry.id === cardId);
		if (!card) return { ok: false, reason: 'no-card', message: 'That card is no longer in hand.' };
		const baseCost = STRUCTURE_DEFINITIONS[card.type].cost;
		const roundedX = Math.floor(x);
		const roundedY = Math.floor(y);
		if (roundedX < 0 || roundedY < 0 || roundedX >= this.width || roundedY >= this.height) {
			return { ok: false, reason: 'invalid', message: 'Drop the card inside the map.' };
		}
		let index: number;
		let targetX = roundedX;
		let targetY = roundedY;
		if (card.type === 'port') {
			index = this.resolvePortBuildCell(player, roundedY * this.width + roundedX);
			if (index < 0) {
				return {
					ok: false,
					reason: 'not-shore',
					message: `Ports need owned shoreline within ${PORT_BUILD_SNAP_RADIUS} px with ${STRUCTURE_MIN_SPACING} px clearance.`
				};
			}
			targetX = index % this.width;
			targetY = (index - targetX) / this.width;
		} else {
			index = roundedY * this.width + roundedX;
			if (!this.land[index]) {
				return { ok: false, reason: 'ocean', message: 'Structures need land.' };
			}
			if (this.owners[index] !== playerId) {
				return {
					ok: false,
					reason: 'not-owned',
					message: 'Drop the card inside your controlled territory.'
				};
			}
		}
		const districtId = card.type === 'port' ? 0 : this.districtStructureIds[index];
		if (districtId !== 0) {
			const districtStructure = this.structures.byId(districtId);
			if (districtStructure?.ownerId === playerId && districtStructure.type === card.type) {
				const cost = baseCost + districtStructure.stacks * UPGRADE_LEVEL_COST_STEP;
				if (this.supplyOf(playerId) < cost) {
					return {
						ok: false,
						reason: 'no-gold',
						message: `Need ${cost} supply to upgrade ${STRUCTURE_DEFINITIONS[card.type].label} to Lv.${
							districtStructure.stacks + 1
						}.`
					};
				}
				return {
					ok: true,
					message: `Upgrade ${STRUCTURE_DEFINITIONS[card.type].label} to Lv.${
						districtStructure.stacks + 1
					} for ${cost} supply.`
				};
			}
			const districtType = structureTypeFromCode(this.districtTypes[index]);
			return {
				ok: false,
				reason: 'inside-district',
				message: `Cannot place this inside a ${
					districtType ? STRUCTURE_DEFINITIONS[districtType].label : 'different'
				} district.`
			};
		}

		if (card.type === 'artillery' && this.hasDistrictWithin(roundedX, roundedY)) {
			return {
				ok: false,
				reason: 'district-clearance',
				message: `Artillery needs ${ARTILLERY_BUILD_CLEARANCE} px of district-free ground.`
			};
		}

		if (this.structures.at(index)) {
			return { ok: false, reason: 'occupied', message: 'A structure already occupies that cell.' };
		}
		if (this.structures.hasWithinRadius(targetX, targetY, STRUCTURE_MIN_SPACING)) {
			return {
				ok: false,
				reason: 'too-close',
				message: `Structures must be at least ${STRUCTURE_MIN_SPACING} px apart.`
			};
		}

		if (this.supplyOf(playerId) < baseCost) {
			return {
				ok: false,
				reason: 'no-gold',
				message: `Need ${baseCost} supply to build ${STRUCTURE_DEFINITIONS[card.type].label}.`
			};
		}

		return {
			ok: true,
			message: `Build ${STRUCTURE_DEFINITIONS[card.type].label} for ${baseCost} supply.`,
			targetX: card.type === 'port' ? targetX : undefined,
			targetY: card.type === 'port' ? targetY : undefined
		};
	}

	/** Queue a card build. Applied at the next tick. */
	playCard(playerId: number, cardId: number, x: number, y: number): BuildOrderResult {
		const validation = this.validateBuild(playerId, cardId, x, y);
		if (!validation.ok) return validation;
		this.pendingCommands.push({
			type: 'build',
			playerId,
			cardId,
			x: Math.floor(x),
			y: Math.floor(y),
			sequence: this.nextCommandSequence++
		});
		return validation;
	}

	/**
	 * Queue a one-level upgrade for the structure whose district owns this
	 * pixel. Clicking a district is enough; no card is consumed.
	 */
	/** Quote the total cost of upgrading an owned district by 1-5 levels. */
	getUpgradeQuote(
		playerId: number,
		x: number,
		y: number,
		levels = 1,
		merged = false
	): UpgradeQuote {
		const count = Math.max(1, Math.min(5, Math.floor(levels)));
		const fail = (reason: BuildFailure, message: string): UpgradeQuote => ({
			ok: false,
			reason,
			message,
			levels: count,
			cost: 0,
			currentLevel: 0,
			projectedLevel: 0,
			merged: false,
			structureCount: 0
		});
		if (this.ended) return fail('ended', 'The conflict is over.');
		const player = this.players[playerId - 1];
		if (!player?.alive) return fail('eliminated', 'Your state has been eliminated.');
		if (playerId !== HUMAN_PLAYER_ID) {
			return fail('invalid', 'Only the human commander upgrades districts.');
		}
		const target = this.resolveUpgradeTarget(playerId, x, y);
		if (!target) return fail('no-district', 'Click one of your structure districts to upgrade it.');

		const group = merged ? this.mergedGroupStructures(target.structure) : [target.structure];
		const projected = group.map(
			(structure) => structure.stacks + this.pendingUpgradesFor(structure.id)
		);
		const currentLevel = Math.min(...group.map((structure) => structure.stacks));
		const projectedLevel = Math.min(...projected);
		const baseCost = STRUCTURE_DEFINITIONS[target.structure.type].cost;
		let cost = 0;
		for (let level = 0; level < count; level++) {
			let selected = 0;
			for (let index = 1; index < group.length; index++) {
				if (
					projected[index] < projected[selected] ||
					(projected[index] === projected[selected] && group[index].id < group[selected].id)
				) {
					selected = index;
				}
			}
			cost += baseCost + projected[selected] * UPGRADE_LEVEL_COST_STEP;
			projected[selected]++;
		}
		const isMerged = merged && group.length > 1;
		if (this.supplyOf(playerId) - this.pendingUpgradeCost(playerId) < cost) {
			return {
				...fail(
					'no-gold',
					`Need ${cost} supply to upgrade ${
						isMerged ? 'the merged' : ''
					}${STRUCTURE_DEFINITIONS[target.structure.type].label} district by ${count} level${
						count === 1 ? '' : 's'
					}.`
				),
				cost,
				currentLevel,
				projectedLevel,
				merged: isMerged,
				structureCount: group.length
			};
		}
		return {
			ok: true,
			message: `Upgrade ${isMerged ? 'the merged ' : ''}${
				STRUCTURE_DEFINITIONS[target.structure.type].label
			} district by ${count} level${count === 1 ? '' : 's'} for ${cost} supply.`,
			levels: count,
			cost,
			currentLevel,
			projectedLevel,
			merged: isMerged,
			structureCount: group.length
		};
	}

	/** Queue one or more district upgrades; Shift-click queues five at once. */
	upgradeDistrict(
		playerId: number,
		x: number,
		y: number,
		levels = 1,
		merged = false
	): BuildOrderResult {
		const quote = this.getUpgradeQuote(playerId, x, y, levels, merged);
		if (!quote.ok) return quote;
		const target = this.resolveUpgradeTarget(playerId, x, y);
		if (!target) return quote;
		const baseCost = STRUCTURE_DEFINITIONS[target.structure.type].cost;
		if (!quote.merged) {
			for (let level = 0; level < quote.levels; level++) {
				this.pendingCommands.push({
					type: 'upgrade',
					playerId,
					x: Math.floor(x),
					y: Math.floor(y),
					cost: baseCost + (quote.projectedLevel + level) * UPGRADE_LEVEL_COST_STEP,
					sequence: this.nextCommandSequence++
				});
			}
			return quote;
		}

		const group = this.mergedGroupStructures(target.structure);
		for (let level = 0; level < quote.levels; level++) {
			let selected = group[0];
			let selectedProjected = selected.stacks + this.pendingUpgradesFor(selected.id);
			for (const structure of group) {
				const projected = structure.stacks + this.pendingUpgradesFor(structure.id);
				if (
					projected < selectedProjected ||
					(projected === selectedProjected && structure.id < selected.id)
				) {
					selected = structure;
					selectedProjected = projected;
				}
			}
			this.pendingCommands.push({
				type: 'upgrade',
				playerId,
				x: selected.x,
				y: selected.y,
				cost: baseCost + selectedProjected * UPGRADE_LEVEL_COST_STEP,
				structureId: selected.id,
				sequence: this.nextCommandSequence++
			});
		}
		return quote;
	}

	private resolveUpgradeTarget(
		playerId: number,
		x: number,
		y: number
	): { index: number; structure: Structure } | null {
		const roundedX = Math.floor(x);
		const roundedY = Math.floor(y);
		if (roundedX < 0 || roundedY < 0 || roundedX >= this.width || roundedY >= this.height) {
			return null;
		}
		const index = roundedY * this.width + roundedX;
		if (this.owners[index] !== playerId) return null;
		const districtId = this.districtStructureIds[index];
		if (!districtId) return null;
		const structure = this.structures.byId(districtId);
		if (!structure || structure.ownerId !== playerId) return null;
		return { index, structure };
	}

	private pendingUpgradesFor(structureId: number): number {
		let count = 0;
		for (const command of this.pendingCommands) {
			if (command.type !== 'upgrade') continue;
			if (command.structureId !== undefined) {
				if (command.structureId === structureId) count++;
				continue;
			}
			const target = this.resolveUpgradeTarget(command.playerId, command.x, command.y);
			if (target?.structure.id === structureId) count++;
		}
		return count;
	}

	private pendingUpgradeCost(playerId: number): number {
		let cost = 0;
		for (const command of this.pendingCommands) {
			if (command.type !== 'upgrade' || command.playerId !== playerId) continue;
			cost += command.cost;
		}
		return cost;
	}

	step(): StepResult {
		this.changeCount = 0;
		this.changesOverflow = false;
		this.districtsChanged = false;
		this.districtDirtyTiles.clear();
		this.events = [];

		if (!this.ended) {
			this.tick++;

			if (this.pendingGrowthMode) {
				this.growthMode = this.pendingGrowthMode;
				this.pendingGrowthMode = null;
			}

			this.accrueResources();
			this.applyPendingCommands();
			// Large annex cleanups are drained over multiple ticks; determinism
			// comes from queue order, not from how long the queue took to apply.
			this.applyAnnexTransfers(ANNEX_TRANSFER_BUDGET);

			// Threat must refresh before the economy and decision passes so a
			// front opened this tick is already visible to the defender.
			this.updateBotThreat();
			this.updateBotOptions();
			this.runBotEconomy();
			this.runBotNaval();
			this.runBotDecisions();
			this.runBotArtillery();
			this.processArtilleryShells();
			this.processNavalLandings();
			this.processAttacks();
			const annexDue =
				(this.tick + ANNEX_PHASE_OFFSET_TICKS) % ANNEX_INTERVAL_TICKS === 0 ||
				(this.annexRequested && this.tick - this.lastAnnexTick >= ANNEX_INTERVAL_TICKS);
			if (
				this.annexTransferQueue.length === 0 &&
				annexDue &&
				(this.ownershipChangedSinceAnnex || this.annexRequested)
			) {
				this.annexDisconnectedTerritory(true);
				this.annexRequested = false;
				this.lastAnnexTick = this.tick;
				this.ownershipChangedSinceAnnex = false;
			}
			if (this.tick % UNCLAIMED_CLEANUP_INTERVAL_TICKS === 0 && this.ownershipChangedSinceCleanup) {
				this.cleanupUnclaimedPockets();
				this.ownershipChangedSinceCleanup = false;
			}
			this.updateEliminations();
			this.checkVictory();
		}

		this.lastSnapshot = this.buildSnapshot();
		return {
			tick: this.tick,
			changes: this.changes,
			changeCount: this.changeCount,
			changesOverflow: this.changesOverflow,
			districtsChanged: this.districtsChanged,
			districtTiles: [...this.districtDirtyTiles].sort((a, b) => a - b),
			events: this.events.slice(),
			snapshot: this.lastSnapshot
		};
	}

	getSnapshot(): GameSnapshot {
		return this.lastSnapshot ?? (this.lastSnapshot = this.buildSnapshot());
	}

	getOwner(x: number, y: number): number {
		if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
		return this.owners[y * this.width + x];
	}

	isLand(x: number, y: number): boolean {
		if (x < 0 || y < 0 || x >= this.width || y >= this.height) return false;
		return this.land[y * this.width + x] === 1;
	}

	get terrain(): Uint8Array {
		return this.land;
	}

	get terrainShade(): Uint8Array {
		return this.shade;
	}

	get terrainElevation(): Uint8Array {
		return this.elevation;
	}

	getElevation(x: number, y: number): number {
		if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
		return this.elevation[y * this.width + x];
	}

	getBaseDefense(x: number, y: number): number {
		if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
		const index = y * this.width + x;
		if (!this.land[index]) return 0;
		return BASE_DEFENSE_OFFSET + this.elevation[index];
	}

	isShore(x: number, y: number): boolean {
		if (x < 0 || y < 0 || x >= this.width || y >= this.height) return false;
		return isShoreIndex(this.land, this.width, this.height, y * this.width + x);
	}

	getDefense(x: number, y: number): number {
		if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
		const index = y * this.width + x;
		if (!this.land[index]) return 0;
		return this.defenseAt(index);
	}

	getAuraDefense(x: number, y: number): number {
		if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
		return this.auraDefense[y * this.width + x];
	}

	get totalLand(): number {
		return this.landCount;
	}

	get activeAttacks(): readonly PublicAttack[] {
		return this.attacks.map((attack) => this.toPublicAttack(attack));
	}

	/**
	 * FNV-1a over all authoritative state. Use on replay boundaries and in tests;
	 * it is intentionally too expensive to run every tick in production.
	 */
	checksum(): number {
		let hash = 0x811c9dc5;
		const mix = (value: number) => {
			hash ^= value & 0xff;
			hash = Math.imul(hash, 0x01000193);
			hash ^= (value >>> 8) & 0xff;
			hash = Math.imul(hash, 0x01000193);
			hash ^= (value >>> 16) & 0xff;
			hash = Math.imul(hash, 0x01000193);
			hash ^= (value >>> 24) & 0xff;
			hash = Math.imul(hash, 0x01000193);
		};

		mix(this.tick);
		mix(this.rng.getState());
		mix(this.nextAttackId);
		mix(this.ended ? 1 : 0);
		mix(this.winnerId ?? 0);
		mix(growthModeCode(this.growthMode));
		mix(this.pendingGrowthMode ? growthModeCode(this.pendingGrowthMode) : 0);
		mix(this.annexRequested ? 1 : 0);
		mix(this.lastAnnexTick);
		mix(this.ownershipChangedSinceAnnex ? 1 : 0);
		mix(this.ownershipChangedSinceCleanup ? 1 : 0);
		mix(this.annexTransferIndex);
		for (let i = this.annexTransferIndex; i < this.annexTransferQueue.length; i++) {
			const transfer = this.annexTransferQueue[i];
			if (!transfer) continue;
			mix(transfer.index);
			mix(transfer.from);
			mix(transfer.to);
		}
		mix(this.gold);
		mix(this.goldAccrual);
		for (const botGold of this.botGold) mix(botGold);
		for (const botAccrual of this.botGoldAccrual) mix(botAccrual);
		for (const grievance of this.botGrievance) mix(grievance);
		for (const stacks of this.eliminationIncomeStacks) mix(stacks);
		for (const epoch of this.botDecisionEpoch) mix(epoch);
		for (const threat of this.botThreat) mix(threat);
		for (const defensive of this.botDefensive) mix(defensive);
		for (const reserve of this.botReserve) mix(reserve);
		for (const stall of this.botDefenseStall) mix(stall);
		for (const gap of this.botIncomeGap) mix(gap);
		for (const deterrence of this.botDeterrence) mix(deterrence);
		for (const option of this.botOption) mix(option);
		for (const until of this.botOptionUntil) mix(until);
		for (const target of this.botOptionTarget) mix(target);
		for (const markov of this.botMarkovState) mix(markov);
		for (const entry of this.botMarkovEntry) mix(entry);
		for (const bias of this.botMarkovBias) mix(bias);
		for (const attacker of this.botLastAttacker) mix(attacker);
		for (const mark of this.botGrievanceMark) mix(mark);
		for (const orders of this.attackOrders) mix(orders);

		for (let i = 0; i < this.owners.length; i++) {
			mix(this.owners[i]);
			mix(this.claimedBy[i]);
		}

		for (const player of this.players) {
			mix(player.id);
			mix(player.alive ? 1 : 0);
			mix(player.territory);
			mix(player.teamId);
		}

		for (const structure of this.structures.all) {
			mix(structure.id);
			mix(STRUCTURE_TYPE_CODES[structure.type]);
			mix(structure.ownerId);
			mix(structure.index);
			mix(structure.stacks);
			mix(this.artilleryReadyAt(structure));
		}
		mix(this.nextShellId);
		for (const shell of this.artilleryShells) {
			mix(shell.id);
			mix(shell.ownerId);
			mix(shell.fromX);
			mix(shell.fromY);
			mix(shell.targetX);
			mix(shell.targetY);
			mix(shell.launchedAtTick);
			mix(shell.arriveAtTick);
		}
		mix(this.nextNavalId);
		for (const landing of this.navalLandings) {
			mix(landing.id);
			mix(landing.ownerId);
			mix(landing.portId);
			mix(landing.targetIndex);
			mix(landing.launchedAtTick);
			mix(landing.arriveAtTick);
			mix(landing.path.length);
			for (const cell of landing.path) mix(cell);
		}

		for (const attack of this.attacks) {
			mix(attack.id);
			mix(attack.attackerId);
			mix(attack.defenderId);
			mix(attack.targetX);
			mix(attack.targetY);
			mix(attack.anchorX);
			mix(attack.anchorY);
			mix(growthModeCode(attack.growthMode));
			mix(attack.createdAtTick);
			mix(attack.lifetimeTicks);
			mix(attack.orders);
			mix(attack.initialOrders);
			mix(attack.captures);
			attack.frontier.mixState(mix);
		}

		return hash >>> 0;
	}

	private applyPendingCommands(): void {
		if (this.pendingCommands.length === 0) return;
		const commands = this.pendingCommands;
		this.pendingCommands = [];

		// Deterministic order regardless of arrival order. The server will also
		// enforce this ordering before broadcasting commands.
		commands.sort((a, b) => a.sequence - b.sequence || a.playerId - b.playerId);

		for (const command of commands) {
			if (this.ended) return;
			const player = this.players[command.playerId - 1];
			if (!player?.alive) continue;

			if (command.type === 'naval') {
				this.tryLaunchNaval(command.playerId, command.x, command.y);
				continue;
			}

			if (command.type === 'build') {
				const validation = this.validateBuild(
					command.playerId,
					command.cardId,
					command.x,
					command.y
				);
				if (!validation.ok) continue;
				const card = this.hand.find((entry) => entry.id === command.cardId);
				if (!card) continue;
				const targetX = validation.targetX ?? command.x;
				const targetY = validation.targetY ?? command.y;
				const targetIndex = targetY * this.width + targetX;
				const districtId = this.districtStructureIds[targetIndex];
				const districtStructure = districtId ? this.structures.byId(districtId) : undefined;
				const baseCost = STRUCTURE_DEFINITIONS[card.type].cost;
				if (districtStructure && districtStructure.type === card.type) {
					const cost = baseCost + districtStructure.stacks * UPGRADE_LEVEL_COST_STEP;
					if (!this.spendSupply(command.playerId, cost)) continue;
					const stacks = this.structures.reinforce(districtStructure);
					this.rebuildAuraDefense();
					this.pushEvent(
						'build',
						`${STRUCTURE_DEFINITIONS[card.type].label} upgraded to Lv.${stacks} for ${cost} supply.`,
						command.playerId
					);
					continue;
				}
				if (!this.spendSupply(command.playerId, baseCost)) continue;
				const structure = this.structures.create(
					card.type,
					command.playerId,
					targetX,
					targetY,
					this.width
				);
				this.refreshDistrictsAround(structure);
				this.rebuildAuraDefense();
				this.pushEvent(
					'build',
					`${STRUCTURE_DEFINITIONS[structure.type].label} built for ${baseCost} supply.`,
					command.playerId
				);
				continue;
			}

			if (command.type === 'upgrade') {
				const target =
					command.structureId !== undefined
						? (() => {
								const structure = this.structures.byId(command.structureId);
								if (!structure || structure.ownerId !== command.playerId) return null;
								if (this.owners[structure.index] !== command.playerId) return null;
								return { index: structure.index, structure };
							})()
						: this.resolveUpgradeTarget(command.playerId, command.x, command.y);
				if (!target) continue;
				const cost = command.cost;
				if (!this.spendSupply(command.playerId, cost)) continue;
				const stacks = this.structures.reinforce(target.structure);
				this.rebuildAuraDefense();
				this.pushEvent(
					'build',
					`${STRUCTURE_DEFINITIONS[target.structure.type].label} upgraded to Lv.${stacks} for ${cost} supply.`,
					command.playerId
				);
				continue;
			}

			if (command.type === 'demolish') {
				this.demolishStructureNow(command.playerId, command.structureId);
				continue;
			}

			if (command.type === 'artillery') {
				this.fireArtilleryVolley(command.playerId, command.x, command.y);
				continue;
			}

			const index = command.y * this.width + command.x;
			if (index < 0 || index >= this.owners.length) continue;
			const seeds = this.findAttackSeeds(command.playerId, index);
			if (seeds.length === 0) continue;
			this.createAttack(command.playerId, index, seeds);
		}
	}

	private findAttackSeeds(attackerId: number, targetIndex: number): number[] {
		const targetOwner = this.owners[targetIndex];
		if (targetOwner === attackerId) return [];
		const targetX = indexToX(targetIndex, this.width);
		const targetY = indexToY(targetIndex, this.width);
		const radius = ATTACK_SEARCH_RADIUS;
		const found: Array<{ index: number; distance: number }> = [];

		const minX = Math.max(0, targetX - radius);
		const maxX = Math.min(this.width - 1, targetX + radius);
		const minY = Math.max(0, targetY - radius);
		const maxY = Math.min(this.height - 1, targetY + radius);

		for (let y = minY; y <= maxY; y++) {
			for (let x = minX; x <= maxX; x++) {
				const dx = x - targetX;
				const dy = y - targetY;
				const distance = dx * dx + dy * dy;
				if (distance > radius * radius) continue;

				const index = y * this.width + x;
				if (this.owners[index] !== targetOwner || !this.land[index]) continue;
				if (!this.hasNeighbourOwner(index, attackerId)) continue;
				found.push({ index, distance });
			}
		}

		// Keep the seeds closest to the click and bias toward scan order. This
		// keeps a click on a long frontier local instead of opening the whole front.
		found.sort((a, b) => a.distance - b.distance || a.index - b.index);
		return found.slice(0, 96).map((entry) => entry.index);
	}

	/**
	 * Rebuild all districts as a constrained Voronoi map: each owned cell goes
	 * to the nearest eligible structure of its owner, up to that structure's
	 * district range. Ties are broken by type code and then structure id.
	 */
	private rebuildDistricts(): void {
		this.districtTypes.fill(0);
		this.districtStructureIds.fill(0);
		this.districtColorCodes.fill(0);
		for (const structure of this.structures.all) {
			const range = STRUCTURE_DEFINITIONS[structure.type].districtRange;
			if (range <= 0) continue;
			const scanRange = range + DISTRICT_NOISE_MARGIN;
			const minX = Math.max(0, structure.x - scanRange);
			const maxX = Math.min(this.width - 1, structure.x + scanRange);
			const minY = Math.max(0, structure.y - scanRange);
			const maxY = Math.min(this.height - 1, structure.y + scanRange);
			for (let y = minY; y <= maxY; y++) {
				for (let x = minX; x <= maxX; x++) {
					const index = y * this.width + x;
					if (this.owners[index] !== structure.ownerId) continue;
					const owner = this.nearestDistrictStructure(structure.ownerId, x, y);
					this.districtTypes[index] = owner ? STRUCTURE_TYPE_CODES[owner.type] : 0;
					this.districtStructureIds[index] = owner?.id ?? 0;
					this.districtColorCodes[index] = owner ? this.districtColorCode(owner) : 0;
				}
			}
		}
		this.districtsChanged = true;
		this.markDistrictTiles(0, this.width - 1, 0, this.height - 1);
	}

	private markDistrictTiles(minX: number, maxX: number, minY: number, maxY: number): void {
		const tilesX = Math.ceil(this.width / RENDER_TILE_SIZE);
		const tilesY = Math.ceil(this.height / RENDER_TILE_SIZE);
		const firstX = Math.max(0, Math.floor(minX / RENDER_TILE_SIZE));
		const lastX = Math.min(tilesX - 1, Math.floor(maxX / RENDER_TILE_SIZE));
		const firstY = Math.max(0, Math.floor(minY / RENDER_TILE_SIZE));
		const lastY = Math.min(tilesY - 1, Math.floor(maxY / RENDER_TILE_SIZE));
		for (let ty = firstY; ty <= lastY; ty++) {
			for (let tx = firstX; tx <= lastX; tx++) this.districtDirtyTiles.add(ty * tilesX + tx);
		}
	}

	/**
	 * Recompute districts only in the neighbourhood a structure can affect.
	 * A new or destroyed buildable changes nearest-owner districts only within
	 * its own range; a full-map rebuild here would cost hundreds of ms while
	 * 50 bots build in batches.
	 */
	private refreshDistrictsAround(structure: Structure): void {
		const range = STRUCTURE_DEFINITIONS[structure.type].districtRange;
		if (range <= 0) return;
		const scanRange = range + DISTRICT_NOISE_MARGIN;
		const minX = Math.max(0, structure.x - scanRange);
		const maxX = Math.min(this.width - 1, structure.x + scanRange);
		const minY = Math.max(0, structure.y - scanRange);
		const maxY = Math.min(this.height - 1, structure.y + scanRange);
		for (let y = minY; y <= maxY; y++) {
			for (let x = minX; x <= maxX; x++) {
				const index = y * this.width + x;
				if (this.owners[index] !== structure.ownerId) continue;
				this.updateDistrictAt(index);
			}
		}
		this.districtsChanged = true;
		this.markDistrictTiles(minX, maxX, minY, maxY);
	}

	private nearestDistrictStructure(ownerId: number, x: number, y: number): Structure | null {
		let bestDistance = Number.POSITIVE_INFINITY;
		let best: Structure | null = null;
		const owned = this.structures.forOwner(ownerId);
		for (const structure of owned) {
			const range = STRUCTURE_DEFINITIONS[structure.type].districtRange;
			if (range <= 0) continue;
			const distance = this.districtDistance(structure, x, y, range);
			if (distance > range * range) continue;
			const code = STRUCTURE_TYPE_CODES[structure.type];
			const bestCode = best ? STRUCTURE_TYPE_CODES[best.type] : 0;
			if (
				distance < bestDistance ||
				(distance === bestDistance &&
					(code < bestCode || (code === bestCode && structure.id < (best?.id ?? Infinity))))
			) {
				bestDistance = distance;
				best = structure;
			}
		}
		return best;
	}

	/**
	 * Squared distance plus a small, continuous integer noise offset. The
	 * offset both wiggles Voronoi split lines and lets the outer edge grow or
	 * shrink by roughly two pixels. It is deterministic and structure-specific.
	 */
	private districtDistance(structure: Structure, x: number, y: number, range: number): number {
		const dx = x - structure.x;
		const dy = y - structure.y;
		const distance = dx * dx + dy * dy;
		const seed = (this.seed ^ Math.imul(structure.id, 0x9e3779b9)) >>> 0;
		const noise = districtNoise(x, y, seed);
		return distance + (((noise - 128) * range) >> 5);
	}

	private districtColorCode(structure: Structure): number {
		const base = STRUCTURE_TYPE_CODES[structure.type] * 4 - 3;
		return base + (structure.id % 4);
	}

	private updateDistrictAt(index: number): void {
		const owner = this.owners[index];
		if (!owner) {
			this.districtTypes[index] = 0;
			this.districtStructureIds[index] = 0;
			this.districtColorCodes[index] = 0;
			return;
		}
		const x = index % this.width;
		const y = (index - x) / this.width;
		const structure = this.nearestDistrictStructure(owner, x, y);
		this.districtTypes[index] = structure ? STRUCTURE_TYPE_CODES[structure.type] : 0;
		this.districtStructureIds[index] = structure?.id ?? 0;
		this.districtColorCodes[index] = structure ? this.districtColorCode(structure) : 0;
	}

	getDistrictType(x: number, y: number): number {
		if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
		return this.districtTypes[y * this.width + x];
	}

	getDistrictStructureId(x: number, y: number): number {
		if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
		return this.districtStructureIds[y * this.width + x];
	}

	getDistrictColorCode(x: number, y: number): number {
		if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
		return this.districtColorCodes[y * this.width + x];
	}

	/**
	 * Visual/upgrade groups of touching same-owner districts of the same type.
	 * Membership is recomputed at most every few ticks; stack totals refresh on
	 * every read so level badges stay current after upgrades.
	 */
	getMergedDistricts(): readonly MergedDistrictGroup[] {
		const layout = this.structures.layoutVersion;
		const fresh =
			this.mergedGroupsLayoutVersion === layout && this.tick - this.mergedGroupsComputedTick < 5;
		if (!fresh) {
			this.rebuildMergedDistricts();
			this.mergedGroupsLayoutVersion = layout;
			this.mergedGroupsComputedTick = this.tick;
		}
		return this.refreshMergedGroupTotals();
	}

	private rebuildMergedDistricts(): void {
		const parent = new Map<number, number>();
		const find = (id: number): number => {
			let root = parent.get(id) ?? id;
			if (root === id) {
				parent.set(id, id);
				return id;
			}
			root = find(root);
			parent.set(id, root);
			return root;
		};
		const union = (left: number, right: number): void => {
			const leftRoot = find(left);
			const rightRoot = find(right);
			if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
		};

		const { width, height, owners, districtStructureIds, districtTypes } = this;
		for (let y = 0; y < height; y++) {
			const row = y * width;
			for (let x = 0; x < width; x++) {
				const index = row + x;
				const id = districtStructureIds[index];
				if (id === 0) continue;
				const owner = owners[index];
				const type = districtTypes[index];
				if (x + 1 < width) {
					const neighbour = index + 1;
					const nextId = districtStructureIds[neighbour];
					if (
						nextId !== 0 &&
						nextId !== id &&
						owners[neighbour] === owner &&
						districtTypes[neighbour] === type
					) {
						union(id, nextId);
					}
				}
				if (y + 1 < height) {
					const neighbour = index + width;
					const nextId = districtStructureIds[neighbour];
					if (
						nextId !== 0 &&
						nextId !== id &&
						owners[neighbour] === owner &&
						districtTypes[neighbour] === type
					) {
						union(id, nextId);
					}
				}
			}
		}

		const members = new Map<
			number,
			{
				ownerId: number;
				type: BuildableStructureType;
				structureIds: number[];
				sumX: number;
				sumY: number;
			}
		>();
		for (const structure of this.structures.all) {
			if (structure.type === 'state') continue;
			if (STRUCTURE_DEFINITIONS[structure.type].districtRange <= 0) continue;
			const root = find(structure.id);
			let member = members.get(root);
			if (!member) {
				member = {
					ownerId: structure.ownerId,
					type: structure.type,
					structureIds: [],
					sumX: 0,
					sumY: 0
				};
				members.set(root, member);
			}
			member.structureIds.push(structure.id);
			member.sumX += structure.x;
			member.sumY += structure.y;
		}

		this.mergedGroupsCache = [];
		for (const member of members.values()) {
			const count = member.structureIds.length;
			this.mergedGroupsCache.push({
				ownerId: member.ownerId,
				type: member.type,
				totalStacks: count,
				structureIds: member.structureIds,
				centerX: Math.round(member.sumX / count),
				centerY: Math.round(member.sumY / count),
				lowestStructureId: member.structureIds[0]
			});
		}
		this.refreshMergedGroupTotals();
	}

	private refreshMergedGroupTotals(): readonly MergedDistrictGroup[] {
		for (const group of this.mergedGroupsCache) {
			let total = 0;
			let lowestStacks = Number.POSITIVE_INFINITY;
			let lowestId = Number.POSITIVE_INFINITY;
			for (const structureId of group.structureIds) {
				const structure = this.structures.byId(structureId);
				if (!structure) continue;
				total += structure.stacks;
				if (
					structure.stacks < lowestStacks ||
					(structure.stacks === lowestStacks && structure.id < lowestId)
				) {
					lowestStacks = structure.stacks;
					lowestId = structure.id;
				}
			}
			group.totalStacks = total;
			if (Number.isFinite(lowestId)) group.lowestStructureId = lowestId;
		}
		return this.mergedGroupsCache;
	}

	private mergedGroupStructures(structure: Structure): Structure[] {
		if (structure.type === 'state') return [structure];
		for (const group of this.getMergedDistricts()) {
			if (!group.structureIds.includes(structure.id)) continue;
			const result: Structure[] = [];
			for (const structureId of group.structureIds) {
				const member = this.structures.byId(structureId);
				if (member) result.push(member);
			}
			return result.length > 0 ? result : [structure];
		}
		return [structure];
	}

	private rebuildAuraDefense(): void {
		this.auraDefense.fill(0);
		const width = this.width;
		const height = this.height;

		const stamp = (stacking: 'max' | 'add') => {
			for (const structure of this.structures.all) {
				for (const effect of structure.effects) {
					if (effect.kind !== 'defense-aura' || effect.stacking !== stacking) continue;
					const districtRange = STRUCTURE_DEFINITIONS[structure.type].districtRange;
					const hasDistrict = districtRange > 0;
					const radius = Math.max(0, Math.floor(hasDistrict ? districtRange : effect.radius));
					const scanRadius = hasDistrict ? radius + DISTRICT_NOISE_MARGIN : radius;
					const minX = Math.max(0, structure.x - scanRadius);
					const maxX = Math.min(width - 1, structure.x + scanRadius);
					const minY = Math.max(0, structure.y - scanRadius);
					const maxY = Math.min(height - 1, structure.y + scanRadius);
					const radiusSq = radius * radius;

					for (let y = minY; y <= maxY; y++) {
						const dy = y - structure.y;
						for (let x = minX; x <= maxX; x++) {
							// A buildable defense aura covers its whole district.
							// State has no district and keeps its fixed radius.
							if (!hasDistrict) {
								const dx = x - structure.x;
								if (dx * dx + dy * dy > radiusSq) continue;
							}
							const index = y * width + x;
							if (this.owners[index] !== structure.ownerId) continue;
							if (hasDistrict && this.districtStructureIds[index] !== structure.id) {
								continue;
							}
							const defense = effect.defense * structure.stacks;
							if (stacking === 'max') {
								this.auraDefense[index] = Math.max(this.auraDefense[index], defense);
							} else {
								this.auraDefense[index] = Math.min(65_535, this.auraDefense[index] + defense);
							}
						}
					}
				}
			}
		};

		stamp('max');
		stamp('add');
	}

	/**
	 * Recompute one cell after an ownership change. Defensive auras only
	 * protect land owned by the structure's owner, so a captured cell must
	 * immediately drop the old owner's aura (and may gain the new owner's).
	 */
	private updateAuraAt(index: number): void {
		const owner = this.owners[index];
		if (!owner) {
			this.auraDefense[index] = 0;
			return;
		}
		const x = index % this.width;
		const y = (index - x) / this.width;
		let max = 0;
		let add = 0;
		for (const structure of this.structures.forOwner(owner)) {
			const hasDistrict = STRUCTURE_DEFINITIONS[structure.type].districtRange > 0;
			if (hasDistrict && this.districtStructureIds[index] !== structure.id) continue;
			for (const effect of structure.effects) {
				if (effect.kind !== 'defense-aura') continue;
				if (!hasDistrict) {
					const dx = structure.x - x;
					const dy = structure.y - y;
					if (dx * dx + dy * dy > effect.radius * effect.radius) continue;
				}
				const defense = effect.defense * structure.stacks;
				if (effect.stacking === 'max') max = Math.max(max, defense);
				else add += defense;
			}
		}
		this.auraDefense[index] = Math.min(65_535, max + add);
	}

	private defenseAt(index: number): number {
		return (
			BASE_DEFENSE_OFFSET +
			this.elevation[index] +
			(this.owners[index] > 0 ? OCCUPIED_DEFENSE_BONUS : 0) +
			this.auraDefense[index]
		);
	}

	private hasNeighbourOwner(index: number, ownerId: number): boolean {
		const width = this.width;
		const height = this.height;
		const x = index % width;
		const y = (index - x) / width;

		if (x > 0 && this.land[index - 1] && this.owners[index - 1] === ownerId) return true;
		if (x + 1 < width && this.land[index + 1] && this.owners[index + 1] === ownerId) return true;
		if (y > 0 && this.land[index - width] && this.owners[index - width] === ownerId) return true;
		if (y + 1 < height && this.land[index + width] && this.owners[index + width] === ownerId) {
			return true;
		}
		return false;
	}

	private createAttack(attackerId: number, targetIndex: number, seeds: number[]): boolean {
		const attacker = this.players[attackerId - 1];
		if (!attacker?.alive || seeds.length === 0) return false;

		const defenderId = this.owners[targetIndex];
		if (defenderId === attackerId) return false;
		if (!this.land[targetIndex]) return false;

		const targetX = indexToX(targetIndex, this.width);
		const targetY = indexToY(targetIndex, this.width);

		const unique: number[] = [];
		const initialSeen = new Set<number>();
		for (const seed of seeds) {
			if (initialSeen.has(seed)) continue;
			if (this.owners[seed] !== defenderId) continue;
			// State can change between click validation and the command tick.
			// Never open a front from a seed that has lost its land connection
			// to the attacker.
			if (!this.hasNeighbourOwner(seed, attackerId)) continue;
			initialSeen.add(seed);
			unique.push(seed);
		}
		if (unique.length === 0) return false;

		// The click selects the target and the region to look for a contact, but
		// it is not the growth origin. Anchoring distance-based layers at a click
		// deep inside hostile territory made a thin corridor race toward the
		// cursor before the front bloomed. The initial contact line on the
		// attacker's border is the stable geometric origin.
		let seedSumX = 0;
		let seedSumY = 0;
		for (const seed of unique) {
			const seedX = seed % this.width;
			seedSumX += seedX;
			seedSumY += (seed - seedX) / this.width;
		}
		const anchorX = Math.round(seedSumX / unique.length);
		const anchorY = Math.round(seedSumY / unique.length);

		const id = this.nextAttackId++;
		const mode = this.growthMode;
		const frontier = createGrowthLayer(mode, {
			width: this.width,
			height: this.height,
			owners: this.owners,
			attackerId,
			anchorX,
			anchorY,
			rngSeed:
				(this.seed ^
					Math.imul(id, 0x9e3779b1) ^
					Math.imul(attackerId, 0x85ebca6b) ^
					Math.imul(defenderId + 1, 0xc2b2ae35)) >>>
				0
		});
		for (const seed of unique) frontier.push(seed);

		const stats = this.getAttackStats(attackerId, defenderId);
		if (!this.spendSupply(attackerId, stats.cost)) return false;
		const orders = stats.logTier + 1;
		this.attacks.push({
			id,
			attackerId,
			defenderId,
			targetX,
			targetY,
			anchorX,
			anchorY,
			growthMode: mode,
			frontier,
			createdAtTick: this.tick,
			lifetimeTicks: 0,
			orders,
			initialOrders: orders,
			strength: stats.strength,
			initialStrength: stats.strength,
			supplyCost: stats.cost,
			power: stats.power,
			pierce: stats.pierce,
			idleTicks: 0,
			captures: 0,
			done: false
		});

		return true;
	}

	private processAttacks(): void {
		const attackById = new Map(this.attacks.map((attack) => [attack.id, attack]));
		const clashedPairs = new Set<number>();

		for (const attack of this.attacks) {
			if (attack.done) continue;
			const attacker = this.players[attack.attackerId - 1];
			if (!attacker.alive) {
				attack.done = true;
				continue;
			}
			if (attack.strength <= 0) {
				attack.done = true;
				continue;
			}

			let capturedThisTick = 0;
			let clashHeld = false;
			let attackPoints = attack.power;
			while (attackPoints > 0) {
				// Sample a small batch of the highest-priority frontier cells.
				// Geometry decides who is eligible; the cheapest sampled defense
				// decides which lane advances. This lets a front slide around a
				// costly strongpoint instead of spending its whole tick there.
				const sampled: number[] = [];
				let chosenPosition = -1;
				let chosenCost = Number.POSITIVE_INFINITY;
				let halted = false;

				for (let sample = 0; sample < LEAST_RESISTANCE_SAMPLE_SIZE; sample++) {
					const index = attack.frontier.pop();
					if (index === undefined) break;
					if (!this.land[index] || this.owners[index] !== attack.defenderId) continue;

					// Connectivity is re-checked at the moment of capture, not just
					// when the cell was enqueued. If another front cuts the path back
					// to the attacker, the candidate is discarded instead of becoming
					// an enclave.
					if (!this.hasNeighbourOwner(index, attack.attackerId)) continue;

					// Mutual attacks meet at their claimed front lines. The defender
					// spends attack orders up to its issued attack strength; every
					// spent order removes one embedded order from the incoming front.
					const clash = this.resolveOpposingClash(index, attack, attackById, clashedPairs);
					if (clash === 'halted') {
						halted = true;
						break;
					}
					if (clash === 'blocked') {
						clashHeld = true;
						break;
					}

					const cost = Math.max(1, this.defenseAt(index) - attack.pierce);
					sampled.push(index);
					if (cost < chosenCost) {
						chosenCost = cost;
						chosenPosition = sampled.length - 1;
					}
				}

				if (halted) break;

				// A clash pauses the front for this tick, but does not discard the
				// sampled candidates; they may still be reachable next tick.
				if (clashHeld) {
					for (let i = sampled.length - 1; i >= 0; i--) attack.frontier.push(sampled[i]);
					break;
				}

				if (chosenPosition < 0) {
					// Put the missed candidates back.
					for (let i = sampled.length - 1; i >= 0; i--) attack.frontier.push(sampled[i]);
					break;
				}

				// The cheapest sampled cell is still too expensive for this tick
				// or for the remaining durable strength. Keep the sample queued;
				// the front pauses rather than losing its cheapest lane.
				if (chosenCost > attackPoints || chosenCost > attack.strength) {
					for (let i = sampled.length - 1; i >= 0; i--) attack.frontier.push(sampled[i]);
					break;
				}

				// Put the missed candidates back. The chosen one is consumed.
				for (let i = sampled.length - 1; i >= 0; i--) {
					if (i !== chosenPosition) attack.frontier.push(sampled[i]);
				}

				const index = sampled[chosenPosition];
				const cellOwner = this.owners[index] ?? 0;
				this.claim(index, attack.attackerId, attack.id);
				attackPoints -= chosenCost;
				attack.strength -= chosenCost;
				attack.captures++;
				if (cellOwner > 0 && cellOwner !== attack.attackerId) {
					const defenderMetrics = this.botPlayerMetrics[cellOwner - 1];
					if (defenderMetrics) defenderMetrics.defenseDamage += chosenCost;
				}
				capturedThisTick++;

				const x = index % this.width;
				const y = (index - x) / this.width;
				if (x > 0) this.enqueueAttackCell(attack, index - 1);
				if (x + 1 < this.width) this.enqueueAttackCell(attack, index + 1);
				if (y > 0) this.enqueueAttackCell(attack, index - this.width);
				if (y + 1 < this.height) this.enqueueAttackCell(attack, index + this.width);
			}

			if (clashHeld || capturedThisTick > 0) attack.idleTicks = 0;
			else attack.idleTicks++;
			if (attack.strength <= 0 || attack.idleTicks > ATTACK_IDLE_TICKS) {
				if (attack.idleTicks > ATTACK_IDLE_TICKS && attack.defenderId > 0) {
					const defenderMetrics = this.botPlayerMetrics[attack.defenderId - 1];
					if (defenderMetrics) defenderMetrics.attacksRepelled++;
				}
				attack.done = true;
			}
		}

		this.attacks = this.attacks.filter((attack) => !attack.done);
	}

	/**
	 * Duplicate frontier entries are allowed: ownership is the visited check.
	 * Dropping the per-attack Set keeps memory proportional to queue capacity
	 * rather than paying object overhead for every enqueued pixel.
	 */
	private enqueueAttackCell(attack: AttackState, index: number): void {
		if (this.owners[index] !== attack.defenderId) return;
		if (!this.land[index]) return;
		attack.frontier.push(index);
	}

	/**
	 * A mutual attack war settles when a front touches land captured by the
	 * opposing attack. The candidate itself is not captured: the contact line is
	 * the new border. Other orders between the same two states are cancelled as
	 * well so the whole front freezes rather than just one lane.
	 */
	private findOpposingAttack(
		index: number,
		attack: AttackState,
		attackById: Map<number, AttackState>
	): AttackState | null {
		const x = index % this.width;
		const y = (index - x) / this.width;
		const neighbours = [
			x > 0 ? index - 1 : -1,
			x + 1 < this.width ? index + 1 : -1,
			y > 0 ? index - this.width : -1,
			y + 1 < this.height ? index + this.width : -1
		];

		for (const neighbour of neighbours) {
			if (neighbour < 0) continue;
			const claimId = this.claimedBy[neighbour];
			if (claimId === 0 || claimId === attack.id) continue;
			const other = attackById.get(claimId);
			if (!other || other.done) continue;
			if (other.attackerId === attack.defenderId && other.defenderId === attack.attackerId) {
				return other;
			}
		}
		return null;
	}

	/**
	 * Mutual fronts trade durable strength simultaneously. Damage is applied
	 * once per pair per tick; a front whose strength reaches zero dies while
	 * the survivor stays paused on the contact line.
	 */
	private resolveOpposingClash(
		index: number,
		attack: AttackState,
		attackById: Map<number, AttackState>,
		clashedPairs: Set<number>
	): 'halted' | 'blocked' | null {
		const other = this.findOpposingAttack(index, attack, attackById);
		if (!other) return null;
		const pair = Math.min(attack.id, other.id) * 1_000_000 + Math.max(attack.id, other.id);
		if (clashedPairs.has(pair)) return 'blocked';
		clashedPairs.add(pair);

		const incomingBonus = Math.max(0, other.orders - 1);
		const outgoingBonus = Math.max(0, attack.orders - 1);
		const damageToAttack = Math.min(
			attack.strength,
			ATTACK_ATTRITION_BASE + incomingBonus * ATTACK_ATTRITION_BONUS
		);
		const damageToOther = Math.min(
			other.strength,
			ATTACK_ATTRITION_BASE + outgoingBonus * ATTACK_ATTRITION_BONUS
		);
		attack.strength -= damageToAttack;
		other.strength -= damageToOther;
		attack.idleTicks = 0;
		other.idleTicks = 0;
		if (other.strength <= 0) {
			other.done = true;
			const defenderMetrics = this.botPlayerMetrics[attack.attackerId - 1];
			if (defenderMetrics) {
				defenderMetrics.attacksRepelled++;
				defenderMetrics.defenseDamage += damageToOther;
			}
		}

		if (attack.strength <= 0) {
			attack.done = true;
			this.annexRequested = true;
			const defenderMetrics = this.botPlayerMetrics[other.attackerId - 1];
			if (defenderMetrics) {
				defenderMetrics.attacksRepelled++;
				defenderMetrics.defenseDamage += damageToAttack;
			}
			return 'halted';
		}
		return 'blocked';
	}

	private collectAnnexTransfers(): AnnexTransfer[] {
		const anchors: IntegrityAnchor[] = this.structures.all
			.filter((structure) => structure.type === 'state')
			.map((structure) => ({ index: structure.index, ownerId: structure.ownerId }));
		anchors.push(...this.protectedPortAnchors());
		const transfers: AnnexTransfer[] = [];
		this.integrity.run(this.owners, this.land, anchors, (index, newOwner) => {
			transfers.push({ index, from: this.owners[index] ?? 0, to: newOwner });
		});
		return transfers;
	}

	private annexDisconnectedTerritory(queueTransfers = false): void {
		const transfers = this.collectAnnexTransfers();
		if (queueTransfers) {
			this.annexTransferQueue = transfers;
			this.annexTransferIndex = 0;
			return;
		}
		for (const transfer of transfers) this.claim(transfer.index, transfer.to, 0);
	}

	private applyAnnexTransfers(budget: number): void {
		let applied = 0;
		while (this.annexTransferIndex < this.annexTransferQueue.length && applied < budget) {
			const transfer = this.annexTransferQueue[this.annexTransferIndex++];
			applied++;
			if (!transfer) break;
			if ((this.owners[transfer.index] ?? 0) !== transfer.from) continue;
			this.claim(transfer.index, transfer.to, 0);
		}
		if (this.annexTransferIndex >= this.annexTransferQueue.length) {
			this.annexTransferQueue = [];
			this.annexTransferIndex = 0;
		}
	}

	/**
	 * A Port protects its land component when that component reaches the
	 * owner's State, or when it shares a sea component with another friendly
	 * Port whose land component reaches the State.
	 */
	private protectedPortAnchors(): IntegrityAnchor[] {
		const ports = this.structures.all.filter((structure) => structure.type === 'port');
		if (ports.length === 0) return [];
		const anchor: IntegrityAnchor[] = [];
		const byOwner = new Map<number, typeof ports>();
		const seaById = new Map<number, Set<number>>();
		const landAnchored = new Set<number>();
		this.portComponentMeta.clear();

		for (const port of ports) {
			let token = this.portComponentOf[port.index] ?? 0;
			let reachesState = false;
			const cached = token > 0 ? this.portComponentMeta.get(token) : undefined;
			if (cached && cached.ownerId === port.ownerId) {
				reachesState = cached.reachesState;
			} else {
				token = ++this.portVisitToken;
				let head = 0;
				let tail = 0;
				this.portComponentOf[port.index] = token;
				this.portComponentQueue[tail++] = port.index;
				while (head < tail) {
					const index = this.portComponentQueue[head++] ?? 0;
					const structure = this.structures.at(index);
					if (structure?.type === 'state' && structure.ownerId === port.ownerId) {
						reachesState = true;
					}
					const x = index % this.width;
					const y = (index - x) / this.width;
					if (x > 0) {
						const next = index - 1;
						if (
							this.land[next] &&
							this.owners[next] === port.ownerId &&
							this.portComponentOf[next] !== token
						) {
							this.portComponentOf[next] = token;
							this.portComponentQueue[tail++] = next;
						}
					}
					if (x + 1 < this.width) {
						const next = index + 1;
						if (
							this.land[next] &&
							this.owners[next] === port.ownerId &&
							this.portComponentOf[next] !== token
						) {
							this.portComponentOf[next] = token;
							this.portComponentQueue[tail++] = next;
						}
					}
					if (y > 0) {
						const next = index - this.width;
						if (
							this.land[next] &&
							this.owners[next] === port.ownerId &&
							this.portComponentOf[next] !== token
						) {
							this.portComponentOf[next] = token;
							this.portComponentQueue[tail++] = next;
						}
					}
					if (y + 1 < this.height) {
						const next = index + this.width;
						if (
							this.land[next] &&
							this.owners[next] === port.ownerId &&
							this.portComponentOf[next] !== token
						) {
							this.portComponentOf[next] = token;
							this.portComponentQueue[tail++] = next;
						}
					}
				}
				this.portComponentMeta.set(token, { ownerId: port.ownerId, reachesState });
			}
			const ownerPorts = byOwner.get(port.ownerId) ?? [];
			ownerPorts.push(port);
			byOwner.set(port.ownerId, ownerPorts);
			const waters: number[] = [];
			adjacentWater(this.land, this.width, this.height, port.index, waters);
			const seaIds = new Set<number>();
			for (const water of waters) {
				const sea = this.seaComponents[water] ?? 0;
				if (sea > 0) seaIds.add(sea);
			}
			seaById.set(port.id, seaIds);
			if (reachesState) {
				landAnchored.add(port.id);
				anchor.push({ index: port.index, ownerId: port.ownerId });
			}
		}

		for (const ownerPorts of byOwner.values()) {
			const anchoredSea = new Set<number>();
			for (const port of ownerPorts) {
				if (!landAnchored.has(port.id)) continue;
				for (const sea of seaById.get(port.id) ?? []) anchoredSea.add(sea);
			}
			for (const port of ownerPorts) {
				if (landAnchored.has(port.id)) continue;
				for (const sea of seaById.get(port.id) ?? []) {
					if (!anchoredSea.has(sea)) continue;
					anchor.push({ index: port.index, ownerId: port.ownerId });
					break;
				}
			}
		}
		return anchor;
	}

	private cleanupUnclaimedPockets(): void {
		this.integrity.cleanupUnclaimedPockets(
			this.owners,
			this.land,
			UNCLAIMED_POCKET_MAX_AREA,
			(index, newOwner) => {
				this.claim(index, newOwner, 0);
			}
		);
	}

	private claim(index: number, newOwner: number, sourceAttackId = 0): void {
		const previousOwner = this.owners[index];
		if (previousOwner === newOwner) return;

		if (previousOwner > 0) {
			if (newOwner > 0) this.lastAttackerOf[previousOwner - 1] = newOwner;
			const previous = this.players[previousOwner - 1];
			previous.territory--;
			previous.border.delete(index);
			if (sourceAttackId !== 0) {
				const attack = this.attacks.find((entry) => entry.id === sourceAttackId);
				if (attack && attack.attackerId !== previousOwner) {
					const grudge = (previousOwner - 1) * this.playerCount + (attack.attackerId - 1);
					if (this.botGrievance[grudge] < 0xffff) this.botGrievance[grudge]++;
				}
			}
		}

		this.invalidateStableSitesNear(index, previousOwner);
		this.invalidateStableSitesNear(index, newOwner);
		this.owners[index] = newOwner;
		this.claimedBy[index] = sourceAttackId;

		const structure = this.structures.destroyAt(index);
		if (structure) {
			this.refreshDistrictsAround(structure);
			this.rebuildAuraDefense();
			this.setSupply(structure.ownerId, this.supplyOf(structure.ownerId));
			const owner = this.players[structure.ownerId - 1];
			const label = STRUCTURE_DEFINITIONS[structure.type].label;
			this.pushEvent(
				'structure',
				structure.type === 'state'
					? `${owner.name}'s State structure was razed. Its territory is no longer protected from annexation.`
					: `${owner.name}'s ${label} was razed.`,
				structure.ownerId
			);
		}

		const next = this.players[newOwner - 1];
		next.territory++;
		this.refreshBorder(index);

		const x = index % this.width;
		const y = (index - x) / this.width;
		if (x > 0) this.refreshBorder(index - 1);
		if (x + 1 < this.width) this.refreshBorder(index + 1);
		if (y > 0) this.refreshBorder(index - this.width);
		if (y + 1 < this.height) this.refreshBorder(index + this.width);
		if (!structure) {
			this.updateDistrictAt(index);
			this.updateAuraAt(index);
		}

		this.recordChange(index, newOwner);
	}

	private refreshBorder(index: number): void {
		const owner = this.owners[index];
		if (!owner || !this.land[index]) return;
		const border = this.players[owner - 1].border;
		if (this.isBorderCell(index, owner)) border.add(index);
		else border.delete(index);
	}

	private isBorderCell(index: number, owner: number): boolean {
		const width = this.width;
		const x = index % width;
		const y = (index - x) / width;

		if (x > 0 && this.land[index - 1] && this.owners[index - 1] !== owner) return true;
		if (x + 1 < width && this.land[index + 1] && this.owners[index + 1] !== owner) return true;
		if (y > 0 && this.land[index - width] && this.owners[index - width] !== owner) return true;
		if (y + 1 < this.height && this.land[index + width] && this.owners[index + width] !== owner) {
			return true;
		}
		return false;
	}

	private rebuildBorders(): void {
		for (const player of this.players) player.border.clear();
		for (let i = 0; i < this.owners.length; i++) {
			const owner = this.owners[i];
			if (!owner) continue;
			if (this.isBorderCell(i, owner)) this.players[owner - 1].border.add(i);
		}
	}

	/** Invalidate a player's cached inner-ring build sites only for nearby changes. */
	private invalidateStableSitesNear(index: number, playerId: number): void {
		if (playerId <= 0) return;
		const state = this.structures.forOwnerType(playerId, 'state');
		if (!state) return;
		const x = index % this.width;
		const y = (index - x) / this.width;
		const dx = state.x - x;
		const dy = state.y - y;
		if (dx * dx + dy * dy > 100 * 100) return;
		const base = (playerId - 1) * 4;
		for (let i = 0; i < 4; i++) {
			this.stableBuildSiteCache[base + i] = -2;
			this.stableBuildSiteTick[base + i] = 0;
		}
	}

	private recordChange(index: number, owner: number): void {
		this.ownershipChangedSinceAnnex = true;
		this.ownershipChangedSinceCleanup = true;
		this.ownershipVersion++;
		if (this.changeCount >= CHANGE_BUFFER_SIZE) {
			this.changesOverflow = true;
			return;
		}
		this.changes[this.changeCount++] = ((owner & 0xffff) << 21) | index;
	}

	private createBotProfile(playerId: number): BotProfile {
		const seed = this.seed;
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
		const preferred = BUILDABLE_STRUCTURE_TYPES.map((type) => [type, structureBias[type]] as const);
		preferred.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
		const buildPlan = preferred.map((entry) => entry[0]);
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

	private createProfileFromGenome(genome: BotGenome): BotProfile {
		const structureBias = {} as Record<BuildableStructureType, number>;
		for (const type of BUILDABLE_STRUCTURE_TYPES) structureBias[type] = genome.structureBias[type];
		const preferred = BUILDABLE_STRUCTURE_TYPES.map((type) => [type, structureBias[type]] as const);
		preferred.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
		const buildPlan = preferred.map((entry) => entry[0]);
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

	/**
	 * Common opening strategy: alternate Command Posts and War Academies until
	 * both have two structures, then branch into personality-driven choices.
	 * This gives every bot a supply ramp before it starts expensive wars.
	 */
	private inBotEarlyEconomyRamp(player: PlayerState): boolean {
		if (this.tick > BOT_EARLY_ECONOMY_TICK_LIMIT) return false;
		const command = this.structures.forOwnerType(player.id, 'command-post');
		const academy = this.structures.forOwnerType(player.id, 'war-academy');
		return (
			(command?.stacks ?? 0) < BOT_EARLY_ECONOMY_PER_TYPE ||
			(academy?.stacks ?? 0) < BOT_EARLY_ECONOMY_PER_TYPE
		);
	}

	private botEarlyEconomyType(player: PlayerState): BuildableStructureType | null {
		if (!this.inBotEarlyEconomyRamp(player)) return null;
		const command = this.structures.forOwnerType(player.id, 'command-post');
		const academy = this.structures.forOwnerType(player.id, 'war-academy');
		const commandStacks = command?.stacks ?? 0;
		const academyStacks = academy?.stacks ?? 0;
		const type: BuildableStructureType =
			commandStacks <= academyStacks ? 'command-post' : 'war-academy';
		// If districts currently leave no site, fall back to normal utility so
		// the reserve cannot deadlock outside expansion pressure.
		return this.findBotBuildCell(player, type) >= 0 ? type : null;
	}

	/**
	 * Supply a bot keeps back for its highest-affinity missing structure once it
	 * has a basic economy. Without this, cheap affordable upgrades consume every
	 * interval and expensive strategic types are never reached.
	 */
	private botAspiration(player: PlayerState): {
		type: BuildableStructureType;
		cost: number;
	} | null {
		const profile = this.botProfiles[player.id - 1];
		const owned = this.structures
			.forOwner(player.id)
			.filter((structure) => structure.type !== 'state');
		if (owned.length < BOT_STRATEGIC_SAVE_MIN_STRUCTURES) return null;
		const built = new Set(owned.map((structure) => structure.type));
		const cap = Math.max(1, this.supplyCap(player.id));
		// Once the opening economy ramp is over, fund a first Barracks before
		// other luxury aspirations. Without this, cheap defensive/economy
		// upgrades continually consume the treasury and offense never starts.
		if (!this.inBotEarlyEconomyRamp(player) && !built.has('barracks')) {
			return {
				type: 'barracks',
				cost: STRUCTURE_DEFINITIONS['barracks'].cost
			};
		}
		// Aggressive states with a working economy should eventually fund a
		// first Artillery; the normal cap-growth path raises War Academies until
		// the 1,000-supply purchase becomes reachable.
		if (
			this.tick >= BOT_ARTILLERY_OPENING_TICK &&
			built.has('barracks') &&
			!built.has('artillery') &&
			profile.aggression >= BOT_ARTILLERY_OPENING_AGGRESSION &&
			player.territory >= BOT_ARTILLERY_OPENING_TERRITORY
		) {
			return {
				type: 'artillery',
				cost: STRUCTURE_DEFINITIONS['artillery'].cost
			};
		}
		let bestType: BuildableStructureType | null = null;
		let bestScore = Number.NEGATIVE_INFINITY;
		for (const type of BUILDABLE_STRUCTURE_TYPES) {
			if (built.has(type)) continue;
			const cost = STRUCTURE_DEFINITIONS[type].cost;
			// Prefer aspirations that the current stock cap can actually fund;
			// this stages cheap diversity before late-game artillery.
			const capPenalty = Math.floor(Math.max(0, cost - cap) / 10);
			const score = profile.structureBias[type] + BOT_ACTION_NOVELTY_BONUS - capPenalty;
			if (score > bestScore) {
				bestScore = score;
				bestType = type;
			}
		}
		return bestType ? { type: bestType, cost: STRUCTURE_DEFINITIONS[bestType].cost } : null;
	}

	/** A missing type with no legal build cell means expansion is the priority. */
	private botNeedsExpansion(player: PlayerState): boolean {
		const structureVersion = this.structures.version;
		const layoutVersion = this.structures.layoutVersion;
		const cacheIndex = player.id - 1;
		if (
			this.needsExpansionCacheOwnershipVersion === this.ownershipVersion &&
			this.needsExpansionCacheStructureVersion === structureVersion &&
			this.needsExpansionCacheLayoutVersion === layoutVersion
		) {
			const cached = this.needsExpansionCache[cacheIndex];
			if (cached >= 0) return cached === 1;
		} else {
			this.needsExpansionCacheOwnershipVersion = this.ownershipVersion;
			this.needsExpansionCacheStructureVersion = structureVersion;
			this.needsExpansionCacheLayoutVersion = layoutVersion;
			this.needsExpansionCache.fill(-1);
		}
		this.ensureBuildSiteCache();
		const result = this.computeBotNeedsExpansion(player);
		this.needsExpansionCache[cacheIndex] = result ? 1 : 0;
		return result;
	}

	private computeBotNeedsExpansion(player: PlayerState): boolean {
		const built = new Set(
			this.structures
				.forOwner(player.id)
				.filter((structure) => structure.type !== 'state')
				.map((structure) => structure.type)
		);
		for (const type of BUILDABLE_STRUCTURE_TYPES) {
			if (built.has(type)) continue;
			if (this.findBotBuildCell(player, type) < 0) return true;
		}
		return false;
	}

	/** Cheapest near-term economic purchase; attacks must not drain below it. */
	private botEconomicBuffer(player: PlayerState): number {
		let buffer = Number.POSITIVE_INFINITY;
		for (const type of BUILDABLE_STRUCTURE_TYPES) {
			const existing = this.structures.forOwnerType(player.id, type);
			if (!existing) {
				buffer = Math.min(buffer, STRUCTURE_DEFINITIONS[type].cost);
			} else {
				buffer = Math.min(
					buffer,
					STRUCTURE_DEFINITIONS[type].cost + existing.stacks * UPGRADE_LEVEL_COST_STEP
				);
			}
		}
		return Number.isFinite(buffer) ? buffer : 0;
	}

	private botNeedsMilitaryOpening(player: PlayerState): boolean {
		if (this.structures.forOwnerType(player.id, 'barracks')) return false;
		if (this.tick < BOT_EARLY_ECONOMY_MILITARY_TICK) return false;
		const command = this.structures.forOwnerType(player.id, 'command-post');
		const academy = this.structures.forOwnerType(player.id, 'war-academy');
		return (command?.stacks ?? 0) >= 1 && (academy?.stacks ?? 0) >= 1;
	}

	private botStrategicReserve(player: PlayerState): number {
		const gold = this.botGold[player.id - 1];
		const earlyType = this.botEarlyEconomyType(player);
		const academy = this.structures.forOwnerType(player.id, 'war-academy');
		if (this.botNeedsMilitaryOpening(player)) {
			const cost = STRUCTURE_DEFINITIONS['barracks'].cost;
			const cap = Math.max(1, this.supplyCap(player.id));
			if (cost > cap) {
				const capCost = academy
					? STRUCTURE_DEFINITIONS['war-academy'].cost + academy.stacks * UPGRADE_LEVEL_COST_STEP
					: STRUCTURE_DEFINITIONS['war-academy'].cost;
				return gold >= capCost ? 0 : capCost;
			}
			return gold >= cost ? 0 : cost;
		}
		if (earlyType) {
			const earlyCost = STRUCTURE_DEFINITIONS[earlyType].cost;
			return gold >= earlyCost ? 0 : Math.min(earlyCost, BOT_EARLY_ECONOMY_RESERVE_MAX);
		}
		const aspiration = this.botAspiration(player);
		if (!aspiration) return 0;
		const cap = Math.max(1, this.supplyCap(player.id));
		if (aspiration.cost > cap) {
			// Cap growth is itself the next purchase. Do not reserve a second
			// copy of the War Academy cost: the economy chooser emits only the
			// cap-growth action until the aspiration becomes affordable.
			return 0;
		}
		// Once the aspiration is affordable, release the reserve so the bot can
		// actually buy it instead of saving forever.
		return gold >= aspiration.cost ? 0 : aspiration.cost;
	}

	private chooseBotEconomicAction(
		player: PlayerState,
		budget: number,
		defensiveBudget = budget
	): BotEconomicAction | null {
		const profile = this.botProfiles[player.id - 1];
		const threat = this.botThreat[player.id - 1];
		const defensive = this.botDefensive[player.id - 1] === 1;
		const income = this.supplyIncomeFor(player.id);
		const cap = Math.max(1, this.supplyCap(player.id));
		const supplyRatio = this.supplyOf(player.id) / cap;
		const aspiration = this.botAspiration(player);
		const capGap = aspiration !== null && aspiration.cost > cap;
		if (capGap) {
			// While the aspiration is cap-blocked, only a War Academy build or
			// upgrade is useful. Returning null below the price prevents other
			// cheap actions from consuming the cap-growth savings.
			const academy = this.structures.forOwnerType(player.id, 'war-academy');
			const cost = academy
				? STRUCTURE_DEFINITIONS['war-academy'].cost + academy.stacks * UPGRADE_LEVEL_COST_STEP
				: STRUCTURE_DEFINITIONS['war-academy'].cost;
			if (cost > budget) return null;
			if (academy) {
				return {
					type: 'war-academy',
					kind: 'upgrade',
					cost,
					score: 10_000,
					structure: academy
				};
			}
			const cell = this.findBotBuildCell(player, 'war-academy');
			if (cell < 0) return null;
			return { type: 'war-academy', kind: 'build', cost, score: 10_000, cell };
		}
		if (
			!defensive &&
			aspiration?.type === 'artillery' &&
			!this.structures.forOwnerType(player.id, 'artillery') &&
			aspiration.cost <= this.botGold[player.id - 1]
		) {
			// A completed cap push must actually reach the expensive purchase;
			// don't let a small defensive reserve strand the bot one purchase
			// short of its first Artillery.
			const cell = this.findBotBuildCell(player, 'artillery');
			if (cell >= 0) {
				return {
					type: 'artillery',
					kind: 'build',
					cost: aspiration.cost,
					score: 10_000,
					cell
				};
			}
		}
		const earlyType = this.botEarlyEconomyType(player);
		const incomeGap = this.botIncomeGap[player.id - 1];
		const deterrence = this.botDeterrence[player.id - 1];
		const modules = profile.modules ?? DEFAULT_BOT_MODULES;
		const option = this.currentBotOption(player.id);
		const markovEconomy = this.markovBiasValue(player.id, 'economy');
		const markovDefense = this.markovBiasValue(player.id, 'defense');
		const markovNaval = this.markovBiasValue(player.id, 'naval');
		const owned = this.structures.forOwner(player.id);
		const candidates: BotEconomicAction[] = [];
		const order = new Map(BUILDABLE_STRUCTURE_TYPES.map((type, index) => [type, index] as const));

		for (const type of BUILDABLE_STRUCTURE_TYPES) {
			const definition = STRUCTURE_DEFINITIONS[type];
			const structures = owned.filter((structure) => structure.type === type);
			const count = structures.length;
			const totalStacks = structures.reduce((sum, structure) => sum + structure.stacks, 0);
			const isDefensive = type === 'fortification' || type === 'barracks' || type === 'jammer';
			const maxCopies =
				type === 'fortification'
					? 1 +
						Math.floor(profile.fortification / 60) +
						(defensive ? 1 : 0) +
						Math.min(BOT_DETERRENCE_MAX_EXTRA_COPIES, Math.floor(deterrence / 30))
					: type === 'barracks'
						? 1 + Math.floor(profile.aggression / 70)
						: type === 'command-post'
							? 2 + Math.floor(profile.command / 50)
							: 2 + Math.floor(profile.command / 70);
			const maxLevel =
				type === 'fortification'
					? 2 +
						Math.floor(profile.fortification / 40) +
						Math.floor(threat / 25) +
						(defensive ? 1 : 0) +
						Math.min(BOT_DETERRENCE_MAX_EXTRA_LEVELS, Math.floor(deterrence / 25))
					: type === 'barracks'
						? 1 + Math.floor(profile.aggression / 50) + Math.floor(threat / 25)
						: 1 + Math.floor(profile.command / 50) + Math.floor(threat / 25);

			// Base affinity plus exploration/diminishing returns. These are
			// utilities, not a fixed build order: the same bot can prefer cheap
			// fortification when threatened and artillery when rich and aggressive.
			let buildScore =
				profile.structureBias[type] +
				(count === 0 ? BOT_ACTION_NOVELTY_BONUS : -BOT_ACTION_REPEAT_PENALTY * count);
			switch (type) {
				case 'fortification':
					// Threat value is personal and diluted by repeated copies: a
					// defensive personality adds another fortification, while a
					// warlike bot still invests elsewhere. A stronger neighbour is
					// also a reason to build deterrent cover before they attack.
					buildScore += Math.floor(
						(threat * (1 + Math.floor(profile.fortification / 50)) + (defensive ? 20 : 0)) /
							(1 + totalStacks)
					);
					buildScore += scaledBonus(deterrence * BOT_DETERRENCE_FORT_UTILITY, modules.deterrence);
					if (option === 'fortify-front') buildScore += 60;
					buildScore += markovDefense;
					break;
				case 'barracks':
					buildScore +=
						Math.floor(profile.aggression * 0.15) +
						Math.floor(
							(threat * (1 + Math.floor(profile.aggression / 60)) + (defensive ? 8 : 0)) /
								(1 + totalStacks)
						);
					break;
				case 'jammer':
					buildScore += Math.floor(
						(threat * (1 + Math.floor(profile.command / 60)) + (defensive ? 6 : 0)) /
							(1 + totalStacks)
					);
					break;
				case 'command-post':
					// Income is always useful; a neighbour earning more makes it
					// urgent rather than optional.
					buildScore +=
						Math.max(0, 12 - income) * 2 +
						(supplyRatio > 0.85 ? 8 : 0) +
						scaledBonus(BOT_INCOME_UTILITY, modules.income) +
						scaledBonus(incomeGap * BOT_INCOME_GAP_COMMAND_POST_WEIGHT, modules.income);
					if (option === 'supply-ramp') buildScore += 60;
					buildScore += markovEconomy;
					break;
				case 'war-academy':
					buildScore +=
						(capGap ? 100 : 0) +
						(supplyRatio > 0.8 ? 18 : 0) +
						(cap < 400 ? 6 : 0) +
						scaledBonus(incomeGap * BOT_INCOME_GAP_WAR_ACADEMY_WEIGHT, modules.income);
					if (option === 'supply-ramp') buildScore += 60;
					buildScore += markovEconomy;
					break;
				case 'artillery':
					buildScore += (profile.aggression > 65 ? 12 : 0) + (player.territory > 5000 ? 4 : 0);
					break;
				case 'port': {
					// A coastal target worth landing on makes a Port useful even
					// before an enemy fleet exists; blocked land expansion makes it
					// the only way out.
					const navalTarget = this.chooseBotNavalTarget(player, false);
					buildScore += (count === 0 ? 16 : 0) + (player.territory > 4000 ? 6 : 0);
					if (navalTarget) {
						buildScore += Math.max(0, navalTarget.score);
						if (count === 0 && navalTarget.score >= BOT_NAVAL_MIN_SCORE) {
							buildScore += 80;
						}
					}
					if (this.botNeedsExpansion(player)) buildScore += 60;
					if (option === 'naval-opportunity') buildScore += 80;
					buildScore += markovNaval;
					break;
				}
			}
			// Shared opening ramp: economy structures dominate until the bot has
			// its first Command Post and War Academy line. Threat still pulls
			// defensive actions through the separate defensive budget path.
			// A threatened bot's emergency action must be defensive first;
			// otherwise a lower defensive reserve can release enough supply for
			// the opening ramp or cap growth to win instead.
			if (type === earlyType && !defensive) buildScore += BOT_EARLY_ECONOMY_UTILITY;
			// Do not let the economy opening permanently crowd out offense. Once
			// a basic economy exists, a first Barracks outranks further economy
			// investment until it is built.
			if (type === 'barracks' && count === 0 && this.botNeedsMilitaryOpening(player)) {
				buildScore += BOT_BARRACKS_OPENING_UTILITY;
			}
			if (defensive && type === 'fortification' && count === 0) {
				buildScore += scaledBonus(BOT_DEFENSE_FIRST_UTILITY, modules.defense);
			}
			// Cheap actions get a small efficiency nudge without making them
			// dominate expensive strategic choices.
			buildScore += Math.floor(1200 / (definition.cost + 100));
			if (
				(!isDefensive || count < maxCopies) &&
				definition.cost <= (isDefensive ? defensiveBudget : budget)
			) {
				candidates.push({
					type,
					kind: 'build',
					cost: definition.cost,
					score: buildScore
				});
			}

			if (type === 'port') continue; // Port has no district/effect to upgrade.
			if (count === 0) continue;
			const lowest = structures.reduce((best, structure) =>
				structure.stacks < best.stacks ||
				(structure.stacks === best.stacks && structure.id < best.id)
					? structure
					: best
			);
			const upgradeCost = definition.cost + lowest.stacks * UPGRADE_LEVEL_COST_STEP;
			let upgradeScore =
				Math.floor(profile.structureBias[type] * 0.55) +
				Math.max(0, 14 - Math.min(14, lowest.stacks)) * 2 -
				Math.floor(totalStacks * 0.4) +
				Math.floor(600 / (upgradeCost + 100));
			if (type === 'fortification') {
				// Pixel defense is the fastest way to blunt an active front, but
				// heavily stacked forts stop crowding out other investments.
				upgradeScore += Math.floor((threat * 3 + (defensive ? 20 : 0) + 10) / (1 + lowest.stacks));
				upgradeScore += scaledBonus(deterrence * BOT_DETERRENCE_FORT_UTILITY, modules.deterrence);
				if (defensive) {
					upgradeScore += scaledBonus(BOT_DEFENSE_FIRST_UTILITY, modules.defense);
				}
				if (option === 'fortify-front') upgradeScore += 60;
				upgradeScore += markovDefense;
			} else if (type === 'barracks' || type === 'jammer') {
				upgradeScore += Math.floor((threat * 2 + (defensive ? 12 : 0)) / (1 + lowest.stacks));
			} else if (type === 'command-post') {
				upgradeScore += scaledBonus(
					BOT_INCOME_UTILITY + incomeGap * BOT_INCOME_GAP_COMMAND_POST_WEIGHT,
					modules.income
				);
				if (option === 'supply-ramp') upgradeScore += 60;
				upgradeScore += markovEconomy;
			} else if (type === 'war-academy') {
				if (capGap) upgradeScore += 80;
				upgradeScore += scaledBonus(incomeGap * BOT_INCOME_GAP_WAR_ACADEMY_WEIGHT, modules.income);
				if (option === 'supply-ramp') upgradeScore += 60;
				upgradeScore += markovEconomy;
			}
			if (
				(!isDefensive || lowest.stacks < maxLevel) &&
				upgradeCost <= (isDefensive ? defensiveBudget : budget)
			) {
				candidates.push({
					type,
					kind: 'upgrade',
					cost: upgradeCost,
					score: upgradeScore,
					structure: lowest
				});
			}
		}

		candidates.sort((left, right) => {
			if (left.score !== right.score) return right.score - left.score;
			const leftOrder = order.get(left.type) ?? 0;
			const rightOrder = order.get(right.type) ?? 0;
			if (leftOrder !== rightOrder) return leftOrder - rightOrder;
			return left.kind === right.kind ? 0 : left.kind === 'build' ? -1 : 1;
		});

		for (const candidate of candidates) {
			if (candidate.kind === 'build') {
				const cell = this.findBotBuildCell(player, candidate.type);
				if (cell < 0) continue;
				candidate.cell = cell;
			}
			return candidate;
		}
		return null;
	}

	private runBotEconomy(): void {
		let auraChanged = false;
		for (const player of this.players) {
			if (!player.alive || !player.isBot) continue;
			// Stagger budgets across the interval. Every bot still evaluates once
			// per BOT_BUILD_INTERVAL, but 50 builds no longer land on one tick
			// (which also triggers a huge renderer district-tile batch).
			if ((this.tick + (player.id - 1)) % BOT_BUILD_INTERVAL !== 0) continue;
			if (this.tick % BOT_DECISION_INTERVAL !== 0) this.refreshBotThreat(player);
			const goldIndex = player.id - 1;
			const defensive = this.botDefensive[goldIndex] === 1;

			// If saving has made no defensive progress for several build
			// intervals, release the reserve for this interval. Otherwise a
			// stalemate could block every non-defensive purchase forever.
			if (defensive) {
				if (this.botDefenseStall[goldIndex] < 0xff) this.botDefenseStall[goldIndex]++;
			} else {
				this.botDefenseStall[goldIndex] = 0;
			}
			const stalled = this.botDefenseStall[goldIndex] >= BOT_DEFENSE_STALL_INTERVALS;
			const option = this.currentBotOption(player.id);
			const optionReserve =
				option === 'fortify-front' || option === 'conserve' ? this.defenseReserveTarget(player) : 0;
			const markovConserveReserve = stalled
				? 0
				: Math.max(0, this.markovBiasValue(player.id, 'conserve')) * 4;
			const reserve = stalled
				? 0
				: Math.max(this.botReserve[goldIndex], optionReserve) + markovConserveReserve;
			const strategicReserve = stalled ? 0 : this.botStrategicReserve(player);
			// One emergency defensive action per interval; otherwise a bot may
			// dump its whole reserve into stacked fortifications in one visit.
			const maxActions =
				defensive || this.botDifficulty === 'relaxed' ? 1 : BOT_ACTION_MAX_PER_INTERVAL;

			for (let action = 0; action < maxActions; action++) {
				const budget = this.botGold[goldIndex] - reserve - strategicReserve;
				if (budget <= 0 && !defensive) break;
				// A non-threatened bot must not spend its aspiration reserve on
				// cheap defensive actions; only an active defensive posture may
				// draw on the full treasury.
				const defensiveBudget = this.botNeedsMilitaryOpening(player)
					? Math.max(0, this.botGold[goldIndex] - strategicReserve)
					: this.botGold[goldIndex];
				const choice = this.chooseBotEconomicAction(player, budget, defensiveBudget);
				if (!choice) break;
				const choiceIsDefensive =
					choice.type === 'fortification' || choice.type === 'barracks' || choice.type === 'jammer';
				if (
					choice.cost >
					(choiceIsDefensive
						? this.botGold[goldIndex]
						: this.botGold[goldIndex] - reserve - strategicReserve)
				) {
					break;
				}

				if (defensive && choice.type === 'fortification') {
					if (choice.kind === 'build') this.botTelemetry.threatenedFortificationBuilds++;
					else this.botTelemetry.threatenedFortificationUpgrades++;
				}
				if (this.botIncomeGap[goldIndex] > 0) {
					if (choice.type === 'command-post' && choice.kind === 'build') {
						this.botTelemetry.incomeGapCommandPosts++;
					} else if (choice.type === 'war-academy' && choice.kind === 'build') {
						this.botTelemetry.incomeGapWarAcademies++;
					}
				}
				if (choice.type === 'port' && choice.kind === 'build') {
					this.botTelemetry.botPortBuilds++;
				}
				const playerMetrics = this.botPlayerMetrics[goldIndex];
				if (playerMetrics) {
					if (choice.kind === 'build') {
						if (choice.type === 'fortification') playerMetrics.fortificationsBuilt++;
						else if (choice.type === 'command-post') playerMetrics.commandPostsBuilt++;
						else if (choice.type === 'war-academy') playerMetrics.warAcademiesBuilt++;
						else if (choice.type === 'port') playerMetrics.portsBuilt++;
					} else if (choice.type === 'fortification') {
						playerMetrics.fortificationUpgrades++;
					}
				}

				if (choice.kind === 'build') {
					const cell = choice.cell;
					if (cell === undefined || cell < 0) break;
					this.botGold[goldIndex] -= choice.cost;
					const structure = this.structures.create(
						choice.type,
						player.id,
						cell % this.width,
						Math.floor(cell / this.width),
						this.width
					);
					this.refreshDistrictsAround(structure);
				} else {
					const structure = choice.structure;
					if (!structure) break;
					this.botGold[goldIndex] -= choice.cost;
					this.structures.reinforce(structure);
				}
				auraChanged = true;
				if (
					defensive &&
					(choice.type === 'fortification' ||
						choice.type === 'barracks' ||
						choice.type === 'jammer')
				) {
					this.botDefenseStall[goldIndex] = 0;
				}
			}
		}
		// Aura rebuilds still batch once per decision tick; district refreshes
		// are local to each new structure and already applied above.
		if (auraChanged) this.rebuildAuraDefense();
	}

	/**
	 * One defensive build/upgrade, attempted before the plan while threatened.
	 * Returns true when gold was spent, so the plan waits for the next build
	 * interval. Defence posts come first because they are cheap and cover a
	 * whole district; barracks come second because they raise clash strength.
	 */
	/**
	 * Gold a threatened bot holds back from non-defensive spending. It saves
	 * for the next missing defensive structure, then for the cheaper next
	 * defensive level, capped so it can never hoard without bound. A zero
	 * reserve is returned when no defensive action is possible at all, which
	 * keeps the reserve from deadlocking spending.
	 */
	private defenseReserveTarget(player: PlayerState): number {
		const fortificationStructure = this.structures.forOwnerType(player.id, 'fortification');
		if (!fortificationStructure) {
			if (this.findBotDefenseCell(player) < 0) return 0;
			return STRUCTURE_DEFINITIONS['fortification'].cost;
		}
		const barracks = this.structures.forOwnerType(player.id, 'barracks');
		if (!barracks) {
			if (this.findBotBuildCell(player, 'barracks') < 0) return 0;
			return Math.min(STRUCTURE_DEFINITIONS['barracks'].cost, BOT_DEFENSE_RESERVE_MAX);
		}
		const upgradeCost = Math.min(
			STRUCTURE_DEFINITIONS['fortification'].cost +
				fortificationStructure.stacks * UPGRADE_LEVEL_COST_STEP,
			STRUCTURE_DEFINITIONS['barracks'].cost + barracks.stacks * UPGRADE_LEVEL_COST_STEP
		);
		return Math.min(upgradeCost, BOT_DEFENSE_RESERVE_MAX);
	}

	/**
	 * Prefer a border cell that already touches an enemy so a new Defence Post
	 * projects its district over the threatened edge; otherwise fall back to a
	 * deterministic hash pick from valid border cells.
	 */
	private findBotDefenseCell(player: PlayerState): number {
		const candidates: number[] = [];
		const incomingTargets = this.attacks
			.filter((attack) => !attack.done && attack.defenderId === player.id)
			.map((attack) => ({ x: attack.targetX, y: attack.targetY }));
		let bestIndex = -1;
		let bestScore = -1;
		for (const index of player.border) {
			if (!this.isBotBuildCellValid(player, index)) continue;
			const contact = this.hostileNeighbourCount(index, player.id);
			const x = index % this.width;
			const y = (index - x) / this.width;
			let frontBonus = 0;
			for (const target of incomingTargets) {
				if (Math.abs(target.x - x) + Math.abs(target.y - y) <= 48) {
					frontBonus = 8;
					break;
				}
			}
			const score = contact * 10 + frontBonus;
			if (score > bestScore) {
				bestScore = score;
				bestIndex = index;
			}
			if (contact === 0 && candidates.length < 32) candidates.push(index);
		}
		if (bestIndex >= 0 && bestScore > 0) return bestIndex;
		if (candidates.length === 0) return -1;
		return candidates[hash32(this.tick, player.id, this.seed ^ 0x3c6ef372) % candidates.length];
	}

	private hostileNeighbourCount(index: number, playerId: number): number {
		const width = this.width;
		const height = this.height;
		const x = index % width;
		const y = (index - x) / width;
		let count = 0;
		if (x > 0 && this.isHostileOwner(index - 1, playerId)) count++;
		if (x + 1 < width && this.isHostileOwner(index + 1, playerId)) count++;
		if (y > 0 && this.isHostileOwner(index - width, playerId)) count++;
		if (y + 1 < height && this.isHostileOwner(index + width, playerId)) count++;
		return count;
	}

	private hasHostileNeighbour(index: number, playerId: number): boolean {
		const width = this.width;
		const height = this.height;
		const x = index % width;
		const y = (index - x) / width;
		if (x > 0 && this.isHostileOwner(index - 1, playerId)) return true;
		if (x + 1 < width && this.isHostileOwner(index + 1, playerId)) return true;
		if (y > 0 && this.isHostileOwner(index - width, playerId)) return true;
		if (y + 1 < height && this.isHostileOwner(index + width, playerId)) return true;
		return false;
	}

	private isHostileOwner(index: number, playerId: number): boolean {
		if (!this.land[index]) return false;
		const owner = this.owners[index];
		return owner !== 0 && owner !== playerId;
	}

	/**
	 * Refresh the per-bot threat score once per decision tick. Threat is an
	 * integer signal: active attacks targeting the bot, hostile pixels touching
	 * its border, and territory lost since the previous refresh (grievance
	 * delta). Posture uses hysteresis so a bot does not flip between saving and
	 * spending every second; the reserve is freed as soon as threat is safe.
	 */
	private botDecisionDue(playerId: number): boolean {
		return (this.tick + playerId - 1) % BOT_DECISION_INTERVAL === 0;
	}

	private updateBotThreat(): void {
		if (this.tick % BOT_DECISION_INTERVAL !== 0) return;

		this.botPressure.fill(0);
		this.botAttackers.fill(0);
		for (const attack of this.attacks) {
			// Neutral expansion fronts have defenderId 0 and threaten nobody.
			if (attack.done || attack.defenderId <= 0) continue;
			this.botPressure[attack.defenderId - 1]++;
			this.botAttackers[(attack.attackerId - 1) * this.playerCount + (attack.defenderId - 1)] = 1;
			this.botLastAttacker[attack.defenderId - 1] = attack.attackerId;
		}

		for (const player of this.players) this.refreshBotThreat(player);
	}

	/**
	 * Recompute one bot's threat/posture. Normally called for every bot on a
	 * decision tick; also called immediately before a staggered build tick so a
	 * budget decision never uses a stale posture.
	 */
	private refreshBotThreat(player: PlayerState): void {
		const index = player.id - 1;
		if (!player.alive || !player.isBot) {
			this.botThreat[index] = 0;
			if (!player.alive) {
				this.botDefensive[index] = 0;
				this.botReserve[index] = 0;
				this.botDefenseStall[index] = 0;
			}
			return;
		}

		let threat = Math.min(this.botPressure[index] * BOT_THREAT_PER_ATTACK, BOT_THREAT_ATTACK_CAP);
		threat += Math.min(
			this.botContactPressure(player) * BOT_THREAT_PER_CONTACT,
			BOT_THREAT_CONTACT_CAP
		);

		// Neighbours higher on the supply or strength curve are both a reason to
		// invest in economy and a reason to deter them with fortifications.
		const neighbours = this.botNeighborIds(player);
		let maxNeighbourIncome = 0;
		let maxNeighbourStrength = 0;
		for (const neighbourId of neighbours) {
			maxNeighbourIncome = Math.max(maxNeighbourIncome, this.supplyIncomeFor(neighbourId));
			maxNeighbourStrength = Math.max(
				maxNeighbourStrength,
				this.estimatePlayerStrength(neighbourId)
			);
		}
		this.botIncomeGap[index] = Math.min(
			0xff,
			Math.max(0, maxNeighbourIncome - this.supplyIncomeFor(player.id))
		);
		const strengthGap = Math.max(0, maxNeighbourStrength - this.estimatePlayerStrength(player.id));
		this.botDeterrence[index] = Math.min(
			0xffff,
			Math.floor(strengthGap / BOT_DETERRENCE_STRENGTH_DIVISOR)
		);
		const deterrenceContribution = Math.min(
			this.botDeterrence[index] * BOT_THREAT_PER_DETERRENCE,
			BOT_THREAT_DETERRENCE_CAP
		);
		threat += deterrenceContribution;

		// Grievances are cumulative; the delta since the last refresh is the
		// "recent territory loss" signal and decays on its own once the
		// fighting stops, so a grudge with no active war cannot hold the
		// reserve forever.
		let grievances = 0;
		const grievanceBase = index * this.playerCount;
		for (let attacker = 0; attacker < this.playerCount; attacker++) {
			grievances += this.botGrievance[grievanceBase + attacker];
		}
		const recentLosses = Math.max(0, grievances - this.botGrievanceMark[index]);
		this.botGrievanceMark[index] = grievances;
		threat += Math.min(recentLosses * BOT_THREAT_PER_LOSS, BOT_THREAT_LOSS_CAP);

		this.botThreat[index] = Math.min(0xffff, threat);
		const wasDefensive = this.botDefensive[index] === 1;
		const isDefensive = wasDefensive
			? this.botThreat[index] > BOT_THREAT_SAFE
			: this.botThreat[index] >= BOT_THREAT_DEFENSIVE;
		this.botDefensive[index] = isDefensive ? 1 : 0;
		if (isDefensive && !wasDefensive && deterrenceContribution > 0) {
			this.botTelemetry.deterrencePostures++;
		}
		this.botReserve[index] = isDefensive ? this.defenseReserveTarget(player) : 0;
		if (!isDefensive) this.botDefenseStall[index] = 0;
	}

	/** Hostile pixels adjacent to the bot's border, the cheapest contact metric. */
	private botContactPressure(player: PlayerState): number {
		let contact = 0;
		for (const index of player.border) {
			if (!this.hasHostileNeighbour(index, player.id)) continue;
			contact++;
			// Stop once the capped contribution is reached; borders can be long.
			if (contact * BOT_THREAT_PER_CONTACT >= BOT_THREAT_CONTACT_CAP) break;
		}
		return contact;
	}

	/** Unique hostile states touching this bot's border. */
	private botNeighborIds(player: PlayerState): number[] {
		const neighbours: number[] = [];
		const width = this.width;
		const height = this.height;
		for (const index of player.border) {
			const bx = index % width;
			const by = (index - bx) / width;
			if (bx > 0) this.addHostileNeighbor(neighbours, index - 1, player.id);
			if (bx + 1 < width) this.addHostileNeighbor(neighbours, index + 1, player.id);
			if (by > 0) this.addHostileNeighbor(neighbours, index - width, player.id);
			if (by + 1 < height) this.addHostileNeighbor(neighbours, index + width, player.id);
		}
		return neighbours;
	}

	private addHostileNeighbor(neighbours: number[], index: number, playerId: number): void {
		if (!this.land[index]) return;
		const owner = this.owners[index];
		if (owner === 0 || owner === playerId) return;
		if (!neighbours.includes(owner)) neighbours.push(owner);
	}

	private ensureBuildSiteCache(): void {
		const version = this.structures.version;
		const layoutVersion = this.structures.layoutVersion;
		if (
			this.buildSiteCacheTick === this.tick &&
			this.buildSiteCacheVersion === version &&
			this.buildSiteCacheLayoutVersion === layoutVersion
		) {
			return;
		}
		this.buildSiteCacheTick = this.tick;
		this.buildSiteCacheVersion = version;
		this.buildSiteCacheLayoutVersion = layoutVersion;
		this.buildSiteCache.fill(-2);
	}

	private stableBuildTypeIndex(type: BuildableStructureType): number {
		switch (type) {
			case 'port':
				return 0;
			case 'artillery':
				return 1;
			case 'command-post':
				return 2;
			case 'war-academy':
				return 3;
			default:
				return -1;
		}
	}

	private ensureStableBuildSiteCache(): void {
		const version = this.structures.version;
		const layoutVersion = this.structures.layoutVersion;
		if (
			this.stableBuildSiteCacheVersion === version &&
			this.stableBuildSiteCacheLayoutVersion === layoutVersion
		) {
			return;
		}
		this.stableBuildSiteCacheVersion = version;
		this.stableBuildSiteCacheLayoutVersion = layoutVersion;
		// Keep known-good sites: they are validated on read. Only unknown/negative
		// results need a fresh ring scan after layout changes.
		for (let i = 0; i < this.stableBuildSiteCache.length; i++) {
			if (this.stableBuildSiteCache[i] < 0) {
				this.stableBuildSiteCache[i] = -2;
				this.stableBuildSiteTick[i] = 0;
			}
		}
	}

	private findBotBuildCell(player: PlayerState, type: BuildableStructureType): number {
		const stableTypeIndex = this.stableBuildTypeIndex(type);
		if (stableTypeIndex >= 0) {
			this.ensureStableBuildSiteCache();
			const stableCacheIndex = (player.id - 1) * 4 + stableTypeIndex;
			let stableCached = this.stableBuildSiteCache[stableCacheIndex];
			if (stableCached >= 0) {
				if (this.isBotBuildCellValid(player, stableCached, type === 'port')) {
					return stableCached;
				}
				stableCached = -2;
			}
			// A negative result stays valid briefly. Sites only appear through
			// expansion, so re-scanning the full ring every tick is wasted work.
			const keepNegative =
				stableCached === -1 && this.tick - this.stableBuildSiteTick[stableCacheIndex] < 200;
			if (keepNegative) {
				if (type === 'port') return -1;
			} else {
				const stableSite = this.computeStableBotBuildCell(player, type);
				this.stableBuildSiteCache[stableCacheIndex] = stableSite;
				this.stableBuildSiteTick[stableCacheIndex] = this.tick;
				if (stableSite >= 0) return stableSite;
			}
			if (type === 'port') return -1;
		}

		this.ensureBuildSiteCache();
		const typeIndex = BUILDABLE_STRUCTURE_TYPES.indexOf(type);
		const cacheIndex = (player.id - 1) * BUILDABLE_STRUCTURE_TYPES.length + typeIndex;
		const cached = this.buildSiteCache[cacheIndex];
		if (cached !== -2) return cached;
		const result = this.computeBotBorderBuildCell(player);
		this.buildSiteCache[cacheIndex] = result;
		return result;
	}

	/** Port and inner-ring sites do not depend on the tick hash, only on ownership/layout. */
	private computeStableBotBuildCell(player: PlayerState, type: BuildableStructureType): number {
		if (type === 'port') {
			for (const index of player.border) {
				if (!isShoreIndex(this.land, this.width, this.height, index)) continue;
				if (this.isBotBuildCellValid(player, index, true)) return index;
			}
			return -1;
		}
		const state = this.structures.forOwnerType(player.id, 'state');
		if (!state) return -1;
		for (let radius = STRUCTURE_MIN_SPACING; radius <= 80; radius++) {
			for (let dy = -radius; dy <= radius; dy++) {
				for (let dx = -radius; dx <= radius; dx++) {
					if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
					const x = state.x + dx;
					const y = state.y + dy;
					if (x < 0 || y < 0 || x >= this.width || y >= this.height) continue;
					const index = y * this.width + x;
					if (this.owners[index] !== player.id) continue;
					if (this.isBotBuildCellValid(player, index)) return index;
				}
			}
		}
		return -1;
	}

	private computeBotBorderBuildCell(player: PlayerState): number {
		const candidates: number[] = [];
		for (const index of player.border) {
			if (!this.isBotBuildCellValid(player, index)) continue;
			candidates.push(index);
			if (candidates.length >= 32) break;
		}
		if (candidates.length === 0) return -1;
		return candidates[hash32(this.tick, player.id, this.seed ^ 0x51ed270b) % candidates.length];
	}

	private isBotBuildCellValid(player: PlayerState, index: number, ignoreDistrict = false): boolean {
		if (!this.land[index] || this.owners[index] !== player.id) return false;
		if (this.structures.at(index)) return false;
		if (!ignoreDistrict && this.districtStructureIds[index] !== 0) return false;
		const x = index % this.width;
		const y = (index - x) / this.width;
		return !this.structures.hasWithinRadius(x, y, STRUCTURE_MIN_SPACING);
	}

	/** Sea components reachable from a friendly Port. */
	private botPortSeaComponents(playerId: number): Set<number> {
		const seas = new Set<number>();
		const waters: number[] = [];
		for (const structure of this.structures.forOwner(playerId)) {
			if (structure.type !== 'port') continue;
			waters.length = 0;
			adjacentWater(this.land, this.width, this.height, structure.index, waters);
			for (const water of waters) {
				const sea = this.seaComponents[water] ?? 0;
				if (sea > 0) seas.add(sea);
			}
		}
		return seas;
	}

	/** Sea components touching owned shoreline, used for proposed Port sites. */
	private botCoastalSeaComponents(player: PlayerState): Set<number> {
		const seas = new Set<number>();
		const waters: number[] = [];
		for (const index of player.border) {
			if (!isShoreIndex(this.land, this.width, this.height, index)) continue;
			waters.length = 0;
			adjacentWater(this.land, this.width, this.height, index, waters);
			for (const water of waters) {
				const sea = this.seaComponents[water] ?? 0;
				if (sea > 0) seas.add(sea);
			}
		}
		return seas;
	}

	/**
	 * Sample coastal targets and score them for a naval landing. This is a
	 * deterministic opportunity score: supply-starved or weakly defended
	 * shores win, and poor targets are rejected by the caller's threshold.
	 */
	private chooseBotNavalTarget(
		player: PlayerState,
		usePorts = true
	): { index: number; score: number } | null {
		if (this.shoreIndices.length === 0) return null;
		const seas = usePorts
			? this.botPortSeaComponents(player.id)
			: this.botCoastalSeaComponents(player);
		if (seas.size === 0) return null;
		const waters: number[] = [];
		let bestIndex = -1;
		let bestScore = Number.NEGATIVE_INFINITY;
		for (let attempt = 0; attempt < BOT_NAVAL_SEARCH_TRIES; attempt++) {
			const salt = hash32(hash32(this.tick, player.id, attempt), this.seed ^ 0x68e31da4, 0);
			const index = this.shoreIndices[salt % this.shoreIndices.length];
			const owner = this.owners[index];
			if (owner === player.id || this.structures.at(index)) continue;
			if (owner > 0 && player.teamId !== 0 && this.players[owner - 1]?.teamId === player.teamId) {
				continue;
			}
			waters.length = 0;
			adjacentWater(this.land, this.width, this.height, index, waters);
			let connected = false;
			for (const water of waters) {
				const sea = this.seaComponents[water] ?? 0;
				if (sea > 0 && seas.has(sea)) {
					connected = true;
					break;
				}
			}
			if (!connected) continue;
			const x = index % this.width;
			const y = (index - x) / this.width;
			let score = 45 - this.getDefense(x, y) * BOT_ATTACK_DEFENSE_WEIGHT;
			if (owner > 0) {
				const supply = this.supplyOf(owner);
				const cap = Math.max(1, this.supplyCap(owner));
				if (supply * 100 < cap * 25) score += 25;
				else if (supply < this.attackSupplyCost(owner, player.id)) score += 12;
				if (this.estimatePlayerStrength(owner) > this.estimatePlayerStrength(player.id)) {
					score += 4;
				}
			} else {
				score += 4;
			}
			let nearestPort = Number.POSITIVE_INFINITY;
			for (const structure of this.structures.forOwner(player.id)) {
				if (structure.type !== 'port') continue;
				nearestPort = Math.min(nearestPort, Math.abs(structure.x - x) + Math.abs(structure.y - y));
			}
			if (Number.isFinite(nearestPort)) {
				score -= Math.floor(nearestPort / BOT_NAVAL_DISTANCE_PENALTY_DIVISOR);
			}
			if (score > bestScore) {
				bestScore = score;
				bestIndex = index;
			}
		}
		return bestIndex >= 0 ? { index: bestIndex, score: bestScore } : null;
	}

	private currentBotOption(playerId: number): BotOptionId | null {
		return botOptionFromCode(this.botOption[playerId - 1] ?? 0);
	}

	private markovBiasValue(
		playerId: number,
		key: 'economy' | 'attack' | 'defense' | 'naval' | 'conserve'
	): number {
		if (!this.botProfiles[playerId - 1]?.markov) return 0;
		const offset = ['economy', 'attack', 'defense', 'naval', 'conserve'].indexOf(key);
		const value = this.botMarkovBias[(playerId - 1) * 5 + offset] ?? 50;
		return Math.floor((value - 50) / 5);
	}

	private enterBotMarkovState(index: number, stateId: number): void {
		const controller = this.botProfiles[index]?.markov;
		if (!controller || controller.states.length === 0) return;
		const state = controller.states[Math.max(0, Math.min(controller.states.length - 1, stateId))];
		if (!state) return;
		this.botMarkovState[index] = controller.states.indexOf(state);
		this.botMarkovEntry[index] = this.tick;
		this.botMarkovBias[index * 5] = state.bias.economy;
		this.botMarkovBias[index * 5 + 1] = state.bias.attack;
		this.botMarkovBias[index * 5 + 2] = state.bias.defense;
		this.botMarkovBias[index * 5 + 3] = state.bias.naval;
		this.botMarkovBias[index * 5 + 4] = state.bias.conserve;
		this.botOption[index] = BOT_OPTION_CODES[state.option];
		this.botOptionUntil[index] = this.tick + state.dwell;
		this.botOptionTarget[index] = 0;
		this.botTelemetry.optionSelections[state.option]++;
	}

	private markovConditionMet(
		condition: MarkovCondition,
		player: PlayerState,
		index: number
	): boolean {
		const supplyRatio = this.supplyOf(player.id) / Math.max(1, this.supplyCap(player.id));
		switch (condition) {
			case 'always':
				return true;
			case 'threat-high':
				return this.botThreat[index] >= 20;
			case 'threat-low':
				return this.botThreat[index] <= 10;
			case 'income-behind':
				return this.botIncomeGap[index] > 0;
			case 'income-ahead': {
				const ownIncome = this.incomeOf(player.id);
				const neighbours = this.botNeighborIds(player);
				return neighbours.length > 0 && neighbours.every((id) => this.incomeOf(id) <= ownIncome);
			}
			case 'supply-low':
				return supplyRatio < 0.35;
			case 'supply-high':
				return supplyRatio > 0.75;
			case 'weak-neighbor':
				return this.botOpportunityCandidate(player) !== null;
			case 'ally-pressure':
				return this.botCoalitionCandidate(player) !== null;
		}
	}

	private tryBotMarkovTransition(player: PlayerState, index: number): void {
		const controller = this.botProfiles[index]?.markov;
		if (!controller) return;
		const current = Math.min(controller.states.length - 1, this.botMarkovState[index] ?? 0);
		const state = controller.states[current];
		if (!state) return;
		if (this.tick - this.botMarkovEntry[index] < state.dwell) return;
		for (let edge = 0; edge < controller.transitions.length; edge++) {
			const transition = controller.transitions[edge];
			if (transition.from !== current) continue;
			if (!this.markovConditionMet(transition.when, player, index)) continue;
			const roll = hash32(this.tick, player.id, this.seed ^ (edge * 0x9e3779b1)) % 100;
			if (roll >= transition.chance) continue;
			this.enterBotMarkovState(index, transition.to);
			return;
		}
		this.botOptionUntil[index] = this.tick + 20;
	}

	/**
	 * Strategic/option layer. Options are committed for a short horizon so the
	 * tactical utility layer executes a coherent plan instead of flip-flopping
	 * every decision tick.
	 */
	private updateBotOptions(): void {
		if (this.tick % BOT_DECISION_INTERVAL !== 0) return;
		for (const player of this.players) {
			if (!player.alive || !player.isBot) continue;
			const index = player.id - 1;
			const current = this.currentBotOption(player.id);
			if (current && this.tick < this.botOptionUntil[index]) continue;

			const profile = this.botProfiles[index];
			if (profile.markov) {
				if (this.tick < this.botOptionUntil[index]) continue;
				this.tryBotMarkovTransition(player, index);
				continue;
			}
			const threat = this.botThreat[index];
			const supplyRatio = this.supplyOf(player.id) / Math.max(1, this.supplyCap(player.id));
			const hasPort = this.structures.forOwnerType(player.id, 'port') !== undefined;
			const naval = this.chooseBotNavalTarget(player, hasPort);
			const opportunity = this.botOpportunityCandidate(player);
			const coalition = this.botCoalitionCandidate(player);
			const neutralBorder = this.botNeutralBorderCount(player);
			const scores: Array<{ id: BotOptionId; score: number; target: number }> = [
				{
					id: 'supply-ramp',
					score:
						20 +
						this.botIncomeGap[index] * 3 +
						(supplyRatio < 0.35 ? 35 : 0) +
						(this.botNeedsExpansion(player) ? 10 : 0),
					target: 0
				},
				{
					id: 'fortify-front',
					score:
						12 +
						threat * 2 +
						this.botDeterrence[index] * 2 +
						(this.botDefensive[index] === 1 ? 30 : 0),
					target: 0
				},
				{
					id: 'expand',
					score: 14 + neutralBorder * 2 + (this.botNeedsExpansion(player) ? 25 : 0),
					target: 0
				},
				{
					id: 'naval-opportunity',
					score: naval ? naval.score + (hasPort ? 15 : 25) : 0,
					target: naval ? (this.owners[naval.index] ?? 0) : 0
				},
				{
					id: 'exploit-weakness',
					score: opportunity ? opportunity.score + Math.floor(profile.opportunist * 0.2) : 0,
					target: opportunity?.target ?? 0
				},
				{
					id: 'coalition-strike',
					score: coalition ? coalition.score : 0,
					target: coalition?.target ?? 0
				},
				{
					id: 'conserve',
					score:
						Math.floor((1 - supplyRatio) * 55) +
						(threat > 50 ? 15 : 0) +
						(this.botDeterrence[index] > 25 ? 10 : 0),
					target: 0
				}
			];
			scores.sort(
				(left, right) =>
					right.score - left.score || BOT_OPTION_CODES[left.id] - BOT_OPTION_CODES[right.id]
			);
			let best = scores[0];
			if (current) {
				const currentScore = scores.find((entry) => entry.id === current)?.score ?? 0;
				if (best.score - currentScore < BOT_OPTION_SWITCH_MARGIN) {
					best = { id: current, score: currentScore, target: this.botOptionTarget[index] };
				}
			}
			const duration =
				BOT_OPTION_MIN_TICKS +
				(hash32(this.tick, player.id, this.seed ^ 0x165667b1) %
					(BOT_OPTION_MAX_TICKS - BOT_OPTION_MIN_TICKS + 1));
			this.botOption[index] = BOT_OPTION_CODES[best.id];
			this.botOptionUntil[index] = this.tick + duration;
			this.botOptionTarget[index] = best.target;
			this.botTelemetry.optionSelections[best.id]++;
		}
	}

	private botOpportunityCandidate(player: PlayerState): { target: number; score: number } | null {
		let bestTarget = 0;
		let bestScore = 0;
		for (const owner of this.botNeighborIds(player)) {
			if (owner === player.id) continue;
			if (player.teamId !== 0 && this.players[owner - 1]?.teamId === player.teamId) {
				continue;
			}
			const supply = this.supplyOf(owner);
			const cap = Math.max(1, this.supplyCap(owner));
			const lowSupply = supply * 100 < cap * 25 || supply < this.attackSupplyCost(owner, player.id);
			if (!lowSupply) continue;
			const stronger = this.estimatePlayerStrength(owner) > this.estimatePlayerStrength(player.id);
			const score =
				(stronger ? 55 : 30) +
				Math.floor(((cap - supply) / cap) * 30) +
				(this.botPressure[owner - 1] > 0 ? 10 : 0);
			if (score > bestScore) {
				bestScore = score;
				bestTarget = owner;
			}
		}
		return bestTarget > 0 ? { target: bestTarget, score: bestScore } : null;
	}

	private botCoalitionCandidate(player: PlayerState): { target: number; score: number } | null {
		if (player.teamId === 0) return null;
		let bestTarget = 0;
		let bestScore = 0;
		for (const attack of this.attacks) {
			if (attack.done || attack.attackerId === player.id) continue;
			if (this.players[attack.attackerId - 1]?.teamId !== player.teamId) continue;
			if (attack.defenderId === 0) continue;
			if (this.players[attack.defenderId - 1]?.teamId === player.teamId) continue;
			const score = 30 + Math.floor(attack.strength / 200);
			if (score > bestScore) {
				bestScore = score;
				bestTarget = attack.defenderId;
			}
		}
		return bestTarget > 0 ? { target: bestTarget, score: bestScore } : null;
	}

	private botNeutralBorderCount(player: PlayerState): number {
		let count = 0;
		let visited = 0;
		for (const index of player.border) {
			if (visited++ > 240) break;
			const x = index % this.width;
			const y = (index - x) / this.width;
			if (x > 0 && (this.owners[index - 1] ?? 0) === 0) count++;
			if (x + 1 < this.width && (this.owners[index + 1] ?? 0) === 0) count++;
			if (y > 0 && (this.owners[index - this.width] ?? 0) === 0) count++;
			if (y + 1 < this.height && (this.owners[index + this.width] ?? 0) === 0) count++;
		}
		return Math.min(20, count);
	}

	private runBotNaval(): void {
		for (const player of this.players) {
			if (!player.alive || !player.isBot) continue;
			if (!this.botDecisionDue(player.id)) continue;
			if (this.structures.forOwnerType(player.id, 'port') === undefined) continue;
			if (this.navalLandings.some((landing) => landing.ownerId === player.id)) continue;
			const target = this.chooseBotNavalTarget(player);
			if (!target || target.score < BOT_NAVAL_MIN_SCORE) continue;
			const targetOwner = this.owners[target.index] ?? 0;
			const option = this.currentBotOption(player.id);
			if (
				option === 'naval-opportunity' &&
				this.botOptionTarget[player.id - 1] !== 0 &&
				this.botOptionTarget[player.id - 1] !== targetOwner
			) {
				continue;
			}
			const cost = this.attackSupplyCost(player.id, targetOwner) + STRUCTURE_DEFINITIONS.port.cost;
			const reserve = this.botReserve[player.id - 1] ?? 0;
			if (this.supplyOf(player.id) < cost + reserve) continue;
			const profile = this.botProfiles[player.id - 1];
			const chance = Math.min(
				80,
				BOT_NAVAL_LAUNCH_CHANCE +
					Math.floor((target.score - BOT_NAVAL_MIN_SCORE) * 0.5) +
					Math.floor(profile.aggression * 0.2) +
					(option === 'naval-opportunity' ? 15 : 0) +
					this.markovBiasValue(player.id, 'naval')
			);
			const roll = hash32(hash32(this.tick, player.id, target.index), this.seed ^ 0x27d4eb2d, 0);
			if (roll % 100 >= chance) continue;
			const x = target.index % this.width;
			const y = (target.index - x) / this.width;
			if (this.tryLaunchNaval(player.id, x, y)) {
				this.botTelemetry.botNavalLandings++;
				const metrics = this.botPlayerMetrics[player.id - 1];
				if (metrics) metrics.navalLandings++;
			}
		}
	}

	private runBotDecisions(): void {
		// botPressure and botAttackers are refreshed by updateBotThreat() at the
		// same interval, just before the economy pass.
		const strengths = this.botStrengthCache;
		if (!this.botStrengthCacheReady) {
			this.botStrengthCacheReady = true;
			for (const player of this.players) {
				if (player.alive) strengths[player.id - 1] = this.estimatePlayerStrength(player.id);
			}
		}

		for (const player of this.players) {
			if (!player.alive || !player.isBot) continue;
			if (!this.botDecisionDue(player.id)) continue;
			const decisionEpoch = this.botDecisionEpoch[player.id - 1]++;
			strengths[player.id - 1] = this.estimatePlayerStrength(player.id);
			if (this.supplyOf(player.id) < this.attackSupplyCost(player.id, 0)) continue;
			if (player.border.size === 0) continue;
			const profile = this.botProfiles[player.id - 1];
			const neutralOnly = this.inBotEarlyEconomyRamp(player);
			let choice = this.chooseBotAttackTarget(
				player,
				profile,
				strengths[player.id - 1],
				strengths,
				neutralOnly
			);
			// If neutral expansion is fully blocked, the economy opening must not
			// deadlock: fall back to the best hostile border.
			if (choice === null && neutralOnly) {
				choice = this.chooseBotAttackTarget(player, profile, strengths[player.id - 1], strengths);
			}
			if (choice === null) continue;

			// Attack frequency is a utility judgement, not a flat aggression
			// roll: valuable targets attract attacks, poor/weak targets and
			// threatened bots save supply instead.
			const defenderId = this.owners[choice.index];
			const supply = this.supplyOf(player.id);
			const cost = this.attackSupplyCost(player.id, defenderId);
			const expansionIndex = player.id - 1;
			let expand =
				this.botExpansionCached[expansionIndex] === 1 &&
				this.tick - this.botExpansionTick[expansionIndex] < BOT_BUILD_INTERVAL;
			if (!expand) {
				expand = this.botNeedsExpansion(player);
				if (expand) {
					this.botExpansionCached[expansionIndex] = 1;
					this.botExpansionTick[expansionIndex] = this.tick;
				}
			}
			// Saving for an aspiration must not freeze expansion. Keep at most
			// half the stock (or a small floor) for the save and cap the
			// next-purchase buffer; take max instead of stacking both.
			const saveKeep = Math.max(
				BOT_ATTACK_SAVE_KEEP_FLOOR,
				Math.floor(supply * BOT_ATTACK_SAVE_KEEP_FRACTION)
			);
			const waitingForBarracks = this.botNeedsMilitaryOpening(player);
			const strategicReserve =
				expand && !waitingForBarracks ? 0 : Math.min(this.botStrategicReserve(player), saveKeep);
			const economicBuffer = expand
				? 0
				: Math.min(this.botEconomicBuffer(player), BOT_ATTACK_ECONOMIC_BUFFER_CAP);
			const reservedForEconomy = Math.max(strategicReserve, economicBuffer);
			const option = this.currentBotOption(player.id);
			const optionReserve =
				option === 'fortify-front' || option === 'conserve' ? this.defenseReserveTarget(player) : 0;
			const available =
				supply - Math.max(this.botReserve[player.id - 1], optionReserve) - reservedForEconomy;
			if (available < cost) continue;
			const cap = Math.max(1, this.supplyCap(player.id));
			const pressure = Math.floor((supply / cap) * BOT_ATTACK_SUPPLY_PRESSURE_WEIGHT);
			const incomePenalty = Math.min(
				BOT_INCOME_GAP_ATTACK_PENALTY_CAP,
				this.botIncomeGap[player.id - 1] * BOT_INCOME_GAP_ATTACK_PENALTY
			);
			const opportunityBonus = choice.opportunity ? BOT_OPPORTUNITY_CHANCE_BONUS : 0;
			const supportingAlly = defenderId > 0 && this.teammateAttacking(player.id, defenderId);
			const optionChance =
				(option === 'expand' && defenderId === 0 ? 15 : 0) +
				(option === 'exploit-weakness' && choice.opportunity ? 15 : 0) +
				(option === 'coalition-strike' && supportingAlly ? 15 : 0) -
				(option === 'fortify-front' || option === 'conserve' ? 12 : 0) +
				this.markovBiasValue(player.id, 'attack');
			const difficultyChance =
				this.botDifficulty === 'relaxed' ? 0.75 : this.botDifficulty === 'ruthless' ? 1.25 : 1;
			const chance = Math.max(
				0,
				Math.min(
					80,
					Math.floor(
						(BOT_ATTACK_BASE_CHANCE +
							Math.floor((choice.targetScore - BOT_ATTACK_SCORE_CENTER) * BOT_ATTACK_SCORE_WEIGHT) +
							Math.floor(profile.aggression * BOT_ATTACK_AGGRESSION_WEIGHT) +
							pressure +
							opportunityBonus +
							optionChance -
							incomePenalty) *
							difficultyChance
					)
				)
			);
			const attackRoll = hash32(decisionEpoch, player.id, this.seed ^ 0x27d4eb2d) % 100;
			if (attackRoll >= chance) continue;
			if (choice.opportunity) this.botTelemetry.opportunityAttacks++;
			const metrics = this.botPlayerMetrics[player.id - 1];
			if (metrics) {
				metrics.attacksLaunched++;
				if (supportingAlly) metrics.supportedAttacks++;
				if (defenderId > 0) {
					const weaker =
						choice.opportunity ||
						this.estimatePlayerStrength(defenderId) * 100 <
							this.estimatePlayerStrength(player.id) * 85 ||
						this.supplyOf(defenderId) * 10 < this.supplyOf(player.id) * 6;
					if (weaker) metrics.attacksVsWeakerStates++;
				}
			}
			this.createAttack(player.id, choice.index, [choice.index]);
		}
	}

	private runBotArtillery(): void {
		for (const player of this.players) {
			if (!player.alive || !player.isBot) continue;
			if (!this.botDecisionDue(player.id)) continue;
			const ready = this.structures
				.forOwner(player.id)
				.filter(
					(structure) =>
						structure.type === 'artillery' && this.artilleryReadyAt(structure) <= this.tick
				);
			if (ready.length === 0) continue;

			let best: Structure | null = null;
			let bestScore = Number.NEGATIVE_INFINITY;
			for (const structure of this.structures.all) {
				if (structure.ownerId === player.id) continue;
				if (player.teamId !== 0 && this.players[structure.ownerId - 1]?.teamId === player.teamId) {
					continue;
				}
				if (structure.type === 'state') continue;
				let nearest = Number.POSITIVE_INFINITY;
				for (const battery of ready) {
					const dx = battery.x - structure.x;
					const dy = battery.y - structure.y;
					const distance = dx * dx + dy * dy;
					if (distance < nearest) nearest = distance;
				}
				if (nearest > ARTILLERY_RANGE * ARTILLERY_RANGE) continue;
				const priority =
					structure.type === 'war-academy'
						? 70
						: structure.type === 'artillery'
							? 60
							: structure.type === 'barracks'
								? 50
								: structure.type === 'command-post'
									? 40
									: 30;
				const score = structure.stacks * 1000 + priority * 5 - nearest;
				if (score > bestScore || (score === bestScore && structure.id < (best?.id ?? 0))) {
					best = structure;
					bestScore = score;
				}
			}
			if (!best) continue;
			this.fireArtilleryVolley(player.id, best.x, best.y);
		}
	}

	private estimatePlayerStrength(playerId: number): number {
		const player = this.players[playerId - 1];
		if (!player) return 0;
		this.ensureStructureCache();
		let levels = 0;
		const base = (playerId - 1) * 8;
		for (let index = 0; index < 8; index++) levels += this.structureStacksByType[base + index];
		return Math.floor(player.territory / 4) + levels * 300 + this.supplyOf(playerId) * 2;
	}

	private chooseBotAttackTarget(
		player: PlayerState,
		profile: BotProfile,
		selfStrength: number,
		strengths: Uint32Array,
		neutralOnly = false
	): { index: number; score: number; targetScore: number; opportunity: boolean } | null {
		let bestIndex = -1;
		let bestScore = Number.NEGATIVE_INFINITY;
		let bestTargetScore = 0;
		let bestOpportunity = false;
		// Target utility depends on the defender, not the sampled contact cell.
		// Cache it so a decision pays for roughly four targets rather than 96.
		const targetStamp = ++this.botTargetStamp;
		const samples = BOT_SEARCH_TRIES * 3;
		for (let attempt = 0; attempt < samples; attempt++) {
			const borderIndex = this.pickBorderCell(player);
			if (borderIndex === null) break;
			const width = this.width;
			const x = borderIndex % width;
			const y = (borderIndex - x) / width;
			const neighbours = [
				x > 0 ? borderIndex - 1 : -1,
				x + 1 < width ? borderIndex + 1 : -1,
				y > 0 ? borderIndex - width : -1,
				y + 1 < this.height ? borderIndex + width : -1
			];
			for (const index of neighbours) {
				if (index < 0 || !this.land[index]) continue;
				const defenderId = this.owners[index];
				if (defenderId === player.id) continue;
				if (
					defenderId > 0 &&
					player.teamId !== 0 &&
					this.players[defenderId - 1]?.teamId === player.teamId
				) {
					continue;
				}
				// Opening economy ramp: expand into neutral ground but avoid
				// opening state wars before the Command Post/War Academy line.
				if (neutralOnly && defenderId !== 0) continue;
				let targetScore: number;
				let targetOpportunity: boolean;
				if (this.botTargetScoreStamp[defenderId] === targetStamp) {
					targetScore = this.botTargetScore[defenderId] ?? 0;
					targetOpportunity = this.botTargetOpportunity[defenderId] === 1;
				} else {
					const scored = this.scoreBotTarget(
						player.id,
						profile,
						defenderId,
						selfStrength,
						strengths
					);
					targetScore = scored.score;
					targetOpportunity = scored.opportunity;
					this.botTargetScoreStamp[defenderId] = targetStamp;
					this.botTargetScore[defenderId] = targetScore;
					this.botTargetOpportunity[defenderId] = targetOpportunity ? 1 : 0;
				}
				// Prefer the cheapest ground on the preferred target: fortified
				// or elevated contact cells are deprioritized.
				const defense = this.getDefense(x, y);
				const score = targetScore - defense * BOT_ATTACK_DEFENSE_WEIGHT;
				if (score > bestScore) {
					bestScore = score;
					bestTargetScore = targetScore;
					bestOpportunity = targetOpportunity;
					bestIndex = index;
				}
			}
		}
		return bestIndex >= 0
			? {
					index: bestIndex,
					score: bestScore,
					targetScore: bestTargetScore,
					opportunity: bestOpportunity
				}
			: null;
	}

	private scoreBotTarget(
		attackerId: number,
		profile: BotProfile,
		defenderId: number,
		selfStrength: number,
		strengths: Uint32Array
	): { score: number; opportunity: boolean } {
		const threatened = this.botDefensive[attackerId - 1] === 1;
		const modules = profile.modules ?? DEFAULT_BOT_MODULES;
		if (defenderId === 0) {
			// With a war at home, quiet neutral expansion beats opening a new front.
			return {
				score:
					45 +
					Math.floor(profile.aggression * 0.15) +
					(threatened ? BOT_THREAT_NEUTRAL_BIAS : 0) +
					Math.floor((modules.expansion - 50) / 5),
				opportunity: false
			};
		}
		if (defenderId === attackerId) return { score: Number.NEGATIVE_INFINITY, opportunity: false };
		if (
			this.players[attackerId - 1]?.teamId !== 0 &&
			this.players[attackerId - 1]?.teamId === this.players[defenderId - 1]?.teamId
		) {
			return { score: Number.NEGATIVE_INFINITY, opportunity: false };
		}

		let score = 25 + Math.floor(profile.aggression * 0.6);
		const grudge = this.botGrievance[(attackerId - 1) * this.playerCount + (defenderId - 1)];
		if (grudge > 0) {
			score += 20 + Math.floor(profile.vengeful * 1.2) + Math.min(grudge, 20);
		}
		const option = this.currentBotOption(attackerId);
		if (
			(option === 'exploit-weakness' || option === 'coalition-strike') &&
			this.botOptionTarget[attackerId - 1] === defenderId
		) {
			score += 25;
		}
		if (this.botLastAttacker[attackerId - 1] === defenderId) {
			score += 8;
		}
		const pressure = this.botPressure[defenderId - 1];
		if (pressure > 0) {
			score += pressure * (5 + Math.floor(profile.opportunist * 0.5));
		}

		const targetStrength = strengths[defenderId - 1];
		const stronger = targetStrength > Math.floor(selfStrength * 1.1);
		const defenderSupply = this.supplyOf(defenderId);
		const defenderCap = Math.max(1, this.supplyCap(defenderId));
		const lowSupply =
			defenderSupply * 100 < defenderCap * BOT_OPPORTUNITY_LOW_SUPPLY_PERCENT ||
			defenderSupply < this.attackSupplyCost(defenderId, attackerId);
		const opportunity = stronger && lowSupply;
		if (stronger) {
			// A normally cautious bot still pounces when a stronger neighbour
			// has spent its supply and cannot counterattack.
			const cautionWeight = opportunity ? 0.35 : 0.7;
			const conciliationWeight = opportunity ? 0.5 : 1.0;
			score -= Math.floor(profile.cautious * cautionWeight);
			score -= Math.floor(profile.conciliatory * conciliationWeight);
		} else if (targetStrength < Math.floor(selfStrength * 0.85)) {
			score += 10 + Math.floor(profile.opportunist * 0.15);
		}
		if (this.teammateAttacking(attackerId, defenderId)) {
			score += BOT_TEAM_COORDINATION_BONUS;
		}
		if (lowSupply) {
			score += scaledBonus(
				BOT_OPPORTUNITY_STRONGER_BONUS + Math.floor(profile.opportunist * 0.6),
				modules.opportunity
			);
		} else if (defenderSupply >= this.attackSupplyCost(defenderId, attackerId)) {
			score -= Math.floor(profile.cautious * 0.4);
		}

		if (threatened) {
			// High threat biases retaliation: an adjacent grudge holder or an
			// active attacker is worth more than an unrelated third party, and
			// unrelated aggression is devalued so the bot can defend instead.
			const counterAttacking =
				this.botAttackers[(defenderId - 1) * this.playerCount + (attackerId - 1)] === 1;
			if (grudge > 0) {
				score += scaledBonus(
					BOT_THREAT_RETALIATE_BONUS + Math.floor(profile.vengeful * 0.5),
					modules.retaliation
				);
			}
			if (counterAttacking) {
				score += scaledBonus(BOT_THREAT_COUNTER_BONUS, modules.retaliation);
			}
			if (grudge === 0 && !counterAttacking) score -= BOT_THREAT_UNRELATED_PENALTY;
		}
		return { score, opportunity };
	}

	/** Team AI coordination: an ally already pressing this defender. */
	private teammateAttacking(attackerId: number, defenderId: number): boolean {
		const teamId = this.players[attackerId - 1]?.teamId ?? 0;
		if (teamId === 0) return false;
		for (const attack of this.attacks) {
			if (attack.done || attack.defenderId !== defenderId) continue;
			if (attack.attackerId === attackerId) continue;
			if (this.players[attack.attackerId - 1]?.teamId === teamId) return true;
		}
		return false;
	}

	private pickBorderCell(player: PlayerState): number | null {
		const size = player.border.size;
		if (size === 0) return null;
		let skip = this.rng.nextInt(size);
		for (const index of player.border) {
			if (skip === 0) return index;
			skip--;
		}
		return null;
	}

	private placeStartingTerritories(starts: StartPoint[]): void {
		for (let i = 0; i < this.players.length; i++) {
			const start = starts[i % starts.length];
			const player = this.players[i];
			const outerRadius = START_RADIUS + 8;

			for (let dy = -outerRadius; dy <= outerRadius; dy++) {
				const y = start.y + dy;
				if (y < 0 || y >= this.height) continue;
				for (let dx = -outerRadius; dx <= outerRadius; dx++) {
					const x = start.x + dx;
					if (x < 0 || x >= this.width) continue;

					// Perturb the frontier with an integer hash so beachheads read
					// as rough coastline rather than perfect circles.
					// Relative-to-start wobble keeps beachheads equally rough for every state.
					const wobble =
						0.82 + (hash32(Math.abs(dx), dy + outerRadius, this.seed ^ 0x9e37) & 0xff) / 1450;
					const radius = START_RADIUS * wobble;
					if (dx * dx + dy * dy > radius * radius) continue;

					const index = y * this.width + x;
					if (!this.land[index] || this.owners[index] !== 0) continue;
					this.owners[index] = player.id;
					player.territory++;
				}
			}
		}
	}

	/**
	 * Safety net for pathological start placements. Spacing is selected so this
	 * should never fire, but every state must begin with at least one pixel.
	 */
	private ensureEveryStateHasLand(): void {
		for (let i = 0; i < this.players.length; i++) {
			const player = this.players[i];
			if (player.territory > 0) continue;

			const start = this.map.starts[i % this.map.starts.length];
			const offset = start.y * this.width + start.x;
			for (let step = 0; step < this.owners.length; step++) {
				const index = (offset + step) % this.owners.length;
				if (!this.land[index] || this.owners[index] !== 0) continue;
				this.owners[index] = player.id;
				player.territory = 1;
				break;
			}
		}
	}

	private updateEliminations(): void {
		for (const player of this.players) {
			if (!player.alive || player.territory > 0) continue;
			player.alive = false;
			player.border.clear();
			const killer = this.lastAttackerOf[player.id - 1];
			const killerPlayer = killer > 0 ? this.players[killer - 1] : undefined;
			let rewardText = '';
			if (killer > 0 && killer !== player.id) {
				const killerMetrics = this.botPlayerMetrics[killer - 1];
				if (killerMetrics) killerMetrics.statesEliminated++;
				if (killerPlayer?.alive) {
					this.eliminationIncomeStacks[killer - 1]++;
					rewardText = ` ${killerPlayer.name} gains +${ELIMINATION_SUPPLY_INCOME_BONUS} supply/s.`;
				}
			}
			this.pushEvent(
				'elimination',
				`${player.name} has been erased from the map.${rewardText}`,
				player.id
			);
		}

		this.attacks = this.attacks.filter((attack) => {
			const attacker = this.players[attack.attackerId - 1];
			return attacker?.alive === true;
		});
	}

	private checkVictory(): void {
		if (this.ended) return;
		const alive = this.players.filter((player) => player.alive);
		if (alive.length === 0) return;

		if (this.matchDurationTicks > 0 && this.tick >= this.matchDurationTicks) {
			let leader = alive[0];
			for (const player of alive) {
				if (
					player.territory > leader.territory ||
					(player.territory === leader.territory && player.id < leader.id)
				) {
					leader = player;
				}
			}
			this.ended = true;
			this.winnerId = leader.id;
			this.pushEvent(
				'victory',
				`Time expires. ${leader.name} controls the most land and wins.`,
				leader.id
			);
			return;
		}

		for (const player of alive) {
			if (player.territory * 100 < this.landCount * SUPPLY_WIN_SHARE) continue;
			this.ended = true;
			this.winnerId = player.id;
			this.pushEvent(
				'victory',
				`${player.name} controls ${SUPPLY_WIN_SHARE}% of the land and wins.`,
				player.id
			);
			return;
		}

		if (alive.length !== 1) return;
		this.ended = true;
		this.winnerId = alive[0].id;
		this.pushEvent('victory', `${alive[0].name} controls the world.`, alive[0].id);
	}

	private buildSnapshot(): GameSnapshot {
		let claimedLand = 0;
		const players: PublicPlayer[] = this.players.map((player) => {
			claimedLand += player.territory;
			return {
				id: player.id,
				name: player.name,
				isBot: player.isBot,
				alive: player.alive,
				territory: player.territory,
				landShare: this.landCount === 0 ? 0 : player.territory / this.landCount,
				supply: this.supplyOf(player.id),
				attacksAffordable: this.affordableAttackCount(
					player.id,
					this.allPlayersBots ? 0 : HUMAN_PLAYER_ID
				)
			};
		});

		return {
			tick: this.tick,
			seed: this.seed,
			landCount: this.landCount,
			claimedLand,
			players,
			attacks: this.attacks.map((attack) => this.toPublicAttack(attack)),
			shells: this.artilleryShells.map((shell) => this.toPublicShell(shell)),
			navalLandings: this.navalLandings.map((landing) => this.toPublicNavalLanding(landing)),
			structures: this.structures.all.map((structure) => this.toPublicStructure(structure)),
			gold: this.supplyOf(HUMAN_PLAYER_ID),
			income: this.supplyIncomeFor(HUMAN_PLAYER_ID),
			supply: this.supplyOf(HUMAN_PLAYER_ID),
			supplyCap: this.supplyCap(HUMAN_PLAYER_ID),
			supplyIncome: this.supplyIncomeFor(HUMAN_PLAYER_ID),
			hand: this.hand.map((card) => ({ id: card.id, type: card.type })),
			attackOrders: 0,
			attackOrderCap: 0,
			winnerId: this.winnerId,
			ended: this.ended,
			humanId: this.allPlayersBots ? 0 : HUMAN_PLAYER_ID,
			growthMode: this.growthMode
		};
	}

	private toPublicAttack(attack: AttackState): PublicAttack {
		return {
			id: attack.id,
			attackerId: attack.attackerId,
			defenderId: attack.defenderId,
			targetX: attack.targetX,
			targetY: attack.targetY,
			orders: attack.orders,
			strength: attack.strength,
			initialStrength: attack.initialStrength,
			power: attack.power,
			pierce: attack.pierce,
			captures: attack.captures,
			growthMode: attack.growthMode
		};
	}

	private toPublicStructure(structure: Structure): PublicStructure {
		return {
			id: structure.id,
			type: structure.type,
			ownerId: structure.ownerId,
			x: structure.x,
			y: structure.y,
			stacks: structure.stacks,
			effects: structure.effects,
			readyAtTick: this.artilleryReadyAt(structure)
		};
	}

	private toPublicNavalLanding(landing: NavalLanding): PublicNavalLanding {
		const span = Math.max(1, landing.arriveAtTick - landing.launchedAtTick);
		const elapsed = Math.max(0, Math.min(span, this.tick - landing.launchedAtTick));
		const path = landing.path.filter(
			(_, index) => index % 8 === 0 || index === landing.path.length - 1
		);
		return { ...landing, path, progress: elapsed / span };
	}

	/** Read-only landing view for the 2D overlay. */
	get activeNavalLandings(): readonly PublicNavalLanding[] {
		return this.navalLandings.map((landing) => this.toPublicNavalLanding(landing));
	}

	private toPublicShell(shell: ArtilleryShell): PublicArtilleryShell {
		const span = Math.max(1, shell.arriveAtTick - shell.launchedAtTick);
		const elapsed = Math.max(0, Math.min(span, this.tick - shell.launchedAtTick));
		return { ...shell, progress: elapsed / span };
	}

	/** Read-only shell view for the 2D structure overlay. */
	get activeShells(): readonly ArtilleryShell[] {
		return this.artilleryShells;
	}

	private pushEvent(kind: SimEventKind, message: string, playerId?: number): void {
		this.events.push({
			id: this.nextEventId++,
			tick: this.tick,
			kind,
			message,
			playerId
		});
	}
}

function fail(reason: AttackFailure, message: string): AttackOrderResult {
	return { ok: false, reason, message };
}

function growthModeCode(mode: GrowthMode): number {
	switch (mode) {
		case 'circular':
			return 1;
		case 'smooth':
			return 2;
		case 'organic':
			return 3;
	}
}

/** Bilinear coarse value noise plus a faint per-pixel jitter, both integer. */
function districtNoise(x: number, y: number, seed: number): number {
	const cell = DISTRICT_NOISE_CELL;
	const ix = Math.floor(x / cell);
	const iy = Math.floor(y / cell);
	const fx = x - ix * cell;
	const fy = y - iy * cell;
	const a = hash32(ix, iy, seed) & 0xff;
	const b = hash32(ix + 1, iy, seed) & 0xff;
	const c = hash32(ix, iy + 1, seed) & 0xff;
	const d = hash32(ix + 1, iy + 1, seed) & 0xff;
	const coarse =
		(a * (cell - fx) * (cell - fy) + b * fx * (cell - fy) + c * (cell - fx) * fy + d * fx * fy) /
		(cell * cell);
	const fine = hash32(x, y, seed ^ 0x85ebca6b) & 0xff;
	return (Math.floor(coarse) * 3 + fine) >> 2;
}
