import { CHANGE_INDEX_MASK, RENDER_TILE_SIZE } from '../constants';
import { TerritorySimulation } from '../simulation';
import { applyOnlineIntent } from '../net/online-intent';
import type { OnlineIntent } from '../net/online-protocol';
import { workerCommandToIntent } from '../worker/intent';
import type {
	LocalWorkerCommand,
	LocalWorkerCommandResult,
	LocalWorkerInit,
	LocalWorkerInitConfig,
	LocalWorkerTelemetry,
	LocalWorkerVisual
} from '../worker/local-protocol';

/**
 * Worker-owned view host: applies accepted ledger intents, runs the fixed tick
 * loop, and exposes only immutable snapshots/render deltas. The main thread never
 * steps the simulation or runs integrity scans.
 */
export class MatchViewHost {
	readonly simulation: TerritorySimulation;
	readonly config: LocalWorkerInitConfig;
	readonly authoritativeInput: boolean;
	private paused = false;
	private readonly pendingIntents: {
		tick: number;
		playerId: number;
		intent: OnlineIntent;
	}[] = [];

	constructor(config: LocalWorkerInitConfig) {
		this.config = config;
		this.authoritativeInput = config.authoritativeInput === true;
		this.simulation = new TerritorySimulation({
			seed: config.seed,
			width: config.width,
			height: config.height,
			playerCount: config.playerCount,
			growthMode: config.growthMode,
			botDifficulty: config.botDifficulty,
			matchDurationTicks: config.matchDurationTicks,
			botGenomes: config.botGenomes,
			botCommandPostStacks: config.botCommandPostStacks,
			humanPlayerIds: config.humanPlayerIds,
			viewerPlayerId: config.viewerPlayerId,
			playerNames: config.playerNames
		});
	}

	get tick(): number {
		return this.simulation.tick;
	}

	get ended(): boolean {
		return this.simulation.ended;
	}

	get isPaused(): boolean {
		return this.paused;
	}

	setPaused(paused: boolean): void {
		this.paused = paused;
	}

	initMessage(): LocalWorkerInit {
		const sim = this.simulation;
		return {
			type: 'init',
			config: this.config,
			width: sim.width,
			height: sim.height,
			starts: sim.map.starts,
			terrain: sim.map.land,
			terrainShade: sim.map.shade,
			terrainElevation: sim.map.elevation,
			owners: sim.owners.slice(),
			districtColorCodes: sim.districtColorCodes.slice(),
			snapshot: sim.getSnapshot(),
			mergedDistricts: [...sim.getMergedDistricts()]
		};
	}

	step(): LocalWorkerVisual | null {
		if (this.paused || this.simulation.ended) return null;
		this.flushIntentsForNextTick();
		const result = this.simulation.step();
		return {
			type: 'visual',
			tick: result.tick,
			snapshot: result.snapshot,
			changes: result.changes.slice(0, result.changeCount),
			changeDistrictColors: this.changeDistrictColors(result),
			changesOverflow: result.changesOverflow,
			owners: result.changesOverflow ? this.simulation.owners.slice() : null,
			districtTiles: result.districtTiles,
			districtTileColors: this.districtTileColors(result.districtTiles),
			districtColorCodes: result.changesOverflow
				? this.simulation.districtColorCodes.slice()
				: null,
			events: result.events,
			mergedDistricts: [...this.simulation.getMergedDistricts()]
		};
	}

	command(message: LocalWorkerCommand): LocalWorkerCommandResult {
		if (this.authoritativeInput) {
			return {
				type: 'command-result',
				id: message.id,
				ok: false,
				reason: 'authoritative-input',
				message: 'Input is submitted through Spacetime.',
				tick: this.simulation.tick
			};
		}
		const intent = workerCommandToIntent(message.command);
		const result = applyOnlineIntent(this.simulation, this.config.viewerPlayerId ?? 1, intent);
		return {
			type: 'command-result',
			id: message.id,
			ok: result.ok,
			reason: result.reason,
			message: result.message,
			tick: this.simulation.tick
		};
	}

