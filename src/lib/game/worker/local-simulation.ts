import {
	ARTILLERY_RANGE,
	ATTACK_SEARCH_RADIUS,
	ATTACK_STRENGTH_BASE,
	ATTACK_STRENGTH_BONUS,
	ATTACK_SUPPLY_COST_BASE,
	ATTACK_SUPPLY_COST_BONUS,
	HUMAN_PLAYER_ID,
	STRUCTURE_MIN_SPACING,
	UPGRADE_LEVEL_COST_STEP
} from '../constants';
import { RemoteSimulationView } from './view';
import type { WorkerMatchInit } from './protocol';
import type { MergedDistrictGroup } from '../simulation';
import type {
	LocalWorkerCommandType,
	LocalWorkerInit,
	LocalWorkerInitConfig,
	LocalWorkerTelemetry,
	LocalWorkerVisual
} from './local-protocol';
import { LocalWorkerClient } from './local-client';
import { STRUCTURE_DEFINITIONS, type PublicStructure } from '../Structures';

interface CommandResult {
	ok: boolean;
	reason?: string;
	message: string;
}

interface UpgradeQuote {
	ok: boolean;
	reason?: string;
	message: string;
	levels: number;
	cost: number;
	currentLevel: number;
	projectedLevel: number;
	merged: boolean;
	structureCount: number;
}

/**
 * Read-only mirror of the worker-owned simulation. It provides fast synchronous
 * queries for hover/preview and async command forwarding; it never steps.
 */
export class WorkerLocalSimulation extends RemoteSimulationView {
	readonly playerCount: number;
	readonly matchDurationTicks: number;
	private client: LocalWorkerClient;
	private telemetry: LocalWorkerTelemetry['behavior'] | null = null;
	private mergedDistricts: MergedDistrictGroup[] = [];

	static async create(
		config: LocalWorkerInitConfig,
		handlers: {
			onVisual?: (visual: LocalWorkerVisual) => void;
			onTelemetry?: (telemetry: LocalWorkerTelemetry) => void;
			onError?: (error: Error) => void;
		} = {}
	): Promise<WorkerLocalSimulation> {
		let instance: WorkerLocalSimulation | null = null;
		let resolveInit!: (init: LocalWorkerInit) => void;
		let rejectInit!: (error: Error) => void;
		const initPromise = new Promise<LocalWorkerInit>((resolve, reject) => {
			resolveInit = resolve;
			rejectInit = reject;
		});
		const initTimeout = setTimeout(() => {
			rejectInit(new Error('Simulation worker did not initialize within 30 seconds.'));
		}, 30_000);
		const client = new LocalWorkerClient(config, {
			onInit: (init) => {
				clearTimeout(initTimeout);
				resolveInit(init);
			},
			onVisual: (visual) => {
				instance?.applyWorkerVisual(visual);
				handlers.onVisual?.(visual);
			},
			onTelemetry: (telemetry) => {
				instance?.setTelemetry(telemetry.behavior);
				handlers.onTelemetry?.(telemetry);
			},
			onError: (error) => {
				clearTimeout(initTimeout);
				if (!instance) rejectInit(error);
				handlers.onError?.(error);
			}
		});
		const init = await initPromise;
		instance = new WorkerLocalSimulation(init, client);
		return instance;
	}

	constructor(init: LocalWorkerInit, client: LocalWorkerClient) {
		const viewInit: WorkerMatchInit = {
			width: init.width,
			height: init.height,
			starts: init.starts,
			terrain: init.terrain,
			terrainShade: init.terrainShade,
			terrainElevation: init.terrainElevation,
			owners: init.owners,
			districtColorCodes: init.districtColorCodes,
			snapshot: init.snapshot
		};
		super(viewInit);
		this.playerCount = init.config.playerCount;
		this.matchDurationTicks = init.config.matchDurationTicks;
		this.client = client;
		this.mergedDistricts = init.mergedDistricts;
	}

	applyWorkerVisual(visual: LocalWorkerVisual): void {
		const districtTiles = visual.districtTiles;
		this.applyVisual({
			matchId: 1,
			tick: visual.tick,
			snapshot: visual.snapshot,
			changes: visual.changes,
			changeCount: visual.changes.length,
			changeDistrictColors: visual.changeDistrictColors,
			overflow: visual.changesOverflow,
			owners: visual.owners,
			districtColorCodes: visual.districtColorCodes,
			districtTiles,
			districtTileColors: visual.districtTileColors,
			markovStates: []
		});
		this.mergedDistricts = visual.mergedDistricts;
	}

	override getMergedDistricts(): readonly MergedDistrictGroup[] {
		return this.mergedDistricts;
	}

	setTelemetry(behavior: LocalWorkerTelemetry['behavior']): void {
		this.telemetry = behavior;
	}

