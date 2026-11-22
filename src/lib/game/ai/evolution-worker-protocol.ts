import type { StartPoint } from '../map';
import type { GameSnapshot } from '../simulation';
import type { BotGenome } from './genome';
import type { EvolutionConfig, EvolutionReport, GenomePerformance } from './evolution';

export interface WorkerEvolutionState {
	phase: 'idle' | 'match' | 'generation-complete' | 'finished';
	generation: number;
	progress: { match: number; matches: number; generation: number };
	seats: BotGenome[];
	population: BotGenome[];
	rows: GenomePerformance[];
	archiveRows: GenomePerformance[];
	report: EvolutionReport | null;
	markovStates: (number | null)[];
	/** Present once when the worker restores a saved session. */
	restoredConfig: EvolutionConfig | null;
}

export interface WorkerMatchInit {
	width: number;
	height: number;
	starts: StartPoint[];
	terrain: Uint8Array;
	terrainShade: Uint8Array;
	terrainElevation: Uint8Array;
	owners: Uint16Array;
	districtColorCodes: Uint8Array;
	snapshot: GameSnapshot;
}

export interface WorkerVisual {
	matchId: number;
	tick: number;
	snapshot: GameSnapshot;
	/** Packed `(owner << 21) | pixelIndex` changes since the previous visual. */
	changes: Uint32Array;
	changeCount: number;
	/** Full owners/district arrays replace the change stream. */
	overflow: boolean;
	owners: Uint16Array | null;
	districtColorCodes: Uint8Array | null;
	districtTiles: number[];
	/** Packed 32×32 district palette tiles, one 1024-byte block per tile. */
	districtTileColors: Uint8Array | null;
	markovStates: (number | null)[];
}

export type EvolutionWorkerCommand =
	| { type: 'start'; config: EvolutionConfig }
	| { type: 'set-population'; config: EvolutionConfig; genomes: BotGenome[] }
	| { type: 'continue' }
	| { type: 'pause' }
	| { type: 'resume' }
	| { type: 'speed'; speed: number }
	| { type: 'fill-seats' }
	| { type: 'discard-session' }
	| { type: 'dispose' };

export type EvolutionWorkerMessage =
	| { type: 'state'; state: WorkerEvolutionState }
	| { type: 'match'; matchId: number; init: WorkerMatchInit }
	| { type: 'visual'; visual: WorkerVisual }
	| { type: 'idle' }
	| { type: 'error'; message: string };