	/** Validate a player command against the authoritative worker simulation. */
	validateCommand(command: LocalWorkerCommand['command']): {
		ok: boolean;
		reason?: string;
		message: string;
	} {
		const playerId = this.config.viewerPlayerId ?? 1;
		switch (command.type) {
			case 'attack':
				return this.simulation.validateAttack(playerId, command.x ?? 0, command.y ?? 0);
			case 'artillery':
				return this.simulation.validateArtillery(playerId, command.x ?? 0, command.y ?? 0);
			case 'naval':
				return this.simulation.validateNavalAttack(playerId, command.x ?? 0, command.y ?? 0);
			case 'build':
				return this.simulation.validateBuild(
					playerId,
					command.cardId ?? 0,
					command.x ?? 0,
					command.y ?? 0,
					command.newStructureOnly === true,
					command.allowTightSpacing === true
				);
			case 'upgrade': {
				const quote = this.simulation.getUpgradeQuote(
					playerId,
					command.x ?? 0,
					command.y ?? 0,
					command.levels ?? 1,
					command.merged ?? true
				);
				return { ok: quote.ok, reason: quote.reason, message: quote.message };
			}
			case 'demolish':
				return this.simulation.validateDemolish(playerId, command.structureId ?? 0);
			case 'cancel-attack':
				return this.simulation.validateCancelLatestAttack(playerId);
			case 'alliance-request':
				return this.simulation.validateAllianceRequest(playerId, command.targetPlayerId ?? 0);
			case 'alliance-break':
				return this.simulation.validateAllianceBreak(playerId, command.targetPlayerId ?? 0);
		}
	}

	/**
	 * Queue an accepted ledger intent and catch up to the safe frontier.
	 *
	 * The row's tick is the latest server tick that is safe to simulate. We may
	 * simulate any number of extra ticks immediately, so catch up to
	 * `rowTick - 1` and let the next tick apply the intent itself.
	 */
	applyIntent(tick: number, playerId: number, intent: OnlineIntent): LocalWorkerVisual[] {
		const safeFrontier = Math.max(0, Math.floor(tick) - 1);
		const visuals = this.catchUpTo(safeFrontier);
		const target = Math.max(this.simulation.tick + 1, Math.floor(tick));
		this.pendingIntents.push({ tick: target, playerId, intent });
		this.pendingIntents.sort((left, right) => left.tick - right.tick);
		return visuals;
	}

	/** On resume, catch up through any intents that arrived while paused. */
	resumeWithCatchUp(): LocalWorkerVisual[] {
		const latest = this.pendingIntents.reduce((max, pending) => Math.max(max, pending.tick), 0);
		return latest > 0 ? this.catchUpTo(latest - 1) : [];
	}

	private catchUpTo(targetTick: number): LocalWorkerVisual[] {
		const visuals: LocalWorkerVisual[] = [];
		if (this.paused) return visuals;
		while (this.simulation.tick < targetTick && !this.simulation.ended) {
			const visual = this.step();
			if (!visual) break;
			visuals.push(visual);
		}
		return visuals;
	}

	private flushIntentsForNextTick(): void {
		const nextTick = this.simulation.tick + 1;
		const due = this.pendingIntents.filter((pending) => pending.tick <= nextTick);
		if (due.length === 0) return;
		this.pendingIntents.splice(0, due.length);
		for (const pending of due) {
			applyOnlineIntent(this.simulation, pending.playerId, pending.intent);
		}
	}

	private changeDistrictColors(result: {
		changes: Uint32Array;
		changeCount: number;
	}): Uint8Array | null {
		if (result.changeCount === 0) return null;
		const colors = new Uint8Array(result.changeCount);
		for (let index = 0; index < result.changeCount; index++) {
			const cell = (result.changes[index] ?? 0) & CHANGE_INDEX_MASK;
			colors[index] = this.simulation.districtColorCodes[cell] ?? 0;
		}
		return colors;
	}

	private districtTileColors(tiles: readonly number[]): Uint8Array | null {
		if (tiles.length === 0) return null;
		const colors = new Uint8Array(tiles.length * RENDER_TILE_SIZE * RENDER_TILE_SIZE);
		const tilesX = Math.ceil(this.simulation.width / RENDER_TILE_SIZE);
		for (let block = 0; block < tiles.length; block++) {
			const tile = tiles[block] ?? 0;
			const x0 = (tile % tilesX) * RENDER_TILE_SIZE;
			const y0 = Math.floor(tile / tilesX) * RENDER_TILE_SIZE;
			const offset = block * RENDER_TILE_SIZE * RENDER_TILE_SIZE;
			for (let y = 0; y < RENDER_TILE_SIZE; y++) {
				const worldY = y0 + y;
				if (worldY >= this.simulation.height) break;
				for (let x = 0; x < RENDER_TILE_SIZE; x++) {
					const worldX = x0 + x;
					if (worldX >= this.simulation.width) break;
					colors[offset + y * RENDER_TILE_SIZE + x] =
						this.simulation.districtColorCodes[worldY * this.simulation.width + worldX] ?? 0;
				}
			}
		}
		return colors;
	}

	telemetry(): LocalWorkerTelemetry {
		return {
			type: 'telemetry',
			behavior: this.simulation.getBotBehaviorTelemetry()
		};
	}
}
