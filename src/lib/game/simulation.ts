import {
	ATTACK_LAUNCH_COST,
	ATTACK_SEARCH_RADIUS,
	BOT_ATTACK_LIMIT,
	BOT_DECISION_INTERVAL,
	BOT_MIN_TROOPS,
	BOT_SEARCH_TRIES,
	CAPTURE_PER_TICK,
	HUMAN_PLAYER_ID,
	MAX_ATTACKS_PER_PLAYER,
	PLAYER_COUNT,
	PLAYER_NAMES,
	START_TROOPS,
	START_RADIUS,
	TICK_RATE,
	incomeForTerritory,
	troopCap
} from './constants';
import { generateMap, hash32, type GeneratedMap, type StartPoint } from './map';
import { DeterministicRng } from './rng';

export interface PlayerState {
	id: number;
	name: string;
	isBot: boolean;
	alive: boolean;
	troops: number;
	territory: number;
	income: number;
	/** Land frontier cells. Derived from owners + land; never trusted across a network. */
	border: Set<number>;
}

export interface AttackState {
	id: number;
	attackerId: number;
	defenderId: number;
	targetX: number;
	targetY: number;
	queue: number[];
	seen: Set<number>;
	head: number;
	createdAtTick: number;
	captures: number;
	done: boolean;
}

export interface PublicPlayer {
	id: number;
	name: string;
	isBot: boolean;
	alive: boolean;
	troops: number;
	territory: number;
	income: number;
	landShare: number;
}

export interface PublicAttack {
	id: number;
	attackerId: number;
	defenderId: number;
	targetX: number;
	targetY: number;
	captures: number;
}

export interface GameSnapshot {
	tick: number;
	seed: number;
	landCount: number;
	claimedLand: number;
	players: PublicPlayer[];
	attacks: PublicAttack[];
	winnerId: number | null;
	ended: boolean;
	humanId: number;
}

export type SimEventKind = 'elimination' | 'victory' | 'system';

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
	| 'too-many-attacks'
	| 'no-troops'
	| 'invalid';

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

export interface StepResult {
	tick: number;
	/** Packed as `(owner << 21) | pixelIndex`. Consumed before the next step. */
	changes: Uint32Array;
	changeCount: number;
	changesOverflow: boolean;
	events: SimEvent[];
	snapshot: GameSnapshot;
}

export interface SimulationOptions {
	seed: number;
	width?: number;
	height?: number;
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
	readonly players: PlayerState[];

	tick = 0;
	winnerId: number | null = null;
	ended = false;

	private readonly rng: DeterministicRng;
	private readonly land: Uint8Array;
	private readonly shade: Uint8Array;
	private readonly landCount: number;
	private attacks: AttackState[] = [];
	private nextAttackId = 1;
	private pendingCommands: AttackCommand[] = [];
	private nextCommandSequence = 1;
	private events: SimEvent[] = [];
	private nextEventId = 1;
	private changes = new Uint32Array(CHANGE_BUFFER_SIZE);
	private changeCount = 0;
	private changesOverflow = false;
	private lastSnapshot: GameSnapshot | null = null;