	getBotBehaviorTelemetry(): LocalWorkerTelemetry['behavior'] {
		return (
			this.telemetry ?? {
				threatenedFortificationBuilds: 0,
				threatenedFortificationUpgrades: 0,
				deterrencePostures: 0,
				incomeGapCommandPosts: 0,
				incomeGapWarAcademies: 0,
				opportunityAttacks: 0,
				botPortBuilds: 0,
				botNavalLandings: 0,
				optionSelections: {
					'supply-ramp': 0,
					'fortify-front': 0,
					expand: 0,
					'naval-opportunity': 0,
					'exploit-weakness': 0,
					'coalition-strike': 0,
					conserve: 0
				}
			}
		);
	}

	command(
		type: LocalWorkerCommandType,
		args: Parameters<LocalWorkerClient['command']>[1] = {}
	): Promise<CommandResult> {
		return this.client.command(type, args);
	}

	pause(): void {
		this.client.pause();
	}

	resume(): void {
		this.client.resume();
	}

	dispose(): void {
		this.client.dispose();
	}

	// ── Synchronous mirror queries ───────────────────────────────────────────

	override getAuraDefense(x?: number, y?: number): number {
		if (x === undefined || y === undefined) return 0;
		let maxAura = 0;
		let additiveAura = 0;
		for (const structure of this.snapshot.structures) {
			const dx = structure.x - x;
			const dy = structure.y - y;
			if (structure.type === 'state') {
				if (dx * dx + dy * dy <= 16 * 16) maxAura = Math.max(maxAura, 20);
				continue;
			}
			for (const effect of STRUCTURE_DEFINITIONS[structure.type].effects) {
				if (effect.kind !== 'defense-aura') continue;
				const range = STRUCTURE_DEFINITIONS[structure.type].districtRange;
				if (dx * dx + dy * dy > range * range) continue;
				const amount = effect.defense * structure.stacks;
				if (effect.stacking === 'max') maxAura = Math.max(maxAura, amount);
				else additiveAura += amount;
			}
		}
		return maxAura + additiveAura;
	}

	override getDefense(x: number, y: number): number {
		const occupied = this.structureAtCell(x, y) ? 1 : 0;
		return this.getBaseDefense(x, y) + occupied + this.getAuraDefense(x, y);
	}

	getDistrictStructureId(x: number, y: number): number {
		const cellX = Math.floor(x);
		const cellY = Math.floor(y);
		let best: PublicStructure | null = null;
		let bestDistance = Number.POSITIVE_INFINITY;
		for (const structure of this.snapshot.structures) {
			if (structure.ownerId !== HUMAN_PLAYER_ID || structure.type === 'state') continue;
			const definition = STRUCTURE_DEFINITIONS[structure.type];
			if (definition.districtRange <= 0) continue;
			const dx = structure.x - cellX;
			const dy = structure.y - cellY;
			if (Math.abs(dx) > definition.districtRange || Math.abs(dy) > definition.districtRange) {
				continue;
			}
			const distance = dx * dx + dy * dy;
			if (distance < bestDistance) {
				best = structure;
				bestDistance = distance;
			}
		}
		return best?.id ?? 0;
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
		const attackerLevels = this.stacksByType(attackerId, 'barracks');
		const defenderJammers = this.stacksByType(defenderId, 'jammer');
		const effectiveLevels = Math.max(0, attackerLevels - defenderJammers);
		const logTier = 31 - Math.clz32(effectiveLevels + 1);
		return {
			levels: attackerLevels,
			effectiveLevels,
			logTier,
			power: 30 + 15 * logTier,
			pierce: logTier,
			strength: ATTACK_STRENGTH_BASE + ATTACK_STRENGTH_BONUS * effectiveLevels,
			cost: ATTACK_SUPPLY_COST_BASE + ATTACK_SUPPLY_COST_BONUS * effectiveLevels
		};
	}

	validateAttack(_playerId: number, x: number, y: number): CommandResult {
		const cellX = Math.floor(x);
		const cellY = Math.floor(y);
		if (!this.isLand(cellX, cellY)) {
			return { ok: false, reason: 'ocean', message: 'Cannot take ocean pixels.' };
		}
		const owner = this.getOwner(cellX, cellY);
		if (owner === HUMAN_PLAYER_ID) {
			return { ok: false, reason: 'own-territory', message: 'That territory is already yours.' };
		}
		if (!this.hasAttackSeeds(cellX, cellY, owner)) {
			return {
				ok: false,
				reason: 'no-shared-border',
				message: 'No friendly border is close enough. Move your frontier.'
			};
		}
		const stats = this.getAttackStats(HUMAN_PLAYER_ID, owner);
		if ((this.snapshot?.supply ?? 0) < stats.cost) {
			return {
				ok: false,
				reason: 'no-orders',
				message: `Need ${stats.cost} supply to launch a front.`
			};
		}
		return {
			ok: true,
			message:
				owner === 0
					? 'Expansion ordered.'
					: `Assault on ${this.snapshot.players[owner - 1]?.name ?? 'state'}.`
		};
	}

