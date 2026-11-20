import {
	ANNEX_INTERVAL_TICKS,
	ATTACK_DAMAGE_PER_TICK,
	ATTACK_LIFETIME_TICKS,
	ATTACK_ORDER_DAMAGE_BONUS,
	ATTACK_ORDER_DEFENSE_PIERCE,
	ATTACK_ORDER_LIFETIME_BONUS,
	ATTACK_SEARCH_RADIUS,
	BASE_BOT_ATTACK_ORDERS,
	BASE_DEFENSE_OFFSET,
	BASE_GOLD_INCOME,
	BASE_HUMAN_ATTACK_ORDERS,
	BOT_BUILD_INTERVAL,
	BOT_DECISION_INTERVAL,
	BOT_STARTING_GOLD,
	DISTRICT_NOISE_CELL,
	DISTRICT_NOISE_MARGIN,
	BOT_SEARCH_TRIES,
	COMMAND_POST_ORDER_TICKS,
	HUMAN_PLAYER_ID,
	INCOME_INTERVAL_TICKS,
	ATTACK_ORDER_GAIN_TICKS,
	LEAST_RESISTANCE_SAMPLE_SIZE,
	OCCUPIED_DEFENSE_BONUS,
	PLAYER_COUNT,
	PLAYER_NAMES,
	STARTING_GOLD,
	START_RADIUS,
	STRUCTURE_MIN_SPACING,
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
	BARRACKS_LEVELS_PER_ORDER,
	BARRACKS_MAX_BONUS_ORDERS,
	BUILDABLE_STRUCTURE_TYPES,
	StructureRegistry,
	STRUCTURE_DEFINITIONS,
	STRUCTURE_TYPE_CODES,
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
}

export interface PublicAttack {
	id: number;
	attackerId: number;
	defenderId: number;
	targetX: number;
	targetY: number;
	orders: number;
	captures: number;
	growthMode: GrowthMode;
}

export interface GameSnapshot {
	tick: number;
	seed: number;
	landCount: number;
	claimedLand: number;
	players: PublicPlayer[];
	attacks: PublicAttack[];
	structures: PublicStructure[];
	/** Human state's economy. Bots do not build cards yet. */
	gold: number;
	income: number;
	hand: PublicCard[];
	attackOrders: number;
	attackOrderCap: number;
	winnerId: number | null;
	ended: boolean;
	humanId: number;
	/** Growth layer used by attacks created from now on. */
	growthMode: GrowthMode;
}

export type SimEventKind = 'elimination' | 'victory' | 'structure' | 'build' | 'system';

export interface SimEvent {
	id: number;
	tick: number;
	kind: SimEventKind;
	message: string;
	playerId?: number;
}

export type AttackFailure =
	'ended' | 'eliminated' | 'ocean' | 'own-territory' | 'no-shared-border' | 'no-orders' | 'invalid';

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
	sequence: number;
}

export type GameCommand = AttackCommand | BuildCommand | UpgradeCommand;

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
	| 'no-district'
	| 'invalid';

export interface BuildOrderResult {
	ok: boolean;
	reason?: BuildFailure;
	message: string;
}

export interface StepResult {
	tick: number;
	/** Packed as `(owner << 21) | pixelIndex`. Consumed before the next step. */
	changes: Uint32Array;
	changeCount: number;
	changesOverflow: boolean;
	districtsChanged: boolean;
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
	readonly players: PlayerState[];

	tick = 0;
	winnerId: number | null = null;
	ended = false;
	growthMode: GrowthMode;
	gold = STARTING_GOLD;
	hand: Card[] = [];

