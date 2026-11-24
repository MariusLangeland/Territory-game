/**
 * Public simulation types and command/result payloads.
 *
 * `simulation.ts` re-exports every type declared here so existing imports from
 * `$lib/game/simulation` (tests, protocol, worker, UI) keep working. Keep the
 * declarations free of runtime imports: this module is type-only.
 */

import type { GrowthLayer, GrowthMode } from '../growth';
import type { BotGenome } from '../ai/genome';
import type { BotOptionId } from '../ai/options';
import type { BuildableStructureType, PublicCard, PublicStructure } from '../structures';

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

export interface PublicAlliance {
	id: number;
	playerA: number;
	playerB: number;
	startedAtTick: number;
	expiresAtTick: number;
}

export interface PublicAllianceProposal {
	id: number;
	fromPlayerId: number;
	toPlayerId: number;
	createdAtTick: number;
	expiresAtTick: number;
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
	alliances: PublicAlliance[];
	allianceProposals: PublicAllianceProposal[];
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
	| 'elimination'
	| 'victory'
	| 'structure'
	| 'build'
	| 'attack'
	| 'artillery'
	| 'naval'
	| 'alliance'
	| 'system';

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
	| 'friendly-shore'
	| 'allied';

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
	/** Shift-build: reject district stacking and require a new structure site. */
	newStructureOnly?: boolean;
	/** Shift-build fallback: permit a structure in a one-pixel pocket. */
	allowTightSpacing?: boolean;
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

export interface AllianceRequestCommand {
	type: 'alliance-request';
	playerId: number;
	targetPlayerId: number;
	sequence: number;
}

export interface AllianceBreakCommand {
	type: 'alliance-break';
	playerId: number;
	targetPlayerId: number;
	sequence: number;
}

export type GameCommand =
	| AttackCommand
	| ArtilleryFireCommand
	| NavalCommand
	| BuildCommand
	| UpgradeCommand
	| DemolishCommand
	| AllianceRequestCommand
	| AllianceBreakCommand;

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
	/** Packed as `(owner << 26) | pixelIndex`. Consumed before the next step. */
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
	/** Player ids controlled by humans. Defaults to [1] unless allPlayersBots is set. */
	humanPlayerIds?: readonly number[];
	/** Optional team id per player (1-indexed array); 0 means free-for-all. */
	teamIds?: readonly number[];
	/** Optional starting Command Post stacks granted to every AI seat. */
	botCommandPostStacks?: number;
}