	validateArtillery(_playerId: number, x: number, y: number): CommandResult {
		const cellX = Math.floor(x);
		const cellY = Math.floor(y);
		if (cellX < 0 || cellY < 0 || cellX >= this.width || cellY >= this.height) {
			return { ok: false, reason: 'invalid', message: 'Outside the map.' };
		}
		const artillery = this.snapshot.structures.filter(
			(structure) =>
				structure.ownerId === HUMAN_PLAYER_ID &&
				structure.type === 'artillery' &&
				structure.readyAtTick <= this.snapshot.tick
		);
		if (artillery.length === 0) {
			return { ok: false, reason: 'no-artillery', message: 'Build an Artillery card first.' };
		}
		const inRange = artillery.some((battery) => {
			const dx = battery.x - cellX;
			const dy = battery.y - cellY;
			return dx * dx + dy * dy <= ARTILLERY_RANGE * ARTILLERY_RANGE;
		});
		if (!inRange) {
			return {
				ok: false,
				reason: 'out-of-range',
				message: 'No ready artillery can reach that point.'
			};
		}
		return { ok: true, message: 'Artillery target ready.' };
	}

	validateBuild(
		_playerId: number,
		cardId: number,
		x: number,
		y: number
	): CommandResult & {
		targetX?: number;
		targetY?: number;
	} {
		const card = this.snapshot.hand.find((entry) => entry.id === cardId);
		if (!card) return { ok: false, reason: 'no-card', message: 'That card is no longer in hand.' };
		const cellX = Math.floor(x);
		const cellY = Math.floor(y);
		const definition = STRUCTURE_DEFINITIONS[card.type];
		if (card.type === 'port') {
			const shore = this.nearestOwnShore(cellX, cellY, 24);
			if (shore === null) {
				return {
					ok: false,
					reason: 'not-shore',
					message: 'Ports need owned shoreline within 24 px.'
				};
			}
			const shoreX = shore % this.width;
			const shoreY = (shore - shoreX) / this.width;
			if (this.structureAtCell(shoreX, shoreY)) {
				return {
					ok: false,
					reason: 'occupied',
					message: 'A structure already occupies that cell.'
				};
			}
			if ((this.snapshot?.supply ?? 0) < definition.cost) {
				return { ok: false, reason: 'no-gold', message: `Need ${definition.cost} supply.` };
			}
			return {
				ok: true,
				message: 'Ready to build.',
				targetX: shoreX,
				targetY: shoreY
			};
		}
		if (!this.isLand(cellX, cellY)) {
			return { ok: false, reason: 'ocean', message: 'Structures need land.' };
		}
		if (this.getOwner(cellX, cellY) !== HUMAN_PLAYER_ID) {
			return { ok: false, reason: 'not-owned', message: 'Build inside your territory.' };
		}
		if (this.structureAtCell(cellX, cellY)) {
			return { ok: false, reason: 'occupied', message: 'A structure already occupies that cell.' };
		}
		const stackingStructure = this.snapshot.structures.find((structure) => {
			if (structure.ownerId !== HUMAN_PLAYER_ID || structure.type !== card.type) return false;
			const range = STRUCTURE_DEFINITIONS[structure.type].districtRange;
			return Math.abs(structure.x - cellX) <= range && Math.abs(structure.y - cellY) <= range;
		});
		if (!stackingStructure) {
			for (const structure of this.snapshot.structures) {
				if (structure.ownerId !== HUMAN_PLAYER_ID || structure.type === 'state') continue;
				const range = STRUCTURE_DEFINITIONS[structure.type].districtRange;
				if (
					structure.type !== card.type &&
					Math.abs(structure.x - cellX) <= range &&
					Math.abs(structure.y - cellY) <= range
				) {
					return {
						ok: false,
						reason: 'inside-district',
						message: 'A different structure district occupies that ground.'
					};
				}
				const dx = structure.x - cellX;
				const dy = structure.y - cellY;
				if (dx * dx + dy * dy < STRUCTURE_MIN_SPACING * STRUCTURE_MIN_SPACING) {
					return { ok: false, reason: 'too-close', message: 'Too close to another structure.' };
				}
			}
		}
		if ((this.snapshot?.supply ?? 0) < definition.cost) {
			return { ok: false, reason: 'no-gold', message: `Need ${definition.cost} supply.` };
		}
		return { ok: true, message: 'Ready to build.', targetX: cellX, targetY: cellY };
	}

