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
	BOT_ACTION_MAX_PER_INTERVAL,
	BOT_ACTION_NOVELTY_BONUS,
	BOT_ACTION_REPEAT_PENALTY,
	BOT_STRATEGIC_SAVE_MIN_STRUCTURES,
	BOT_ATTACK_AGGRESSION_WEIGHT,
	BOT_ATTACK_BASE_CHANCE,
	BOT_ATTACK_SCORE_CENTER,
	BOT_ATTACK_SCORE_WEIGHT,
	BOT_ATTACK_SUPPLY_PRESSURE_WEIGHT,
	BOT_BUILD_INTERVAL,
	BOT_DEFENSE_RESERVE_MAX,
	BOT_DEFENSE_STALL_INTERVALS,
	BOT_DECISION_INTERVAL,
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
	DISTRICT_NOISE_CELL,
	DISTRICT_NOISE_MARGIN,
	BOT_SEARCH_TRIES,
	HUMAN_PLAYER_ID,
	INCOME_INTERVAL_TICKS,
	LEAST_RESISTANCE_SAMPLE_SIZE,
	OCCUPIED_DEFENSE_BONUS,
	PLAYER_COUNT,
	PLAYER_NAMES,
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
import { TerritoryIntegrity } from './integrity';
import { generateMap, hash32, type GeneratedMap, type StartPoint } from './map';
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

export interface PlayerState {
	id: number;
	name: string;
	isBot: boolean;
	alive: boolean;
	territory: number;
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

export interface PublicPlayer {
	id: number;
	name: string;
	isBot: boolean;
	alive: boolean;
	territory: number;
	landShare: number;
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
}

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

export interface GameSnapshot {
	tick: number;
	seed: number;
	landCount: number;
	claimedLand: number;
	players: PublicPlayer[];
	attacks: PublicAttack[];
	shells: PublicArtilleryShell[];
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
	'elimination' | 'victory' | 'structure' | 'build' | 'attack' | 'artillery' | 'system';

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
	| 'district-clearance';

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

export type GameCommand = AttackCommand | ArtilleryFireCommand | BuildCommand | UpgradeCommand;

export type BuildFailure =
	| 'ended'
	| 'eliminated'
	| 'no-card'
	| 'no-gold'
	| 'ocean'
	| 'not-owned'
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

export interface SimulationOptions {
	seed: number;
	width?: number;
	height?: number;
	growthMode?: GrowthMode;
}

const CHANGE_BUFFER_SIZE = 16_384;

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
	readonly map: GeneratedMap;
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
	/** Grievance total each bot held at the previous threat refresh. */
	private readonly botGrievanceMark: Uint32Array;
	/** botAttackers[attacker * PLAYER_COUNT + defender] = 1 while a front is live. */
	private readonly botAttackers: Uint8Array;
	private readonly rng: DeterministicRng;
	private readonly land: Uint8Array;
	private readonly shade: Uint8Array;
	private readonly elevation: Uint8Array;
	private readonly landCount: number;
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
	private readonly integrity: TerritoryIntegrity;
	readonly structures: StructureRegistry;
	/** Derived stack totals per owner/type code; refreshed only when the registry mutates. */
	private readonly structureStacksByType = new Uint32Array(PLAYER_COUNT * 8);
	private structureCacheVersion = -1;
	private mergedGroupsCache: MergedDistrictGroup[] = [];
	private mergedGroupsLayoutVersion = -1;
	private mergedGroupsComputedTick = -1000;

