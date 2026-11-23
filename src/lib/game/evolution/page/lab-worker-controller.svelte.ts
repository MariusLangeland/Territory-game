import { bucketsFromReport, loadEvolutionBuckets, saveEvolutionBuckets } from '#lib/game/ai';
import type {
	EvolutionWorkerCommand,
	EvolutionWorkerMessage,
	WorkerEvolutionState
} from '#lib/game/ai/evolution-worker-protocol';
import { RemoteSimulationView } from '#lib/game/worker/view';
import type { EvolutionPageState } from './lab-state.svelte';

/**
 * Evolution Lab worker/simulation lifecycle. Owns the worker handle, the
 * authoritative match id used to drop stale visuals, and the measured
 * throughput window; the page state only keeps the rendered mirrors.
 */
export function createLabWorkerController(state: EvolutionPageState) {
	let worker: Worker | null = null;
	let activeMatchId = -1;
	let visualRevision = 0;
	let throughputTick = 0;
	let throughputAt = 0;

	function send(command: EvolutionWorkerCommand): void {
		worker?.postMessage(command);
	}

	/** Drops queued worker visuals at or below the revision the canvas uploaded. */
	function acknowledgeVisuals(revision: number): void {
		state.remoteVisualQueue = state.remoteVisualQueue.filter(
			(visual) => visual.revision > revision
		);
		send({ type: 'visual-ack', matchId: activeMatchId });
	}

	function resetThroughput(): void {
		state.effectiveTps = 0;
		throughputTick = 0;
		throughputAt = 0;
	}

	/** Measured ticks/s over >=250 ms windows, independent of the requested speed. */
	function sampleThroughput(tick: number): void {
		const now = performance.now();
		if (throughputAt === 0 || tick < throughputTick) {
			throughputTick = tick;
			throughputAt = now;
			return;
		}
		const elapsed = now - throughputAt;
		if (elapsed < 250) return;
		state.effectiveTps = Math.round(((tick - throughputTick) * 1000) / elapsed);
		throughputTick = tick;
		throughputAt = now;
	}

	function applyState(next: WorkerEvolutionState): void {
		if (next.restoredConfig) {
			state.config = {
				...next.restoredConfig,
				fitnessWeights: { ...next.restoredConfig.fitnessWeights }
			};
			state.restoredSession = true;
			state.notice = 'Restored the last saved Evolution Lab session.';
		}
		state.phase = next.phase;
		state.generation = next.generation;
		state.progress = next.progress;
		state.currentSeats = next.seats;
		state.population = next.population;
		state.rows = next.rows;
		state.archiveRows = next.archiveRows;
		state.markovStates = next.markovStates;
		state.started = true;
		if (next.report) {
			state.lastReport = next.report;
			state.buckets = bucketsFromReport(next.report);
			saveEvolutionBuckets(state.buckets);
		}
		if (!state.selectedGenomeId && state.currentSeats.length > 0) {
			state.selectedGenomeId = state.currentSeats[0].id;
		}
		if (state.phase === 'finished') {
			state.running = false;
			state.status =
				state.config.mode === 'gauntlet'
					? `Gauntlet complete — ${state.population.length} bots remain.`
					: 'Evolution complete. Buckets saved locally.';
		} else if (state.phase === 'generation-complete') {
			state.status =
				state.config.mode === 'gauntlet'
					? `Run ${state.generation} complete — preparing next run…`
					: `Generation ${state.generation + 1} complete — preparing next generation…`;
		} else if (state.phase === 'match') {
			state.status =
				state.config.mode === 'gauntlet'
					? `Run ${state.generation + 1} · ${state.population.length || state.currentSeats.length} bots`
					: `Generation ${state.generation + 1} · match ${state.progress.match}/${state.progress.matches || '?'}`;
		}
	}

	/** Clears the mirror without touching the worker's saved session. */
	function clearMatchMirror(): void {
		activeMatchId = -1;
		state.remoteView = null;
		state.remoteVisualQueue = [];
		state.snapshot = null;
	}

	function handleMessage(message: EvolutionWorkerMessage): void {
		switch (message.type) {
			case 'state':
				applyState(message.state);
				break;
			case 'match':
				activeMatchId = message.matchId;
				state.remoteView = new RemoteSimulationView(message.init);
				state.snapshot = message.init.snapshot;
				state.remoteVisualQueue = [];
				resetThroughput();
				state.matchKey++;
				break;
			case 'visual':
				if (!state.remoteView || message.visual.matchId !== activeMatchId) return;
				state.remoteView.applyVisual(message.visual);
				state.snapshot = message.visual.snapshot;
				state.markovStates = message.visual.markovStates;
				sampleThroughput(message.visual.tick);
				state.remoteVisualQueue = [
					...state.remoteVisualQueue,
					{
						revision: ++visualRevision,
						tick: message.visual.tick,
						snapshot: message.visual.snapshot,
						changes: message.visual.changes,
						changeCount: message.visual.changeCount,
						overflow: message.visual.overflow,
						districtTiles: message.visual.districtTiles
					}
				];
				break;
			case 'reset':
				clearMatchMirror();
				state.matchKey++;
				state.running = false;
				state.markovStates = [];
				state.selectedGenomeId = null;
				resetThroughput();
				break;
			case 'idle':
				clearMatchMirror();
				state.started = false;
				state.restoredSession = false;
				state.phase = 'idle';
				state.generation = 0;
				state.progress = { match: 0, matches: 0, generation: 0 };
				state.currentSeats = [];
				state.population = [];
				state.rows = [];
				state.archiveRows = [];
				state.markovStates = [];
				state.lastReport = null;
				state.selectedGenomeId = null;
				state.running = false;
				resetThroughput();
				state.status = 'Configure a population and start natural selection.';
				state.notice = 'Saved session discarded.';
				break;
			case 'error':
				state.notice = message.message;
				state.running = false;
				state.status = 'Evolution worker stopped.';
				break;
		}
	}

	function connectWorker(): Worker {
		const instance = new Worker(new URL('../../ai/evolution.worker.ts', import.meta.url), {
			type: 'module'
		});
		instance.onmessage = (event: MessageEvent<EvolutionWorkerMessage>) => handleMessage(event.data);
		instance.onerror = (event) => {
			state.notice = event.message || 'Evolution worker failed to start.';
			state.running = false;
			state.status = 'Evolution worker error.';
		};
		return instance;
	}

	/** Mount hook: load saved buckets, then start the worker (it restores its own checkpoint). */
	function attach(): void {
		state.buckets = loadEvolutionBuckets();
		worker = connectWorker();
	}

	function dispose(): void {
		send({ type: 'dispose' });
		worker?.terminate();
		worker = null;
		state.cameraBridge.detach();
	}

	return {
		send,
		resetThroughput,
		acknowledgeVisuals,
		attach,
		dispose
	};
}

export type LabWorkerController = ReturnType<typeof createLabWorkerController>;