	private pendingGrowthMode: GrowthMode | null = null;
	private goldAccrual = 0;
	private nextAttackOrderGrantTick = ATTACK_ORDER_GAIN_TICKS;
	private attackOrders: number[] = [];
	private readonly commandPostAccrual: Uint32Array;
	private readonly botGold: number[];
	private readonly botGoldAccrual: Uint16Array;
	private readonly botProfiles: BotProfile[];
	/** Per-defender grievance counts, indexed defender * PLAYER_COUNT + attacker. */
	private readonly botGrievance: Uint16Array;
	private readonly botPressure: Uint16Array;
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
		this.commandPostAccrual = new Uint32Array(PLAYER_COUNT);
		this.botGold = new Array<number>(PLAYER_COUNT).fill(0);
		this.botGoldAccrual = new Uint16Array(PLAYER_COUNT);
		this.botGrievance = new Uint16Array(PLAYER_COUNT * PLAYER_COUNT);
		this.botPressure = new Uint16Array(PLAYER_COUNT);
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
		this.attackOrders = this.players.map((player) => this.attackOrderCap(player.id));

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
		let income = BASE_GOLD_INCOME;
		for (const structure of this.structures.forOwner(HUMAN_PLAYER_ID)) {
			for (const effect of structure.effects) {
				if (effect.kind === 'income') income += effect.goldPerInterval * structure.stacks;
			}
		}
		return income;
	}

	private attackOrderCap(playerId: number): number {
		let cap = playerId === HUMAN_PLAYER_ID ? BASE_HUMAN_ATTACK_ORDERS : BASE_BOT_ATTACK_ORDERS;
		for (const structure of this.structures.forOwner(playerId)) {
			for (const effect of structure.effects) {
				if (effect.kind === 'order-cap') cap += effect.amount * structure.stacks;
			}
		}
		return cap;
	}

	private availableAttackOrders(playerId: number): number {
		let pending = 0;
		for (const command of this.pendingCommands) {
			if (command.type === 'attack' && command.playerId === playerId) pending++;
		}
		return this.attackOrders[playerId - 1] - pending;
	}

	private addAttackOrders(playerId: number, amount: number): void {
		const index = playerId - 1;
		this.attackOrders[index] = Math.min(
			this.attackOrders[index] + amount,
			this.attackOrderCap(playerId)
		);
	}

	private clampAttackOrders(playerId: number): void {
		const index = playerId - 1;
		this.attackOrders[index] = Math.min(this.attackOrders[index], this.attackOrderCap(playerId));
	}

	private grantAttackOrders(): void {
		for (const player of this.players) {
			if (!player.alive) continue;
			this.addAttackOrders(player.id, 1);
		}
	}

	/**
	 * Resource structures pay continuously. A level-30 Mine contributes 30
	 * gold per 100 ticks, so it adds 30 gold over ten seconds rather than a
	 * lump sum at the end. Command Posts use the same model over 600 ticks.
	 */
	private accrueResources(): void {
		this.goldAccrual += this.income;
		const earnedGold = Math.floor(this.goldAccrual / INCOME_INTERVAL_TICKS);
		if (earnedGold > 0) {
			this.gold += earnedGold;
			this.goldAccrual -= earnedGold * INCOME_INTERVAL_TICKS;
		}

		for (const player of this.players) {
			if (!player.alive) continue;
			if (player.isBot) {
				let goldRate = 1;
				let orderRate = 0;
				for (const structure of this.structures.forOwner(player.id)) {
					for (const effect of structure.effects) {
						if (effect.kind === 'income') goldRate += effect.goldPerInterval * structure.stacks;
						else if (effect.kind === 'order-gain') {
							orderRate += effect.amount * structure.stacks;
						}
					}
				}
				this.botGoldAccrual[player.id - 1] += goldRate;
				const earned = Math.floor(this.botGoldAccrual[player.id - 1] / INCOME_INTERVAL_TICKS);
				if (earned > 0) {
					this.botGold[player.id - 1] += earned;
					this.botGoldAccrual[player.id - 1] -= earned * INCOME_INTERVAL_TICKS;
				}
				if (orderRate > 0) {
					const next = this.commandPostAccrual[player.id - 1] + orderRate;
					const earnedOrders = Math.floor(next / COMMAND_POST_ORDER_TICKS);
					this.commandPostAccrual[player.id - 1] = next - earnedOrders * COMMAND_POST_ORDER_TICKS;
					if (earnedOrders > 0) this.addAttackOrders(player.id, earnedOrders);
				}
				continue;
			}
			let orderRate = 0;
			for (const structure of this.structures.forOwner(player.id)) {
				for (const effect of structure.effects) {
					if (effect.kind !== 'order-gain') continue;
					orderRate += effect.amount * structure.stacks;
				}
			}
			if (orderRate <= 0) continue;
			const next = this.commandPostAccrual[player.id - 1] + orderRate;
			const earnedOrders = Math.floor(next / COMMAND_POST_ORDER_TICKS);
			this.commandPostAccrual[player.id - 1] = next - earnedOrders * COMMAND_POST_ORDER_TICKS;
			if (earnedOrders > 0) this.addAttackOrders(player.id, earnedOrders);
		}
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
		if (this.availableAttackOrders(playerId) <= 0) {
			return fail('no-orders', 'No attack orders. Gain 1 order every 10 seconds.');
		}
		if (this.findAttackSeeds(playerId, index).length === 0) {
			return fail('no-shared-border', 'No friendly border is close enough. Move your frontier.');
		}

		const target = this.owners[index];
		return {
			ok: true,
			message: target === 0 ? 'Expansion ordered.' : `Assault on ${this.players[target - 1].name}.`
		};
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
				const cost = baseCost + districtStructure.stacks;
				if (this.gold < cost) {
					return {
						ok: false,
						reason: 'no-gold',
						message: `Need ${cost} gold to upgrade ${STRUCTURE_DEFINITIONS[card.type].label} to Lv.${
							districtStructure.stacks + 1
						}.`
					};
				}
				return {
					ok: true,
					message: `Upgrade ${STRUCTURE_DEFINITIONS[card.type].label} to Lv.${
						districtStructure.stacks + 1
					} for ${cost} gold.`
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

		if (this.gold < baseCost) {
			return {
				ok: false,
				reason: 'no-gold',
				message: `Need ${baseCost} gold to build ${STRUCTURE_DEFINITIONS[card.type].label}.`
			};
		}

		return {
			ok: true,
			message: `Build ${STRUCTURE_DEFINITIONS[card.type].label} for ${baseCost} gold.`
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
	upgradeDistrict(playerId: number, x: number, y: number): BuildOrderResult {
		if (this.ended) return { ok: false, reason: 'ended', message: 'The conflict is over.' };
		const player = this.players[playerId - 1];
		if (!player?.alive) {
			return { ok: false, reason: 'eliminated', message: 'Your state has been eliminated.' };
		}
		if (playerId !== HUMAN_PLAYER_ID) {
			return {
				ok: false,
				reason: 'invalid',
				message: 'Only the human commander upgrades districts.'
			};
		}
		const target = this.resolveUpgradeTarget(playerId, x, y);
		if (!target) {
			return {
				ok: false,
				reason: 'no-district',
				message: 'Click one of your structure districts to upgrade it.'
			};
		}
		const projectedLevel = target.structure.stacks + this.pendingUpgradesFor(target.structure.id);
		const cost = STRUCTURE_DEFINITIONS[target.structure.type].cost + projectedLevel;
		if (this.gold - this.pendingUpgradeCost(playerId) < cost) {
			return {
				ok: false,
				reason: 'no-gold',
				message: `Need ${cost} gold to upgrade ${STRUCTURE_DEFINITIONS[target.structure.type].label} to Lv.${projectedLevel + 1}.`
			};
		}
		this.pendingCommands.push({
			type: 'upgrade',
			playerId,
			x: Math.floor(x),
			y: Math.floor(y),
			cost,
			sequence: this.nextCommandSequence++
		});
		return {
			ok: true,
			message: `Upgrade ${STRUCTURE_DEFINITIONS[target.structure.type].label} to Lv.${
				projectedLevel + 1
			} for ${cost} gold.`
		};
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
		this.events = [];

		if (!this.ended) {
			this.tick++;

			if (this.pendingGrowthMode) {
				this.growthMode = this.pendingGrowthMode;
				this.pendingGrowthMode = null;
			}

			if (this.tick >= this.nextAttackOrderGrantTick) {
				this.grantAttackOrders();
				this.nextAttackOrderGrantTick += ATTACK_ORDER_GAIN_TICKS;
			}

			this.accrueResources();
			this.applyPendingCommands();

			this.runBotEconomy();
			this.runBotDecisions();
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

	getAttackOrderStrength(ownerId: number): number {
		let bonusLevels = 0;
		for (const structure of this.structures.forOwner(ownerId)) {
			for (const effect of structure.effects) {
				if (effect.kind !== 'attack-order-bonus') continue;
				bonusLevels += effect.amount * structure.stacks;
			}
		}
		// Diminishing returns: one order per two levels, hard-capped.
		const bonus = Math.min(
			BARRACKS_MAX_BONUS_ORDERS,
			Math.ceil(bonusLevels / BARRACKS_LEVELS_PER_ORDER)
		);
		return 1 + bonus;
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
		mix(this.nextAttackOrderGrantTick);
		for (const accrual of this.commandPostAccrual) mix(accrual);
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
					const cost = baseCost + districtStructure.stacks;
					if (this.gold < cost) continue;
					this.gold -= cost;
					const stacks = this.structures.reinforce(districtStructure);
					this.rebuildAuraDefense();
					this.pushEvent(
						'build',
						`${STRUCTURE_DEFINITIONS[card.type].label} upgraded to Lv.${stacks} for ${cost} gold.`,
						command.playerId
					);
					continue;
				}
				if (this.gold < baseCost) continue;
				this.gold -= baseCost;
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
					`${STRUCTURE_DEFINITIONS[structure.type].label} built for ${baseCost} gold.`,
					command.playerId
				);
				continue;
			}

			if (command.type === 'upgrade') {
				const target = this.resolveUpgradeTarget(command.playerId, command.x, command.y);
				if (!target) continue;
				const cost = command.cost;
				if (this.gold < cost) continue;
				this.gold -= cost;
				const stacks = this.structures.reinforce(target.structure);
				this.rebuildAuraDefense();
				this.pushEvent(
					'build',
					`${STRUCTURE_DEFINITIONS[target.structure.type].label} upgraded to Lv.${stacks} for ${cost} gold.`,
					command.playerId
				);
				continue;
			}

			if (this.attackOrders[command.playerId - 1] <= 0) continue;
			const index = command.y * this.width + command.x;
			if (index < 0 || index >= this.owners.length) continue;
			const seeds = this.findAttackSeeds(command.playerId, index);
			if (seeds.length === 0) continue;
			if (!this.createAttack(command.playerId, index, seeds)) continue;
			this.attackOrders[command.playerId - 1]--;
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
	}

	private nearestDistrictStructure(ownerId: number, x: number, y: number): Structure | null {
		let bestDistance = Number.POSITIVE_INFINITY;
		let best: Structure | null = null;
		const owned = this.structures.forOwner(ownerId);
		for (const structure of owned) {
			const range = STRUCTURE_DEFINITIONS[structure.type].districtRange;
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

		const orders = this.getAttackOrderStrength(attackerId);
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
			lifetimeTicks: ATTACK_LIFETIME_TICKS + (orders - 1) * ATTACK_ORDER_LIFETIME_BONUS,
			orders,
			initialOrders: orders,
			captures: 0,
			done: false
		});

		return true;
	}

	private processAttacks(): void {
		const attackById = new Map(this.attacks.map((attack) => [attack.id, attack]));

		for (const attack of this.attacks) {
			if (attack.done) continue;
			const attacker = this.players[attack.attackerId - 1];
			if (!attacker.alive) {
				attack.done = true;
				continue;
			}
			if (this.tick - attack.createdAtTick >= attack.lifetimeTicks) {
				attack.done = true;
				continue;
			}

			let capturedThisTick = 0;
			let frontierEmpty = false;
			let clashHeld = false;
			let attackPoints = ATTACK_DAMAGE_PER_TICK + (attack.orders - 1) * ATTACK_ORDER_DAMAGE_BONUS;
			while (attackPoints > 0) {
				// Sample a small batch of the highest-priority frontier cells.
				// Geometry decides who is eligible; the cheapest sampled defense
				// decides which lane advances. This lets a front slide around a
				// costly strongpoint instead of spending its whole tick there.
				const sampled: number[] = [];
				let chosenPosition = -1;
				let chosenCost = Number.POSITIVE_INFINITY;
				let halted = false;
				let exhausted = false;

				for (let sample = 0; sample < LEAST_RESISTANCE_SAMPLE_SIZE; sample++) {
					const index = attack.frontier.pop();
					if (index === undefined) {
						exhausted = true;
						break;
					}
					if (!this.land[index] || this.owners[index] !== attack.defenderId) continue;

					// Connectivity is re-checked at the moment of capture, not just
					// when the cell was enqueued. If another front cuts the path back
					// to the attacker, the candidate is discarded instead of becoming
					// an enclave.
					if (!this.hasNeighbourOwner(index, attack.attackerId)) continue;

					// Mutual attacks meet at their claimed front lines. The defender
					// spends attack orders up to its issued attack strength; every
					// spent order removes one embedded order from the incoming front.
					const clash = this.resolveOpposingClash(index, attack, attackById);
					if (clash === 'halted') {
						halted = true;
						break;
					}
					if (clash === 'blocked') {
						clashHeld = true;
						break;
					}

					const cost = Math.max(
						1,
						this.defenseAt(index) - (attack.orders - 1) * ATTACK_ORDER_DEFENSE_PIERCE
					);
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

				// Put the missed candidates back. The chosen one is consumed.
				for (let i = sampled.length - 1; i >= 0; i--) {
					if (i !== chosenPosition) attack.frontier.push(sampled[i]);
				}

				if (chosenPosition < 0) {
					if (exhausted) {
						frontierEmpty = true;
						break;
					}
					continue;
				}

				// The cheapest sampled cell is still too expensive for this tick.
				// Keep it (and the rest) queued for a future tick.
				if (chosenCost > attackPoints) break;

				const index = sampled[chosenPosition];
				this.claim(index, attack.attackerId, attack.id);
				attackPoints -= chosenCost;
				attack.captures++;
				capturedThisTick++;

				const x = index % this.width;
				const y = (index - x) / this.width;
				if (x > 0) this.enqueueAttackCell(attack, index - 1);
				if (x + 1 < this.width) this.enqueueAttackCell(attack, index + 1);
				if (y > 0) this.enqueueAttackCell(attack, index - this.width);
				if (y + 1 < this.height) this.enqueueAttackCell(attack, index + this.width);
			}

			// A clash hold is not an exhausted or severed front; keep it alive for
			// the next tick so it can continue once the defender runs out of orders.
			if (!clashHeld && (frontierEmpty || capturedThisTick === 0)) {
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
	 * A mutual front contact spends the defender's available attack orders. The
	 * defender can spend at most its issued attack strength, and never more than
	 * its remaining order inventory. Each spent order removes one order from the
	 * incoming attack. Returning `null` means the defender could not spend
	 * anything, so the incoming front breaks through.
	 */
	private resolveOpposingClash(
		index: number,
		attack: AttackState,
		attackById: Map<number, AttackState>
	): 'halted' | 'blocked' | null {
		const other = this.findOpposingAttack(index, attack, attackById);
		if (!other) return null;
		const defenderId = attack.defenderId;
		const worth = this.getAttackOrderStrength(defenderId);
		const available = this.attackOrders[defenderId - 1] ?? 0;
		const reduction = Math.min(worth, available, attack.orders);
		if (reduction <= 0) return null;

		this.attackOrders[defenderId - 1] -= reduction;
		attack.orders -= reduction;
		if (attack.orders <= 0) {
			attack.orders = 0;
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
			this.clampAttackOrders(structure.ownerId);
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

		const preferred: Array<[BuildableStructureType, number]> = [
			['mine', 20 + economy + (hash32(playerId, 10, seed) % 25)],
			['barracks', 12 + aggression + (hash32(playerId, 11, seed) % 25)],
			['defense-post', 12 + fortification + (hash32(playerId, 12, seed) % 25)],
			['command-post', 8 + command + (hash32(playerId, 13, seed) % 25)],
			[
				'war-academy',
				5 + Math.floor((aggression + command) / 2) + (hash32(playerId, 14, seed) % 25)
			]
		];
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
			buildPlan
		};
	}

	private runBotEconomy(): void {
		if (this.tick % BOT_BUILD_INTERVAL !== 0) return;

		let auraChanged = false;
		for (const player of this.players) {
			if (!player.alive || !player.isBot) continue;
			const plan = this.botProfiles[player.id - 1].buildPlan;
			let acted = false;

			// Build the next affordable, placeable structure in the bot's
			// strategy order. District geometry means a second type often
			// waits until the bot expands beyond its first district.
			for (const type of plan) {
				if (this.structures.forOwnerType(player.id, type)) continue;
				const cost = STRUCTURE_DEFINITIONS[type].cost;
				if (this.botGold[player.id - 1] < cost) continue;
				const cell = this.findBotBuildCell(player, type);
				if (cell < 0) continue;
				this.botGold[player.id - 1] -= cost;
				const structure = this.structures.create(
					type,
					player.id,
					cell % this.width,
					Math.floor(cell / this.width),
					this.width
				);
				this.refreshDistrictsAround(structure);
				auraChanged = true;
				acted = true;
				break;
			}
			if (acted) continue;

			// Nothing new can be placed: raise the lowest-level structure in
			// the plan, spreading investment instead of over-leveling one type.
			let target: { type: BuildableStructureType; stacks: number; cost: number } | null = null;
			for (const type of plan) {
				const existing = this.structures.forOwnerType(player.id, type);
				if (!existing) continue;
				const cost = STRUCTURE_DEFINITIONS[type].cost + existing.stacks;
				if (this.botGold[player.id - 1] < cost) continue;
				if (!target || existing.stacks < target.stacks) {
					target = { type, stacks: existing.stacks, cost };
				}
			}
			if (!target) continue;
			const existing = this.structures.forOwnerType(player.id, target.type);
			if (!existing) continue;
			this.botGold[player.id - 1] -= target.cost;
			this.structures.reinforce(existing);
			auraChanged = true;
		}
		// Aura rebuilds still batch once per decision tick; district refreshes
		// are local to each new structure and already applied above.
		if (auraChanged) this.rebuildAuraDefense();
	}

	private findBotBuildCell(player: PlayerState, type: BuildableStructureType): number {
		if (type === 'mine' || type === 'command-post' || type === 'war-academy') {
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

		this.botPressure.fill(0);
		for (const attack of this.attacks) {
			if (!attack.done) this.botPressure[attack.defenderId - 1]++;
		}
		const strengths = new Uint32Array(PLAYER_COUNT);
		for (const player of this.players) {
			if (player.alive) strengths[player.id - 1] = this.estimatePlayerStrength(player.id);
		}

		for (const player of this.players) {
			if (!player.alive || !player.isBot) continue;
			if (this.attackOrders[player.id - 1] <= 0) continue;
			if (player.border.size === 0) continue;
			const profile = this.botProfiles[player.id - 1];
			const attackRoll = hash32(this.tick, player.id, this.seed ^ 0x27d4eb2d) % 100;
			if (attackRoll > 15 + Math.floor(profile.aggression * 0.85)) continue;

			const target = this.chooseBotAttackTarget(
				player,
				profile,
				strengths[player.id - 1],
				strengths
			);
			if (target === null) continue;
			if (this.createAttack(player.id, target, [target])) {
				this.attackOrders[player.id - 1]--;
			}
		}
	}

	private estimatePlayerStrength(playerId: number): number {
		const player = this.players[playerId - 1];
		if (!player) return 0;
		let levels = 0;
		for (const structure of this.structures.forOwner(playerId)) levels += structure.stacks;
		return Math.floor(player.territory / 4) + levels * 300 + this.attackOrders[playerId - 1] * 150;
	}

	private chooseBotAttackTarget(
		player: PlayerState,
		profile: BotProfile,
		selfStrength: number,
		strengths: Uint32Array
	): number | null {
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
		return bestIndex >= 0 ? bestIndex : null;
	}

	private scoreBotTarget(
		attackerId: number,
		profile: BotProfile,
		defenderId: number,
		selfStrength: number,
		strengths: Uint32Array
	): number {
		if (defenderId === 0) return 45 + Math.floor(profile.aggression * 0.15);
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
		if (this.attackOrders[defenderId - 1] > 0) {
			score -= Math.floor(profile.cautious * 0.4);
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
			structures: this.structures.all.map((structure) => this.toPublicStructure(structure)),
			gold: this.gold,
			income: this.income,
			hand: this.hand.map((card) => ({ id: card.id, type: card.type })),
			attackOrders: this.attackOrders[HUMAN_PLAYER_ID - 1] ?? 0,
			attackOrderCap: this.attackOrderCap(HUMAN_PLAYER_ID),
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
			effects: structure.effects
		};
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