	constructor(options: SimulationOptions) {
		const width = options.width ?? undefined;
		const height = options.height ?? undefined;
		if (width !== undefined || height !== undefined) {
			throw new Error(
				'Custom map dimensions are not supported by the versioned map generator yet.'
			);
		}

		this.seed = options.seed >>> 0;
		this.growthMode =
			options.growthMode && isGrowthMode(options.growthMode)
				? options.growthMode
				: DEFAULT_GROWTH_MODE;
		this.map = generateMap(this.seed);
		this.width = this.map.width;
		this.height = this.map.height;
		this.land = this.map.land;
		this.shade = this.map.shade;
		this.elevation = this.map.elevation;
		this.landCount = this.map.landCount;
		this.owners = new Uint16Array(this.width * this.height);
		this.claimedBy = new Uint32Array(this.width * this.height);
		this.auraDefense = new Uint16Array(this.width * this.height);
		this.districtTypes = new Uint8Array(this.width * this.height);
		this.districtStructureIds = new Uint32Array(this.width * this.height);
		this.districtColorCodes = new Uint8Array(this.width * this.height);
		this.integrity = new TerritoryIntegrity(this.width, this.height, PLAYER_COUNT);

		if (this.landCount <= 0) throw new Error('Generated map has no land.');

		this.players = Array.from({ length: PLAYER_COUNT }, (_, i) => ({
			id: i + 1,
			name: PLAYER_NAMES[i] ?? `State ${i + 1}`,
			isBot: i !== HUMAN_PLAYER_ID - 1,
			alive: true,
			territory: 0,
			border: new Set<number>()
		}));

		this.rng = new DeterministicRng((this.seed ^ 0x6a09e667) >>> 0);
		this.botGold = new Array<number>(PLAYER_COUNT).fill(0);
		this.botGoldAccrual = new Uint16Array(PLAYER_COUNT);
		this.botGrievance = new Uint16Array(PLAYER_COUNT * PLAYER_COUNT);
		this.botPressure = new Uint16Array(PLAYER_COUNT);
		this.botThreat = new Uint16Array(PLAYER_COUNT);
		this.botDefensive = new Uint8Array(PLAYER_COUNT);
		this.botReserve = new Uint8Array(PLAYER_COUNT);
		this.botDefenseStall = new Uint8Array(PLAYER_COUNT);
		this.botGrievanceMark = new Uint32Array(PLAYER_COUNT);
		this.botAttackers = new Uint8Array(PLAYER_COUNT * PLAYER_COUNT);
		this.botProfiles = Array.from({ length: PLAYER_COUNT }, (_, index) =>
			this.createBotProfile(index + 1)
		);
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
		this.attackOrders = new Array<number>(PLAYER_COUNT).fill(0);
		this.setSupply(HUMAN_PLAYER_ID, STARTING_GOLD);
		for (const player of this.players) {
			if (player.isBot) this.setSupply(player.id, BOT_STARTING_GOLD);
		}

		this.pushEvent('system', `${PLAYER_COUNT} states deployed. Attack freely.`);
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
		let income = BASE_GOLD_INCOME + Math.floor(player.territory / SUPPLY_INCOME_TERRITORY_DIVISOR);
		for (const type of STRUCTURE_TYPES) {
			const stacks = this.stacksOfType(playerId, type);
			if (stacks === 0) continue;
			for (const effect of STRUCTURE_DEFINITIONS[type].effects) {
				if (effect.kind === 'supply-income') income += effect.perSecond * stacks;
			}
		}
		return income;
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
		return playerId === HUMAN_PLAYER_ID ? this.gold : (this.botGold[playerId - 1] ?? 0);
	}

