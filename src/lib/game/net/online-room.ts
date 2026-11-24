import { TICK_RATE } from '../constants';
import { TerritorySimulation } from '../simulation';
import { NET_PROTOCOL_VERSION } from './protocol';
import { createMatchLedger, recordMatchLedgerEntry, type MatchLedger } from './match-ledger';
import { applyOnlineIntent, type OnlineIntentApplication } from './online-intent';
import {
	encodeByteRuns,
	encodeOwnerRuns,
	type OnlineBaseline,
	type OnlineIntent,
	type OnlineIntentEnvelope,
	type OnlineIntentResult,
	type OnlineRoomConfig,
	type OnlineRoomView,
	type OnlineSeat,
	type OnlineTick,
	type OnlineWireEvent
} from './online-protocol';

const MAX_INTENTS_PER_TICK = 12;
const DISTRICT_TILE_SIZE = 32;

interface RoomSeat extends OnlineSeat {
	token: string;
}

export interface OnlineRoomJoin {
	playerId: number;
	token: string;
}

export interface OnlineRoomStartResult {
	ok: boolean;
	message: string;
}

export class OnlineRoom {
	readonly roomId: string;
	readonly config: OnlineRoomConfig;
	private phase: OnlineRoomView['phase'] = 'waiting';
	private readonly seats: RoomSeat[] = [];
	private readonly lastSequence = new Map<number, number>();
	private intentsThisTick: Uint8Array;
	private simulation: TerritorySimulation | null = null;
	private checksumValue: number | null = null;
	private winnerId: number | null = null;
	private lastEvents: OnlineWireEvent[] = [];
	private lastChanges: number[] = [];
	private lastChangesOverflow = false;
	private lastDistrictTiles: number[] = [];
	private lastDistrictTileColors: number[] = [];
	private ledger: MatchLedger | null = null;

	constructor(roomId: string, config: OnlineRoomConfig) {
		if (!/^[a-z0-9-]{4,40}$/i.test(roomId)) throw new Error('Invalid room id.');
		this.validateConfig(config);
		this.roomId = roomId;
		this.config = { ...config };
		this.intentsThisTick = new Uint8Array(config.maxHumans + 1);
	}

	private validateConfig(config: OnlineRoomConfig): void {
		if (!Number.isSafeInteger(config.totalStates) || config.totalStates < 2) {
			throw new Error('totalStates must be an integer of at least 2.');
		}
		if (!Number.isSafeInteger(config.maxHumans) || config.maxHumans < 1) {
			throw new Error('maxHumans must be a positive integer.');
		}
		if (config.maxHumans > config.totalStates) {
			throw new Error('maxHumans cannot exceed totalStates.');
		}
		if (!Number.isFinite(config.seed)) throw new Error('seed must be finite.');
		if (
			config.mapWidth !== undefined &&
			(!Number.isSafeInteger(config.mapWidth) || config.mapWidth < 512)
		) {
			throw new Error('mapWidth must be an integer of at least 512.');
		}
		if (
			config.mapHeight !== undefined &&
			(!Number.isSafeInteger(config.mapHeight) || config.mapHeight < 256)
		) {
			throw new Error('mapHeight must be an integer of at least 256.');
		}
		if (!Number.isSafeInteger(config.timerMinutes) || config.timerMinutes < 0) {
			throw new Error('timerMinutes must be a non-negative integer.');
		}
		if (!Number.isSafeInteger(config.botCommandPostStacks) || config.botCommandPostStacks < 0) {
			throw new Error('botCommandPostStacks must be a non-negative integer.');
		}
	}

	get currentPhase(): OnlineRoomView['phase'] {
		return this.phase;
	}

	get completed(): boolean {
		return this.phase === 'completed';
	}

	get tick(): number {
		return this.simulation?.tick ?? 0;
	}

	get canJoin(): boolean {
		return this.phase === 'waiting' && this.seats.length < this.config.maxHumans;
	}

	join(name: string, token: string): OnlineRoomJoin {
		if (!this.canJoin) throw new Error('Room is not accepting players.');
		if (!token) throw new Error('A session token is required.');
		if (this.seats.some((seat) => seat.token === token)) {
			throw new Error('Session token is already in use.');
		}
		const trimmed = name.trim().slice(0, 24) || `Commander ${this.seats.length + 1}`;
		const playerId = this.seats.length + 1;
		this.seats.push({ playerId, name: trimmed, token, host: playerId === 1 });
		return { playerId, token };
	}

