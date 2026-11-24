import type { BotGenome } from '../ai/genome';
import type { StartPoint } from '../map';
import type { BotDifficulty, GameSnapshot, MergedDistrictGroup, StepResult } from '../simulation';
import type { GrowthMode } from '../growth';
import type { LedgerBlock } from '../ledger/agent';

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
		newStructureOnly?: boolean;
		allowTightSpacing?: boolean;
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
	changeDistrictColors: Uint8Array | null;
	changesOverflow: boolean;
	owners: Uint16Array | null;
	districtTiles: number[];
	districtTileColors: Uint8Array | null;
	districtColorCodes: Uint8Array | null;
	events: StepResult['events'];
	mergedDistricts: MergedDistrictGroup[];
	/** Sealed block for this tick when one or more transactions were accepted. */
	ledgerBlock: LedgerBlock | null;
}

export interface LocalWorkerCommandResult {
	type: 'command-result';
	id: number;
	ok: boolean;
	reason?: string;
	message: string;
	tick: number;
	/** Open block containing the accepted transaction, if any. */
	ledgerBlock: LedgerBlock | null;
}

export interface LocalWorkerTelemetry {
	type: 'telemetry';
	behavior: ReturnType<import('../simulation').TerritorySimulation['getBotBehaviorTelemetry']>;
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
