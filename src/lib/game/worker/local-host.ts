import { CHANGE_INDEX_MASK, RENDER_TILE_SIZE } from '../constants';
import { LedgerAgent } from '../ledger/agent';
import type { TerritorySimulation } from '../simulation';
import type { OnlineIntent } from '../net/online-protocol';
import type {
	LocalWorkerCommand,
	LocalWorkerCommandResult,
	LocalWorkerInit,
	LocalWorkerInitConfig,
	LocalWorkerTelemetry,
	LocalWorkerVisual
} from './local-protocol';

/**
 * Worker-owned local match. The main thread only receives immutable snapshots and
 * render deltas; it never steps the simulation or runs integrity scans.
 */
export class LocalWorkerHost {
	readonly agent: LedgerAgent;
	readonly simulation: TerritorySimulation;
	readonly config: LocalWorkerInitConfig;
	private paused = false;

	constructor(config: LocalWorkerInitConfig) {
		this.config = config;
		this.agent = new LedgerAgent({
			seed: config.seed,
			width: config.width,
			height: config.height,
			playerCount: config.playerCount,
			growthMode: config.growthMode,
			botDifficulty: config.botDifficulty,
			matchDurationTicks: config.matchDurationTicks,
			botGenomes: config.botGenomes,
			botCommandPostStacks: config.botCommandPostStacks
		});
		this.simulation = this.agent.simulation;
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
		return this.simulation.ended;
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
			ledgerBlock: advance.block
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
		const intent = this.toIntent(command);
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

	private toIntent(command: LocalWorkerCommand['command']): OnlineIntent {
		switch (command.type) {
			case 'attack':
				return { type: 'attack', x: command.x ?? 0, y: command.y ?? 0 };
			case 'artillery':
				return { type: 'artillery', x: command.x ?? 0, y: command.y ?? 0 };
			case 'naval':
				return { type: 'naval', x: command.x ?? 0, y: command.y ?? 0 };
			case 'build':
				return {
					type: 'build',
					cardId: command.cardId ?? 0,
					x: command.x ?? 0,
					y: command.y ?? 0,
					newStructureOnly: command.newStructureOnly === true,
					allowTightSpacing: command.allowTightSpacing === true
				};
			case 'upgrade':
				return {
					type: 'upgrade',
					x: command.x ?? 0,
					y: command.y ?? 0,
					levels: command.levels ?? 1,
					merged: command.merged ?? true
				};
			case 'demolish':
				return { type: 'demolish', structureId: command.structureId ?? 0 };
			case 'cancel-attack':
				return { type: 'cancel-attack' };
			case 'alliance-request':
				return { type: 'alliance-request', targetPlayerId: command.targetPlayerId ?? 0 };
			case 'alliance-break':
				return { type: 'alliance-break', targetPlayerId: command.targetPlayerId ?? 0 };
			case 'ledger':
				throw new Error('Ledger export is not a gameplay transaction.');
		}
	}

	telemetry(): LocalWorkerTelemetry {
		return {
			type: 'telemetry',
			behavior: this.simulation.getBotBehaviorTelemetry()
		};
	}
}