	seatForToken(token: string): OnlineSeat | null {
		const seat = this.seats.find((entry) => entry.token === token);
		if (!seat) return null;
		return { playerId: seat.playerId, name: seat.name, host: seat.host };
	}

	hasToken(token: string): boolean {
		return this.seats.some((seat) => seat.token === token);
	}

	start(token: string): OnlineRoomStartResult {
		if (this.phase !== 'waiting') return { ok: false, message: 'Match already started.' };
		const host = this.seats.find((seat) => seat.token === token);
		if (!host?.host) return { ok: false, message: 'Only the host can start the match.' };
		if (this.seats.length === 0) return { ok: false, message: 'No players in the room.' };
		const humanPlayerIds = this.seats.map((seat) => seat.playerId);
		const options = {
			seed: this.config.seed,
			width: this.config.mapWidth ?? 1280,
			height: this.config.mapHeight ?? 720,
			playerCount: this.config.totalStates,
			humanPlayerIds,
			botDifficulty: this.config.botDifficulty,
			matchDurationTicks: this.config.timerMinutes * 60 * TICK_RATE,
			botCommandPostStacks: this.config.botCommandPostStacks
		};
		this.simulation = new TerritorySimulation(options);
		this.ledger = createMatchLedger(options);
		this.ledger.finalTick = this.simulation.tick;
		this.ledger.checksumTick = this.simulation.tick;
		this.ledger.finalChecksum = this.simulation.checksum();
		this.phase = 'running';
		this.checksumValue = this.simulation.checksum();
		return { ok: true, message: 'Match started.' };
	}

	view(): OnlineRoomView {
		return {
			roomId: this.roomId,
			protocol: NET_PROTOCOL_VERSION,
			phase: this.phase,
			config: { ...this.config },
			seats: this.seats.map(({ playerId, name, host }) => ({ playerId, name, host })),
			hostPlayerId: 1,
			tick: this.tick,
			checksum: this.checksumValue,
			winnerId: this.winnerId
		};
	}

	/** Accepted-move ledger for deterministic replay. Null before the match starts. */
	matchLedger(): MatchLedger | null {
		return this.ledger ? (JSON.parse(JSON.stringify(this.ledger)) as MatchLedger) : null;
	}

	baselineFor(token: string): OnlineBaseline {
		const seat = this.seats.find((entry) => entry.token === token);
		if (!seat || !this.simulation) throw new Error('Player is not in a running match.');
		const snapshot = this.simulation.getSnapshot(seat.playerId);
		return {
			protocol: NET_PROTOCOL_VERSION,
			playerId: seat.playerId,
			tick: this.simulation.tick,
			config: { ...this.config },
			snapshot,
			ownerRuns: encodeOwnerRuns(this.simulation.owners),
			districtColorRuns: encodeByteRuns(this.simulation.districtColorCodes),
			districtTiles: [],
			districtTileColors: [],
			checksum: this.simulation.checksum()
		};
	}

	submit(token: string, envelope: OnlineIntentEnvelope): OnlineIntentResult {
		const seat = this.seats.find((entry) => entry.token === token);
		const fail = (reason: string, message: string): OnlineIntentResult => ({
			ok: false,
			sequence: envelope.sequence,
			reason,
			message,
			serverTick: this.tick
		});
		if (!seat) return fail('unauthorized', 'Unknown player session.');
		if (this.phase !== 'running' || !this.simulation) {
			return fail('not-running', 'The match is not running.');
		}
		if (!Number.isSafeInteger(envelope.sequence) || envelope.sequence < 0) {
			return fail('invalid-sequence', 'Sequence must be a non-negative integer.');
		}
		const previous = this.lastSequence.get(seat.playerId) ?? -1;
		if (envelope.sequence <= previous) {
			return fail('stale-sequence', 'That command sequence was already processed.');
		}
		if (this.intentsThisTick[seat.playerId] >= MAX_INTENTS_PER_TICK) {
			return fail('rate-limited', 'Too many commands in one tick.');
		}
		this.lastSequence.set(seat.playerId, envelope.sequence);
		this.intentsThisTick[seat.playerId]++;
		const result = this.applyIntent(seat.playerId, envelope.intent);
		if (result.ok && this.ledger) {
			recordMatchLedgerEntry(this.ledger, this.simulation.tick + 1, seat.playerId, envelope.intent);
		}
		return {
			ok: result.ok,
			sequence: envelope.sequence,
			reason: result.reason,
			message: result.message,
			serverTick: this.tick
		};
	}

