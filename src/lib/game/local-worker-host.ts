import { TerritorySimulation } from './simulation';
import type {
	LocalWorkerCommand,
	LocalWorkerCommandResult,
	LocalWorkerInit,
	LocalWorkerInitConfig,
	LocalWorkerTelemetry,
	LocalWorkerVisual
} from './local-worker-protocol';

/**
 * Worker-owned local match. The main thread only receives immutable snapshots and
 * render deltas; it never steps the simulation or runs integrity scans.
 */
export class LocalWorkerHost {
	readonly simulation: TerritorySimulation;
	readonly config: LocalWorkerInitConfig;
	private paused = false;

	constructor(config: LocalWorkerInitConfig) {
		this.config = config;
		this.simulation = new TerritorySimulation({
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
			snapshot: sim.getSnapshot()
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
		const result = this.simulation.step();
		return {
			type: 'visual',
			tick: result.tick,
			snapshot: result.snapshot,
			changes: result.changes.slice(0, result.changeCount),
			changesOverflow: result.changesOverflow,
			districtTiles: result.districtTiles,
			events: result.events
		};
	}

	command(message: LocalWorkerCommand): LocalWorkerCommandResult {
		const command = message.command;
		let result: { ok: boolean; reason?: string; message: string };
		switch (command.type) {
			case 'attack':
				result = this.simulation.enqueueAttack(1, command.x ?? 0, command.y ?? 0);
				break;
			case 'artillery':
				result = this.simulation.enqueueArtillery(1, command.x ?? 0, command.y ?? 0);
				break;
			case 'naval':
				result = this.simulation.enqueueNavalAttack(1, command.x ?? 0, command.y ?? 0);
				break;
			case 'build':
				result = this.simulation.playCard(1, command.cardId ?? 0, command.x ?? 0, command.y ?? 0);
				break;
			case 'upgrade':
				result = this.simulation.upgradeDistrict(
					1,
					command.x ?? 0,
					command.y ?? 0,
					command.levels ?? 1,
					command.merged ?? true
				);
				break;
			case 'demolish':
				result = this.simulation.demolishStructure(1, command.structureId ?? 0);
				break;
			case 'cancel-attack':
				result = this.simulation.cancelLatestAttack(1);
				break;
			case 'alliance-request':
				result = this.simulation.requestAlliance(1, command.targetPlayerId ?? 0);
				break;
			case 'alliance-break':
				result = this.simulation.breakAlliance(1, command.targetPlayerId ?? 0);
				break;
		}
		return {
			type: 'command-result',
			id: message.id,
			ok: result.ok,
			reason: result.reason,
			message: result.message,
			tick: this.simulation.tick
		};
	}

	telemetry(): LocalWorkerTelemetry {
		return {
			type: 'telemetry',
			behavior: this.simulation.getBotBehaviorTelemetry()
		};
	}
}