	getUpgradeQuote(
		_playerId: number,
		x: number,
		y: number,
		levels = 1,
		_merged = false
	): UpgradeQuote {
		const count = Math.max(1, Math.min(5, Math.floor(levels)));
		const structure = this.nearestOwnBuildable(x, y);
		if (!structure) {
			return {
				ok: false,
				reason: 'no-district',
				message: 'Click one of your structure districts to upgrade it.',
				levels: 0,
				cost: 0,
				currentLevel: 0,
				projectedLevel: 0,
				merged: false,
				structureCount: 0
			};
		}
		const group =
			_merged && this.mergedDistricts.length > 0
				? (this.mergedDistricts
						.find((entry) => entry.structureIds.includes(structure.id))
						?.structureIds.map((id) => this.snapshot.structures.find((entry) => entry.id === id))
						.filter((entry): entry is PublicStructure => entry !== undefined) ?? [structure])
				: [structure];
		const projected = group.map((entry) => entry.stacks);
		const currentLevel = Math.min(...projected);
		const baseCost = STRUCTURE_DEFINITIONS[structure.type].cost;
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
		if ((this.snapshot?.supply ?? 0) < cost) {
			return {
				ok: false,
				reason: 'no-gold',
				message: `Need ${cost} supply.`,
				levels: count,
				cost,
				currentLevel,
				projectedLevel: Math.min(...projected),
				merged: group.length > 1,
				structureCount: group.length
			};
		}
		return {
			ok: true,
			message: 'Upgrade ready.',
			levels: count,
			cost,
			currentLevel,
			projectedLevel: Math.min(...projected),
			merged: group.length > 1,
			structureCount: group.length
		};
	}

	private nearestOwnShore(x: number, y: number, radius: number): number | null {
		let best: number | null = null;
		let bestDistance = Number.POSITIVE_INFINITY;
		for (
			let scanY = Math.max(0, y - radius);
			scanY <= Math.min(this.height - 1, y + radius);
			scanY++
		) {
			for (
				let scanX = Math.max(0, x - radius);
				scanX <= Math.min(this.width - 1, x + radius);
				scanX++
			) {
				if (this.getOwner(scanX, scanY) !== HUMAN_PLAYER_ID) continue;
				const dx = scanX - x;
				const dy = scanY - y;
				const distance = dx * dx + dy * dy;
				if (distance > radius * radius || distance >= bestDistance) continue;
				const shore =
					!this.isLand(scanX - 1, scanY) ||
					!this.isLand(scanX + 1, scanY) ||
					!this.isLand(scanX, scanY - 1) ||
					!this.isLand(scanX, scanY + 1);
				if (!shore) continue;
				best = scanY * this.width + scanX;
				bestDistance = distance;
			}
		}
		return best;
	}

	private hasAttackSeeds(x: number, y: number, targetOwner: number): boolean {
		const radius = ATTACK_SEARCH_RADIUS;
		for (
			let scanY = Math.max(0, y - radius);
			scanY <= Math.min(this.height - 1, y + radius);
			scanY++
		) {
			for (
				let scanX = Math.max(0, x - radius);
				scanX <= Math.min(this.width - 1, x + radius);
				scanX++
			) {
				if (!this.isLand(scanX, scanY)) continue;
				if (this.getOwner(scanX, scanY) !== targetOwner) continue;
				if (
					(scanX > 0 && this.getOwner(scanX - 1, scanY) === HUMAN_PLAYER_ID) ||
					(scanX + 1 < this.width && this.getOwner(scanX + 1, scanY) === HUMAN_PLAYER_ID) ||
					(scanY > 0 && this.getOwner(scanX, scanY - 1) === HUMAN_PLAYER_ID) ||
					(scanY + 1 < this.height && this.getOwner(scanX, scanY + 1) === HUMAN_PLAYER_ID)
				) {
					return true;
				}
			}
		}
		return false;
	}

	private structureAtCell(x: number, y: number): PublicStructure | undefined {
		return this.snapshot.structures.find(
			(structure) => structure.x === Math.floor(x) && structure.y === Math.floor(y)
		);
	}

	private nearestOwnBuildable(x: number, y: number): PublicStructure | null {
		let best: PublicStructure | null = null;
		let bestDistance = Number.POSITIVE_INFINITY;
		for (const structure of this.snapshot.structures) {
			if (structure.ownerId !== HUMAN_PLAYER_ID || structure.type === 'state') continue;
			const dx = structure.x - x;
			const dy = structure.y - y;
			const distance = dx * dx + dy * dy;
			if (distance < bestDistance) {
				best = structure;
				bestDistance = distance;
			}
		}
		return best;
	}

	private stacksByType(ownerId: number, type: PublicStructure['type']): number {
		let total = 0;
		for (const structure of this.snapshot.structures) {
			if (structure.ownerId === ownerId && structure.type === type) total += structure.stacks;
		}
		return total;
	}
}

export type { CommandResult, UpgradeQuote };
