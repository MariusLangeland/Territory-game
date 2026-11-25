import { CHANGE_INDEX_MASK, RENDER_TILE_SIZE } from '../constants';
import { LedgerAgent } from '../ledger/agent';
import type { TerritorySimulation } from '../simulation';
import { applyOnlineIntent } from '../net/online-intent';
import type { OnlineIntent } from '../net/online-protocol';
import { workerCommandToIntent } from './intent';
import type {
	LocalWorkerCommand,
	LocalWorkerCommandResult,
	LocalWorkerInit,
	LocalWorkerInitConfig,
	LocalWorkerReplayStatus,
	LocalWorkerTelemetry,
	LocalWorkerVisual
} from './local-protocol';

/**
 * Worker-owned local match. The main thread only receives immutable snapshots and
 * render deltas; it never steps the simulation or runs integrity scans.
 */
export class LocalWorkerHost {
	readonly agent: LedgerAgent;
	readonly config: LocalWorkerInitConfig;
	readonly authoritativeInput: boolean;
	private paused = false;
	private replaySpeed = 1;

	constructor(config: LocalWorkerInitConfig) {
		this.config = config;
		this.authoritativeInput = config.authoritativeInput === true;
		this.agent = new LedgerAgent(
			{
				seed: config.seed,
				width: config.width,
				height: config.height,
				playerCount: config.playerCount,
				growthMode: config.growthMode,
				botDifficulty: config.botDifficulty,
				matchDurationTicks: config.matchDurationTicks,
				botGenomes: config.botGenomes,
				botCommandPostStacks: config.botCommandPostStacks
			},
			config.replay ?? null
		);
	}

	get simulation(): TerritorySimulation {
		return this.agent.simulation;
	}

	get speed(): number {
		return this.replaySpeed;
	}

	setReplaySpeed(speed: number): void {
		this.replaySpeed = Math.max(0.25, Math.min(16, speed));
	}

	/** Seek a replay and return a full-map visual for renderer resync. */
	seekReplay(tick: number): LocalWorkerVisual {
		this.agent.seek(tick);
		return this.resyncVisual();
	}

	private resyncVisual(): LocalWorkerVisual {
		const sim = this.simulation;
		return {
			type: 'visual',
			tick: sim.tick,
			snapshot: sim.getSnapshot(),
			changes: new Uint32Array(),
			changeDistrictColors: null,
			changesOverflow: true,
			owners: sim.owners.slice(),
			districtTiles: [],
			districtTileColors: null,
			districtColorCodes: sim.districtColorCodes.slice(),
			events: [],
			mergedDistricts: [...sim.getMergedDistricts()],
			ledgerBlock: null,
			replayComplete: this.agent.replayComplete
		};
	}

	initMessage(): LocalWorkerInit {
		const sim = this.simulation;
		return {
			type: 'init',
			config: { ...this.config, replay: undefined },
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

	setPaused(paused: boolean): void {
		this.paused = paused;
	}

	get isPaused(): boolean {
		return this.paused;
	}

	get tick(): number {
		return this.simulation.tick;
	}

	get ended(): boolean {
		return this.simulation.ended || this.agent.replayComplete;
	}

	replayStatus(): LocalWorkerReplayStatus {
		return {
			type: 'replay-status',
			tick: this.simulation.tick,
			maxTick: this.config.replay?.finalTick ?? this.simulation.tick,
			playing: !this.paused && !this.ended,
			speed: this.replaySpeed,
			complete: this.agent.replayComplete
		};
	}

	step(): LocalWorkerVisual | null {
		if (this.paused || this.simulation.ended) return null;
		const advance = this.agent.advance();
		const result = advance.step;
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
			mergedDistricts: [...this.simulation.getMergedDistricts()],
			ledgerBlock: advance.block,
			replayComplete: this.agent.replayComplete
		};
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

	command(message: LocalWorkerCommand): LocalWorkerCommandResult {
		const command = message.command;
		if (command.type === 'ledger') {
			return {
				type: 'command-result',
				id: message.id,
				ok: true,
				message: 'Ledger exported.',
				tick: this.simulation.tick,
				ledgerBlock: this.agent.openBlockView,
				ledgerText: this.agent.exportText()
			};
		}
		if (this.authoritativeInput) {
			return {
				type: 'command-result',
				id: message.id,
				ok: false,
				reason: 'authoritative-input',
				message: 'Input is submitted through Spacetime.',
				tick: this.simulation.tick,
				ledgerBlock: null
			};
		}
		const intent = workerCommandToIntent(command);
		const result = this.agent.submit(1, intent);
		return {
			type: 'command-result',
			id: message.id,
			ok: result.ok,
			reason: result.reason,
			message: result.message,
			tick: this.simulation.tick,
			ledgerBlock: result.block ?? null
		};
	}

	/** Apply an intent accepted by Spacetime, without writing the local ledger. */
	applyIntent(playerId: number, intent: OnlineIntent): ReturnType<typeof applyOnlineIntent> {
		return applyOnlineIntent(this.simulation, playerId, intent);
	}

	telemetry(): LocalWorkerTelemetry {
		return {
			type: 'telemetry',
			behavior: this.simulation.getBotBehaviorTelemetry()
		};
	}
}
