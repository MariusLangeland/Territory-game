import type { BotGenome } from './ai/genome';
import type { StartPoint } from './map';
import type { BotDifficulty, GameSnapshot, MergedDistrictGroup, StepResult } from './simulation';
import type { GrowthMode } from './growth';

export interface LocalWorkerInitConfig {
	seed: number;
	width: number;
	height: number;
	playerCount: number;
	growthMode: GrowthMode;
	botDifficulty: BotDifficulty;
	matchDurationTicks: number;
	botGenomes?: readonly (BotGenome | null)[];
	botCommandPostStacks: number;
}

export interface LocalWorkerInit {
	type: 'init';
	config: LocalWorkerInitConfig;
	width: number;
	height: number;
	starts: StartPoint[];
	terrain: Uint8Array;
	terrainShade: Uint8Array;
	terrainElevation: Uint8Array;
	owners: Uint16Array;
	districtColorCodes: Uint8Array;
	snapshot: GameSnapshot;
	mergedDistricts: MergedDistrictGroup[];
}

export type LocalWorkerCommandType =
	| 'attack'
	| 'artillery'
	| 'naval'
	| 'build'
	| 'upgrade'
	| 'demolish'
	| 'cancel-attack'
	| 'alliance-request'
	| 'alliance-break';

export interface LocalWorkerCommand {
	type: 'command';
	id: number;
	command: {
		type: LocalWorkerCommandType;
		x?: number;
		y?: number;
		cardId?: number;
		levels?: number;
		merged?: boolean;
		structureId?: number;
		targetPlayerId?: number;
	};
}

export interface LocalWorkerPause {
	type: 'pause' | 'resume';
}

export interface LocalWorkerInitMessage {
	type: 'init';
	config: LocalWorkerInitConfig;
}

export type LocalWorkerInbound = LocalWorkerCommand | LocalWorkerPause | LocalWorkerInitMessage;

export interface LocalWorkerVisual {
	type: 'visual';
	tick: number;
	snapshot: GameSnapshot;
	changes: Uint32Array;
	changesOverflow: boolean;
	districtTiles: number[];
	events: StepResult['events'];
	mergedDistricts: MergedDistrictGroup[];
}

export interface LocalWorkerCommandResult {
	type: 'command-result';
	id: number;
	ok: boolean;
	reason?: string;
	message: string;
	tick: number;
}

export interface LocalWorkerTelemetry {
	type: 'telemetry';
	behavior: ReturnType<import('./simulation').TerritorySimulation['getBotBehaviorTelemetry']>;
}

export interface LocalWorkerPaused {
	type: 'paused';
}

export type LocalWorkerOutbound =
	| LocalWorkerInit
	| LocalWorkerVisual
	| LocalWorkerCommandResult
	| LocalWorkerTelemetry
	| LocalWorkerPaused;