	constructor(options: SimulationOptions) {
		const width = options.width ?? undefined;
		const height = options.height ?? undefined;
		if (width !== undefined || height !== undefined) {
			throw new Error(
				'Custom map dimensions are not supported by the versioned map generator yet.'
			);
		}

		this.seed = options.seed >>> 0;
		this.map = generateMap(this.seed);
		this.width = this.map.width;
		this.height = this.map.height;
		this.land = this.map.land;
		this.shade = this.map.shade;
		this.landCount = this.map.landCount;
		this.owners = new Uint16Array(this.width * this.height);

		if (this.landCount <= 0) throw new Error('Generated map has no land.');

		this.players = Array.from({ length: PLAYER_COUNT }, (_, i) => ({
			id: i + 1,
			name: PLAYER_NAMES[i] ?? `Player ${i + 1}`,
			isBot: i !== HUMAN_PLAYER_ID - 1,
			alive: true,
			troops: START_TROOPS,
			territory: 0,
			income: 0,
			border: new Set<number>()
		}));

		this.rng = new DeterministicRng((this.seed ^ 0x6a09e667) >>> 0);

		this.placeStartingTerritories(this.map.starts);
		this.rebuildBorders();

		for (const player of this.players) {
			player.troops = START_TROOPS;
			player.income = incomeForTerritory(player.territory) * TICK_RATE;
		}

		this.pushEvent('system', 'Operations live. Expand your borders.');
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
		if (this.activeAttackCount(playerId) >= MAX_ATTACKS_PER_PLAYER) {
			return fail(
				'too-many-attacks',
				`At most ${MAX_ATTACKS_PER_PLAYER} attacks can be active at once.`
			);
		}
		if (player.troops < ATTACK_LAUNCH_COST + 1) {
			return fail('no-troops', 'Not enough troops to launch an attack.');
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

	step(): StepResult {
		this.changeCount = 0;
		this.changesOverflow = false;
		this.events = [];

		if (!this.ended) {
			this.tick++;

			this.applyPendingCommands();

			for (const player of this.players) {
				if (!player.alive) continue;
				const income = incomeForTerritory(player.territory);
				player.income = income * TICK_RATE;
				player.troops = Math.min(troopCap(player.territory), player.troops + income);
			}

			this.runBotDecisions();
			this.processAttacks();
			this.updateEliminations();
			this.checkVictory();
		}

		this.lastSnapshot = this.buildSnapshot();
		return {
			tick: this.tick,
			changes: this.changes,
			changeCount: this.changeCount,
			changesOverflow: this.changesOverflow,
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

		for (let i = 0; i < this.owners.length; i++) mix(this.owners[i]);

		for (const player of this.players) {
			mix(player.id);
			mix(player.alive ? 1 : 0);
			mix(player.troops);
			mix(player.territory);
		}

		for (const attack of this.attacks) {
			mix(attack.id);
			mix(attack.attackerId);
			mix(attack.defenderId);
			mix(attack.head);
			mix(attack.queue.length);
			for (let i = attack.head; i < attack.queue.length; i++) mix(attack.queue[i]);
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
			const index = command.y * this.width + command.x;
			if (index < 0 || index >= this.owners.length) continue;
			const seeds = this.findAttackSeeds(command.playerId, index);
			if (seeds.length === 0) continue;
			this.createAttack(command.playerId, index, seeds);
		}
	}

	private activeAttackCount(playerId: number): number {
		let count = 0;
		for (const attack of this.attacks) {
			if (attack.attackerId === playerId && !attack.done) count++;
		}
		for (const command of this.pendingCommands) {
			if (command.playerId === playerId) count++;
		}
		return count;
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
		if (this.activeAttackCount(attackerId) >= MAX_ATTACKS_PER_PLAYER) return false;

		const defenderId = this.owners[targetIndex];
		if (defenderId === attackerId) return false;
		if (!this.land[targetIndex]) return false;
		if (attacker.troops < ATTACK_LAUNCH_COST + 1) return false;

		attacker.troops -= ATTACK_LAUNCH_COST;
		const targetX = indexToX(targetIndex, this.width);
		const targetY = indexToY(targetIndex, this.width);

		const unique: number[] = [];
		const seen = new Set<number>();
		for (const seed of seeds) {
			if (seen.has(seed)) continue;
			if (this.owners[seed] !== defenderId) continue;
			seen.add(seed);
			unique.push(seed);
		}
		if (unique.length === 0) return false;

		this.attacks.push({
			id: this.nextAttackId++,
			attackerId,
			defenderId,
			targetX,
			targetY,
			queue: unique,
			seen,
			head: 0,
			createdAtTick: this.tick,
			captures: 0,
			done: false
		});

		return true;
	}

	private processAttacks(): void {
		for (const attack of this.attacks) {
			if (attack.done) continue;
			const attacker = this.players[attack.attackerId - 1];
			if (!attacker.alive) {
				attack.done = true;
				continue;
			}

			let capturedThisTick = 0;
			while (
				capturedThisTick < CAPTURE_PER_TICK &&
				attacker.troops > 0 &&
				attack.head < attack.queue.length
			) {
				const index = attack.queue[attack.head++];
				if (!this.land[index] || this.owners[index] !== attack.defenderId) continue;

				this.claim(index, attack.attackerId);
				attacker.troops--;
				attack.captures++;
				capturedThisTick++;

				const x = index % this.width;
				const y = (index - x) / this.width;
				if (x > 0) this.enqueueAttackCell(attack, index - 1);
				if (x + 1 < this.width) this.enqueueAttackCell(attack, index + 1);
				if (y > 0) this.enqueueAttackCell(attack, index - this.width);
				if (y + 1 < this.height) this.enqueueAttackCell(attack, index + this.width);
			}

			if (attack.head >= attack.queue.length) attack.done = true;
		}

		this.attacks = this.attacks.filter((attack) => !attack.done);
	}

	private enqueueAttackCell(attack: AttackState, index: number): void {
		if (this.owners[index] !== attack.defenderId) return;
		if (!this.land[index] || attack.seen.has(index)) return;
		attack.seen.add(index);
		attack.queue.push(index);
	}

	private claim(index: number, newOwner: number): void {
		const previousOwner = this.owners[index];
		if (previousOwner === newOwner) return;

		if (previousOwner > 0) {
			const previous = this.players[previousOwner - 1];
			previous.territory--;
			previous.border.delete(index);
		}

		this.owners[index] = newOwner;
		const next = this.players[newOwner - 1];
		next.territory++;
		this.refreshBorder(index);

		const x = index % this.width;
		const y = (index - x) / this.width;
		if (x > 0) this.refreshBorder(index - 1);
		if (x + 1 < this.width) this.refreshBorder(index + 1);
		if (y > 0) this.refreshBorder(index - this.width);
		if (y + 1 < this.height) this.refreshBorder(index + this.width);

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

	private runBotDecisions(): void {
		if (this.tick % BOT_DECISION_INTERVAL !== 0) return;

		for (const player of this.players) {
			if (!player.alive || !player.isBot) continue;
			if (player.troops < BOT_MIN_TROOPS) continue;
			if (this.activeAttackCount(player.id) >= BOT_ATTACK_LIMIT) continue;
			if (player.border.size === 0) continue;

			for (let attempt = 0; attempt < BOT_SEARCH_TRIES; attempt++) {
				const borderIndex = this.pickBorderCell(player);
				if (borderIndex === null) break;

				const target = this.pickAttackTarget(player, borderIndex);
				if (target === null) continue;
				if (this.createAttack(player.id, target, [target])) break;
			}
		}
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

	private pickAttackTarget(player: PlayerState, borderIndex: number): number | null {
		const width = this.width;
		const x = borderIndex % width;
		const y = (borderIndex - x) / width;
		const candidates: number[] = [];

		const consider = (index: number) => {
			if (!this.land[index]) return;
			if (this.owners[index] === player.id) return;
			candidates.push(index);
		};

		if (x > 0) consider(borderIndex - 1);
		if (x + 1 < width) consider(borderIndex + 1);
		if (y > 0) consider(borderIndex - width);
		if (y + 1 < this.height) consider(borderIndex + width);

		if (candidates.length === 0) return null;

		// Most bot offensives target neutral ground; the rest probe a neighbour.
		const neutral = candidates.filter((index) => this.owners[index] === 0);
		if (neutral.length > 0 && (candidates.length === neutral.length || this.rng.chance(68))) {
			return this.rng.pick(neutral);
		}
		return this.rng.pick(candidates);
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

	private updateEliminations(): void {
		for (const player of this.players) {
			if (!player.alive || player.territory > 0) continue;
			player.alive = false;
			player.troops = 0;
			player.income = 0;
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
				troops: player.troops,
				territory: player.territory,
				income: player.income,
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
			winnerId: this.winnerId,
			ended: this.ended,
			humanId: HUMAN_PLAYER_ID
		};
	}

	private toPublicAttack(attack: AttackState): PublicAttack {
		return {
			id: attack.id,
			attackerId: attack.attackerId,
			defenderId: attack.defenderId,
			targetX: attack.targetX,
			targetY: attack.targetY,
			captures: attack.captures
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
