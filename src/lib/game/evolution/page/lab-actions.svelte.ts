import {
	BOT_BUCKETS,
	type BotBucket,
	type EvolutionMode,
	type EvolutionSessionSnapshot,
	type FitnessWeights
} from '#lib/game/ai';
import {
	downloadEvolutionCsv,
	downloadGauntletState,
	readCsvGenomes,
	readGauntletState
} from './lab-files';
import type { EvolutionPageState } from './lab-state.svelte';
import type { LabWorkerController } from './lab-worker-controller.svelte';

/**
 * Evolution Lab commands and DOM event handlers. Every worker command and every
 * import/export used to live inline in the route; keeping them here leaves the
 * route as markup + `createEvolutionPage()` like the main game page.
 */
export function createLabActions(state: EvolutionPageState, worker: LabWorkerController) {
	/** Clears stale mirrors before a new run; the worker remains authoritative. */
	function prepareRun(clearRoster: boolean): void {
		state.selectedGenomeId = null;
		state.restoredSession = false;
		worker.resetThroughput();
		state.lastReport = null;
		state.rows = [];
		state.archiveRows = [];
		if (clearRoster) {
			state.population = [];
			state.currentSeats = [];
		}
		state.remoteView = null;
		state.remoteVisualQueue = [];
		state.started = true;
		state.running = true;
	}

	function setMode(mode: EvolutionMode): void {
		state.config.mode = mode;
		if (mode === 'gauntlet') {
			state.config.populationSize = 64;
			state.config.playerCount = 64;
			state.config.generations = 1;
			state.config.matchesPerRound = 1;
			state.config.teamCount = 1;
			state.config.lineageDuels = false;
			state.config.ticks = Math.max(state.config.ticks, 3000);
			state.config.width = 2048;
			state.config.height = 1024;
		} else {
			state.config.populationSize = Math.min(16, state.config.populationSize);
			state.config.playerCount = Math.min(8, state.config.populationSize);
			state.config.generations = 4;
			state.config.matchesPerRound = 2;
			state.config.teamCount = 1;
			state.config.lineageDuels = true;
			state.config.ticks = 1600;
			state.config.width = 1280;
			state.config.height = 720;
		}
	}

	function handleModeChange(event: Event): void {
		setMode((event.currentTarget as HTMLSelectElement).value as EvolutionMode);
	}

	function setFitnessWeights(weights: FitnessWeights): void {
		state.config.fitnessWeights = weights;
	}

	function stopRun(): void {
		worker.send({ type: 'stop' });
		state.notice = 'Finishing the current run, then stopping.';
	}

	function stopNow(): void {
		worker.send({ type: 'stop-now' });
		state.notice = 'Simulation stopped immediately.';
	}

	function fillSeats(): void {
		if (state.config.mode !== 'gauntlet' || state.emptySeats === 0 || state.phase === 'match') {
			state.notice = 'Fill seats between gauntlet runs.';
			return;
		}
		worker.send({ type: 'fill-seats' });
		state.notice = `Adding ${state.emptySeats} random genomes…`;
	}

	function discardSession(): void {
		if (!state.started) {
			state.notice = 'There is no saved Evolution Lab session to discard.';
			return;
		}
		worker.send({ type: 'discard-session' });
	}

	function start(): void {
		prepareRun(true);
		state.notice = '';
		worker.send({ type: 'speed', speed: state.speed });
		worker.send({
			type: 'start',
			config: { ...state.config, fitnessWeights: { ...state.config.fitnessWeights } }
		});
		state.status = 'Starting a new evolution…';
	}

	function continueEvolution(): void {
		if (!state.started) {
			state.notice = 'No previous evolution to continue. Start a new evolution first.';
			return;
		}
		worker.send({
			type: 'continue',
			config: { ...state.config, fitnessWeights: { ...state.config.fitnessWeights } }
		});
		state.running = true;
		state.status = 'Continuing the previous run…';
	}

	function toggleRunning(): void {
		if (!state.started) {
			start();
			return;
		}
		state.running = !state.running;
		worker.send({ type: state.running ? 'resume' : 'pause' });
		if (state.running) state.status = 'Resuming evolution…';
	}

	function setSpeed(value: number): void {
		state.speed = value;
		worker.send({ type: 'speed', speed: value });
	}

	function selectGenome(id: string | null): void {
		state.selectedGenomeId = id;
	}

	function selectOwner(ownerId: number | null): void {
		if (!ownerId) {
			state.selectedGenomeId = null;
			state.notice = 'Canvas selection cleared.';
			return;
		}
		const genome = state.currentSeats[ownerId - 1];
		state.selectedGenomeId = genome?.id ?? null;
		state.notice = genome ? `Selected ${genome.id} from the map.` : 'No genome is seated there.';
	}

	function downloadCsv(): void {
		if (!state.lastReport) {
			state.notice = 'Finish at least one generation before exporting.';
			return;
		}
		downloadEvolutionCsv(state.lastReport);
		state.notice = 'Spreadsheet exported.';
	}

	function exportGauntletState(): void {
		if (state.config.mode !== 'gauntlet' || !state.lastReport || state.simulationActive) {
			state.notice = 'Finish or stop a gauntlet run before exporting its state.';
			return;
		}
		const activeIds = new Set(state.population.map((genome) => genome.id));
		const lives: Record<string, number> = {};
		for (const row of state.rows) {
			if (!activeIds.has(row.genome.id)) continue;
			lives[row.genome.id] = row.gauntletLives ?? state.config.gauntletLives;
		}
		const snapshot: EvolutionSessionSnapshot = {
			version: 1,
			config: {
				...state.config,
				mode: 'gauntlet',
				fitnessWeights: { ...state.config.fitnessWeights }
			},
			population: state.population,
			reports: state.lastReport.generations,
			archive: state.lastReport.archive,
			generation: state.generation,
			phase: state.phase === 'finished' ? 'finished' : 'generation-complete',
			gauntletLives: lives
		};
		downloadGauntletState(snapshot);
		state.notice = 'Gauntlet state exported.';
	}

	async function importGauntletState(event: Event): Promise<void> {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		const result = await readGauntletState(file);
		input.value = '';
		if (!result.ok) {
			state.notice =
				result.reason === 'invalid'
					? 'That file is not a valid gauntlet state export.'
					: 'Could not read that gauntlet state file.';
			return;
		}
		worker.send({ type: 'import-state', snapshot: result.snapshot });
		state.notice = 'Importing gauntlet state…';
	}

	async function importCsv(event: Event): Promise<void> {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		const genomes = await readCsvGenomes(file);
		input.value = '';
		if (genomes.length < 2) {
			state.notice = 'Could not find genomes in that CSV. Expected the exported header.';
			return;
		}
		const playerCount = Math.max(2, Math.min(state.config.playerCount, genomes.length));
		const nextConfig = {
			...state.config,
			playerCount,
			populationSize: Math.max(playerCount, genomes.length)
		};
		prepareRun(false);
		worker.send({ type: 'speed', speed: state.speed });
		worker.send({ type: 'set-population', config: nextConfig, genomes });
		state.notice = `Imported ${genomes.length} genomes from spreadsheet.`;
		state.status = 'Imported population — running.';
	}

	function useBuckets(): void {
		const pool = BOT_BUCKETS.flatMap((bucket) =>
			state.selectedBuckets[bucket] ? state.buckets[bucket] : []
		);
		if (pool.length < 2) {
			state.notice = 'Select at least two bucket genomes (run an evolution first).';
			return;
		}
		const playerCount = Math.max(2, Math.min(state.config.playerCount, pool.length));
		const nextConfig = {
			...state.config,
			playerCount,
			populationSize: Math.max(playerCount, pool.length)
		};
		prepareRun(false);
		worker.send({ type: 'speed', speed: state.speed });
		worker.send({ type: 'set-population', config: nextConfig, genomes: pool });
		state.notice = `Loaded ${pool.length} genomes from selected buckets.`;
	}

	function selectAll(bucket: BotBucket, enabled: boolean): void {
		state.selectedBuckets = { ...state.selectedBuckets, [bucket]: enabled };
	}

	function navigateHome(): void {
		window.location.href = '/?seed=1234';
	}

	return {
		setMode,
		handleModeChange,
		setFitnessWeights,
		stopRun,
		stopNow,
		fillSeats,
		discardSession,
		start,
		continueEvolution,
		toggleRunning,
		setSpeed,
		selectGenome,
		selectOwner,
		downloadCsv,
		exportGauntletState,
		importGauntletState,
		importCsv,
		useBuckets,
		selectAll,
		navigateHome
	};
}

export type LabActionsController = ReturnType<typeof createLabActions>;