	private applyIntent(playerId: number, intent: OnlineIntent): OnlineIntentApplication {
		const sim = this.simulation;
		if (!sim) return { ok: false, message: 'The match is not running.' };
		return applyOnlineIntent(sim, playerId, intent);
	}

	/** Advance exactly one authoritative tick. Returns null while waiting. */
	tickOnce(): OnlineTick | null {
		if (this.phase !== 'running' || !this.simulation) return null;
		this.intentsThisTick.fill(0);
		const step = this.simulation.step();
		if (this.simulation.ended || step.tick % 50 === 0) {
			this.checksumValue = this.simulation.checksum();
		}
		if (this.ledger) {
			this.ledger.finalTick = step.tick;
			if (this.simulation.ended || step.tick % 50 === 0) {
				this.ledger.checksumTick = step.tick;
				this.ledger.finalChecksum = this.checksumValue;
			}
		}
		this.lastEvents = step.events.map((event) => ({
			tick: step.tick,
			kind: event.kind,
			message: event.message,
			playerId: event.playerId
		}));
		this.lastChanges = Array.from(step.changes.subarray(0, step.changeCount));
		this.lastChangesOverflow = step.changesOverflow;
		this.lastDistrictTiles = [...step.districtTiles];
		this.lastDistrictTileColors = this.packDistrictTiles(step.districtTiles);
		if (this.simulation.ended) {
			this.phase = 'completed';
			this.winnerId = this.simulation.winnerId;
		}
		return {
			protocol: NET_PROTOCOL_VERSION,
			tick: step.tick,
			changes: this.lastChanges,
			changesOverflow: this.lastChangesOverflow,
			districtTiles: this.lastDistrictTiles,
			districtTileColors: this.lastDistrictTileColors,
			snapshot: this.simulation.getSnapshot(),
			events: this.lastEvents,
			checksum: this.checksumValue ?? this.simulation.checksum(),
			winnerId: this.winnerId
		};
	}

	tickFor(token: string): OnlineTick {
		if (!this.simulation) throw new Error('Match has not started.');
		const seat = this.seats.find((entry) => entry.token === token);
		if (!seat) throw new Error('Unknown player session.');
		return {
			protocol: NET_PROTOCOL_VERSION,
			tick: this.simulation.tick,
			changes: this.lastChanges,
			changesOverflow: this.lastChangesOverflow,
			districtTiles: this.lastDistrictTiles,
			districtTileColors: this.lastDistrictTileColors,
			snapshot: this.simulation.getSnapshot(seat.playerId),
			events: this.lastEvents,
			checksum: this.checksumValue ?? this.simulation.checksum(),
			winnerId: this.winnerId
		};
	}

	private packDistrictTiles(tiles: readonly number[]): number[] {
		if (!this.simulation || tiles.length === 0) return [];
		const codes = this.simulation.districtColorCodes;
		const tilesX = Math.ceil(this.simulation.width / DISTRICT_TILE_SIZE);
		const result: number[] = [];
		for (const tile of tiles) {
			const tileY = Math.floor(tile / tilesX);
			const tileX = tile - tileY * tilesX;
			for (let y = 0; y < DISTRICT_TILE_SIZE; y++) {
				const worldY = tileY * DISTRICT_TILE_SIZE + y;
				if (worldY >= this.simulation.height) {
					for (let x = 0; x < DISTRICT_TILE_SIZE; x++) result.push(0);
					continue;
				}
				for (let x = 0; x < DISTRICT_TILE_SIZE; x++) {
					const worldX = tileX * DISTRICT_TILE_SIZE + x;
					result.push(
						worldX >= this.simulation.width
							? 0
							: (codes[worldY * this.simulation.width + worldX] ?? 0)
					);
				}
			}
		}
		return result;
	}
}