	private setSupply(playerId: number, value: number): void {
		const clamped = Math.max(0, Math.min(this.supplyCap(playerId), value));
		if (playerId === HUMAN_PLAYER_ID) this.gold = clamped;
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

	/**
	 * Supply accrues continuously from territory and live resource structures.
	 * Rates are per second and converted with an integer remainder at 10 Hz.
	 */
	private accrueResources(): void {
		this.goldAccrual += this.income * TICK_RATE;
		const earnedGold = Math.floor(this.goldAccrual / INCOME_INTERVAL_TICKS);
		if (earnedGold > 0) {
			this.creditSupply(HUMAN_PLAYER_ID, earnedGold);
			this.goldAccrual -= earnedGold * INCOME_INTERVAL_TICKS;
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
		if (structure.type === 'state') this.annexRequested = true;
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
		const index = roundedY * this.width + roundedX;
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
		const districtId = this.districtStructureIds[index];
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
		if (this.structures.hasWithinRadius(roundedX, roundedY, STRUCTURE_MIN_SPACING)) {
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
			message: `Build ${STRUCTURE_DEFINITIONS[card.type].label} for ${baseCost} supply.`
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

			// Threat must refresh before the economy and decision passes so a
			// front opened this tick is already visible to the defender.
			this.updateBotThreat();
			this.runBotEconomy();
			this.runBotDecisions();
			this.runBotArtillery();
			this.processArtilleryShells();
			this.processAttacks();
			const annexDue =
				this.tick % ANNEX_INTERVAL_TICKS === 0 ||
				(this.annexRequested && this.tick - this.lastAnnexTick >= ANNEX_INTERVAL_TICKS);
			if (annexDue) {
				this.annexRequested = false;
				this.lastAnnexTick = this.tick;
				this.annexDisconnectedTerritory();
			}
			if (this.tick % UNCLAIMED_CLEANUP_INTERVAL_TICKS === 0) {
				this.cleanupUnclaimedPockets();
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
		mix(this.gold);
		mix(this.goldAccrual);
		for (const botGold of this.botGold) mix(botGold);
		for (const botAccrual of this.botGoldAccrual) mix(botAccrual);
		for (const grievance of this.botGrievance) mix(grievance);
		for (const threat of this.botThreat) mix(threat);
		for (const defensive of this.botDefensive) mix(defensive);
		for (const reserve of this.botReserve) mix(reserve);
		for (const stall of this.botDefenseStall) mix(stall);
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
				const targetIndex = command.y * this.width + command.x;
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
					command.x,
					command.y,
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
				this.claim(index, attack.attackerId, attack.id);
				attackPoints -= chosenCost;
				attack.strength -= chosenCost;
				attack.captures++;
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
		if (other.strength <= 0) other.done = true;

		if (attack.strength <= 0) {
			attack.done = true;
			this.annexRequested = true;
			return 'halted';
		}
		return 'blocked';
	}

	private annexDisconnectedTerritory(): void {
		const stateAnchors = this.structures.all.filter((structure) => structure.type === 'state');
		this.integrity.run(this.owners, this.land, stateAnchors, (index, newOwner) => {
			this.claim(index, newOwner, 0);
		});
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
			const previous = this.players[previousOwner - 1];
			previous.territory--;
			previous.border.delete(index);
			if (sourceAttackId !== 0) {
				const attack = this.attacks.find((entry) => entry.id === sourceAttackId);
				if (attack && attack.attackerId !== previousOwner) {
					const grudge = (previousOwner - 1) * PLAYER_COUNT + (attack.attackerId - 1);
					if (this.botGrievance[grudge] < 0xffff) this.botGrievance[grudge]++;
				}
			}
		}

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

	private recordChange(index: number, owner: number): void {
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
				(hash32(playerId, 14, seed) % 20)
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
			structureBias
		};
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

	private botStrategicReserve(player: PlayerState): number {
		const aspiration = this.botAspiration(player);
		if (!aspiration) return 0;
		const gold = this.botGold[player.id - 1];
		const cap = Math.max(1, this.supplyCap(player.id));
		if (aspiration.cost > cap) {
			// The stock cap, not income, is the bottleneck. Set the save target
			// to the next War Academy level so the aspiration becomes reachable.
			const academy = this.structures.forOwnerType(player.id, 'war-academy');
			const capCost = academy
				? STRUCTURE_DEFINITIONS['war-academy'].cost + academy.stacks * UPGRADE_LEVEL_COST_STEP
				: STRUCTURE_DEFINITIONS['war-academy'].cost;
			return gold >= capCost ? 0 : capCost;
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
					? 1 + Math.floor(profile.fortification / 60) + (defensive ? 1 : 0)
					: type === 'barracks'
						? 1 + Math.floor(profile.aggression / 70)
						: 1 + Math.floor(profile.command / 70);
			const maxLevel =
				type === 'fortification'
					? 2 +
						Math.floor(profile.fortification / 40) +
						Math.floor(threat / 25) +
						(defensive ? 1 : 0)
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
					// warlike bot still invests elsewhere.
					buildScore += Math.floor(
						(threat * (1 + Math.floor(profile.fortification / 50)) + (defensive ? 20 : 0)) /
							(1 + totalStacks)
					);
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
					buildScore += Math.max(0, 12 - income) * 2 + (supplyRatio > 0.85 ? 8 : 0);
					break;
				case 'war-academy':
					buildScore += (capGap ? 100 : 0) + (supplyRatio > 0.8 ? 18 : 0) + (cap < 400 ? 6 : 0);
					break;
				case 'artillery':
					buildScore += (profile.aggression > 65 ? 12 : 0) + (player.territory > 5000 ? 4 : 0);
					break;
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
			} else if (type === 'barracks' || type === 'jammer') {
				upgradeScore += Math.floor((threat * 2 + (defensive ? 12 : 0)) / (1 + lowest.stacks));
			} else if (type === 'war-academy' && capGap) {
				upgradeScore += 80;
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

		if (capGap) {
			// The cap blocks the aspiration; treat cap growth as the dominant
			// utility rather than letting cheap upgrades consume the savings.
			const academy = this.structures.forOwnerType(player.id, 'war-academy');
			if (academy) {
				const cost =
					STRUCTURE_DEFINITIONS['war-academy'].cost + academy.stacks * UPGRADE_LEVEL_COST_STEP;
				if (cost <= budget) {
					candidates.push({
						type: 'war-academy',
						kind: 'upgrade',
						cost,
						score: 10_000,
						structure: academy
					});
				}
			} else {
				const cost = STRUCTURE_DEFINITIONS['war-academy'].cost;
				if (cost <= budget) {
					candidates.push({
						type: 'war-academy',
						kind: 'build',
						cost,
						score: 10_000
					});
				}
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
			const reserve = stalled ? 0 : this.botReserve[goldIndex];
			const strategicReserve = stalled ? 0 : this.botStrategicReserve(player);
			// One emergency defensive action per interval; otherwise a bot may
			// dump its whole reserve into stacked fortifications in one visit.
			const maxActions = defensive ? 1 : BOT_ACTION_MAX_PER_INTERVAL;

			for (let action = 0; action < maxActions; action++) {
				const budget = this.botGold[goldIndex] - reserve - strategicReserve;
				if (budget <= 0 && !defensive) break;
				const choice = this.chooseBotEconomicAction(player, budget, this.botGold[goldIndex]);
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
		for (const index of player.border) {
			if (!this.isBotBuildCellValid(player, index)) continue;
			if (this.hasHostileNeighbour(index, player.id)) return index;
			candidates.push(index);
			if (candidates.length >= 32) break;
		}
		if (candidates.length === 0) return -1;
		return candidates[hash32(this.tick, player.id, this.seed ^ 0x3c6ef372) % candidates.length];
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
	private updateBotThreat(): void {
		if (this.tick % BOT_DECISION_INTERVAL !== 0) return;

		this.botPressure.fill(0);
		this.botAttackers.fill(0);
		for (const attack of this.attacks) {
			// Neutral expansion fronts have defenderId 0 and threaten nobody.
			if (attack.done || attack.defenderId <= 0) continue;
			this.botPressure[attack.defenderId - 1]++;
			this.botAttackers[(attack.attackerId - 1) * PLAYER_COUNT + (attack.defenderId - 1)] = 1;
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

		// Grievances are cumulative; the delta since the last refresh is the
		// "recent territory loss" signal and decays on its own once the
		// fighting stops, so a grudge with no active war cannot hold the
		// reserve forever.
		let grievances = 0;
		const grievanceBase = index * PLAYER_COUNT;
		for (let attacker = 0; attacker < PLAYER_COUNT; attacker++) {
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

	private findBotBuildCell(player: PlayerState, type: BuildableStructureType): number {
		if (type === 'artillery' || type === 'command-post' || type === 'war-academy') {
			const state = this.structures.forOwnerType(player.id, 'state');
			if (state) {
				for (let radius = STRUCTURE_MIN_SPACING; radius <= 80; radius++) {
					for (let dy = -radius; dy <= radius; dy++) {
						for (let dx = -radius; dx <= radius; dx++) {
							if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
							const x = state.x + dx;
							const y = state.y + dy;
							if (x < 0 || y < 0 || x >= this.width || y >= this.height) continue;
							const index = y * this.width + x;
							if (this.isBotBuildCellValid(player, index)) return index;
						}
					}
				}
			}
		}

		const candidates: number[] = [];
		for (const index of player.border) {
			if (!this.isBotBuildCellValid(player, index)) continue;
			candidates.push(index);
			if (candidates.length >= 32) break;
		}
		if (candidates.length === 0) return -1;
		return candidates[hash32(this.tick, player.id, this.seed ^ 0x51ed270b) % candidates.length];
	}

	private isBotBuildCellValid(player: PlayerState, index: number): boolean {
		if (!this.land[index] || this.owners[index] !== player.id) return false;
		if (this.structures.at(index) || this.districtStructureIds[index] !== 0) return false;
		const x = index % this.width;
		const y = (index - x) / this.width;
		return !this.structures.hasWithinRadius(x, y, STRUCTURE_MIN_SPACING);
	}

	private runBotDecisions(): void {
		if (this.tick % BOT_DECISION_INTERVAL !== 0) return;

		// botPressure and botAttackers are refreshed by updateBotThreat() at the
		// same interval, just before the economy pass.
		const strengths = new Uint32Array(PLAYER_COUNT);
		for (const player of this.players) {
			if (player.alive) strengths[player.id - 1] = this.estimatePlayerStrength(player.id);
		}

		for (const player of this.players) {
			if (!player.alive || !player.isBot) continue;
			if (this.supplyOf(player.id) < this.attackSupplyCost(player.id, 0)) continue;
			if (player.border.size === 0) continue;
			const profile = this.botProfiles[player.id - 1];
			const choice = this.chooseBotAttackTarget(
				player,
				profile,
				strengths[player.id - 1],
				strengths
			);
			if (choice === null) continue;

			// Attack frequency is a utility judgement, not a flat aggression
			// roll: valuable targets attract attacks, poor/weak targets and
			// threatened bots save supply instead.
			const defenderId = this.owners[choice.index];
			const supply = this.supplyOf(player.id);
			const cost = this.attackSupplyCost(player.id, defenderId);
			const expand = this.botNeedsExpansion(player);
			const strategicReserve = expand ? 0 : this.botStrategicReserve(player);
			const economicBuffer = expand ? 0 : this.botEconomicBuffer(player);
			const available = supply - this.botReserve[player.id - 1] - strategicReserve - economicBuffer;
			if (available < cost) continue;
			const cap = Math.max(1, this.supplyCap(player.id));
			const pressure = Math.floor((supply / cap) * BOT_ATTACK_SUPPLY_PRESSURE_WEIGHT);
			const chance = Math.max(
				0,
				Math.min(
					75,
					BOT_ATTACK_BASE_CHANCE +
						Math.floor((choice.score - BOT_ATTACK_SCORE_CENTER) * BOT_ATTACK_SCORE_WEIGHT) +
						Math.floor(profile.aggression * BOT_ATTACK_AGGRESSION_WEIGHT) +
						pressure
				)
			);
			const attackRoll = hash32(this.tick, player.id, this.seed ^ 0x27d4eb2d) % 100;
			if (attackRoll >= chance) continue;
			this.createAttack(player.id, choice.index, [choice.index]);
		}
	}

	private runBotArtillery(): void {
		if (this.tick % BOT_DECISION_INTERVAL !== 0) return;
		for (const player of this.players) {
			if (!player.alive || !player.isBot) continue;
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
		strengths: Uint32Array
	): { index: number; score: number } | null {
		let bestIndex = -1;
		let bestScore = Number.NEGATIVE_INFINITY;
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
				const score = this.scoreBotTarget(player.id, profile, defenderId, selfStrength, strengths);
				if (score > bestScore) {
					bestScore = score;
					bestIndex = index;
				}
			}
		}
		return bestIndex >= 0 ? { index: bestIndex, score: bestScore } : null;
	}

	private scoreBotTarget(
		attackerId: number,
		profile: BotProfile,
		defenderId: number,
		selfStrength: number,
		strengths: Uint32Array
	): number {
		const threatened = this.botDefensive[attackerId - 1] === 1;
		if (defenderId === 0) {
			// With a war at home, quiet neutral expansion beats opening a new front.
			return (
				45 + Math.floor(profile.aggression * 0.15) + (threatened ? BOT_THREAT_NEUTRAL_BIAS : 0)
			);
		}
		if (defenderId === attackerId) return Number.NEGATIVE_INFINITY;

		let score = 25 + Math.floor(profile.aggression * 0.6);
		const grudge = this.botGrievance[(attackerId - 1) * PLAYER_COUNT + (defenderId - 1)];
		if (grudge > 0) {
			score += 20 + Math.floor(profile.vengeful * 1.2) + Math.min(grudge, 20);
		}
		const pressure = this.botPressure[defenderId - 1];
		if (pressure > 0) {
			score += pressure * (5 + Math.floor(profile.opportunist * 0.5));
		}

		const targetStrength = strengths[defenderId - 1];
		if (targetStrength > Math.floor(selfStrength * 1.1)) {
			score -= Math.floor(profile.cautious * 0.7);
			score -= Math.floor(profile.conciliatory * 1.0);
		} else if (targetStrength < Math.floor(selfStrength * 0.85)) {
			score += 10 + Math.floor(profile.opportunist * 0.15);
		}
		if (this.supplyOf(defenderId) >= this.attackSupplyCost(defenderId, attackerId)) {
			score -= Math.floor(profile.cautious * 0.4);
		}

		if (threatened) {
			// High threat biases retaliation: an adjacent grudge holder or an
			// active attacker is worth more than an unrelated third party, and
			// unrelated aggression is devalued so the bot can defend instead.
			const counterAttacking =
				this.botAttackers[(defenderId - 1) * PLAYER_COUNT + (attackerId - 1)] === 1;
			if (grudge > 0) {
				score += BOT_THREAT_RETALIATE_BONUS + Math.floor(profile.vengeful * 0.5);
			}
			if (counterAttacking) score += BOT_THREAT_COUNTER_BONUS;
			if (grudge === 0 && !counterAttacking) score -= BOT_THREAT_UNRELATED_PENALTY;
		}
		return score;
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
					const wobble = 0.82 + (hash32(x, y, this.seed ^ (i * 0x9e37)) & 0xff) / 1450;
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
			this.pushEvent('elimination', `${player.name} has been erased from the map.`, player.id);
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
				landShare: this.landCount === 0 ? 0 : player.territory / this.landCount
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
			structures: this.structures.all.map((structure) => this.toPublicStructure(structure)),
			gold: this.gold,
			income: this.income,
			supply: this.gold,
			supplyCap: this.supplyCap(HUMAN_PLAYER_ID),
			supplyIncome: this.income,
			hand: this.hand.map((card) => ({ id: card.id, type: card.type })),
			attackOrders: 0,
			attackOrderCap: 0,
			winnerId: this.winnerId,
			ended: this.ended,
			humanId: HUMAN_PLAYER_ID,
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
