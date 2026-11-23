import type { BotGenome } from './genome';
import type { WorkerMatchInit, WorkerVisual } from '../worker/protocol';

export type { WorkerMatchInit, WorkerVisual } from '../worker/protocol';
import type {
	EvolutionConfig,
	EvolutionReport,
	EvolutionSessionSnapshot,
	GenomePerformance
} from './evolution';

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

export type EvolutionWorkerCommand =
	| { type: 'start'; config: EvolutionConfig }
	| { type: 'set-population'; config: EvolutionConfig; genomes: BotGenome[] }
	| { type: 'continue'; config?: EvolutionConfig }
	| { type: 'pause' }
	| { type: 'resume' }
	| { type: 'speed'; speed: number }
	| { type: 'fill-seats' }
	| { type: 'stop' }
	| { type: 'stop-now' }
	| { type: 'import-state'; snapshot: EvolutionSessionSnapshot }
	| { type: 'visual-ack'; matchId: number }
	| { type: 'discard-session' }
	| { type: 'dispose' };

export type EvolutionWorkerMessage =
	| { type: 'state'; state: WorkerEvolutionState }
	| { type: 'match'; matchId: number; init: WorkerMatchInit }
	| { type: 'visual'; visual: WorkerVisual }
	| { type: 'idle' }
	| { type: 'reset' }
	| { type: 'error'; message: string };
