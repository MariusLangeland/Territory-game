import {
	BOT_BUCKETS,
	DEFAULT_EVOLUTION_CONFIG,
	GAUNTLET_SEATS,
	bucketCounts,
	emptyBuckets,
	type BotBucket,
	type BotGenome,
	type EvolutionBuckets,
	type EvolutionConfig,
	type EvolutionReport,
	type GenomePerformance
} from '#lib/game/ai';
import { buildFitnessHistory } from '#lib/game/ai/fitness-history';
import { GameCameraBridge } from '#lib/game/render/camera-bridge';
import type { GameSnapshot } from '#lib/game/simulation';
import type { RemoteSimulationView } from '#lib/game/worker/view';

/** Spectator fast-forward presets; the worker converts these to tick steps. */
export const EVOLUTION_SPEEDS = [
	{ label: '1×', steps: 1 },
	{ label: '4×', steps: 4 },
	{ label: '16×', steps: 16 },
	{ label: '48×', steps: 48 },
	{ label: '120×', steps: 120 },
	{ label: '480×', steps: 480 },
	{ label: '1000×', steps: 1000 }
] as const;

export type EvolutionLabPhase = 'idle' | 'match' | 'generation-complete' | 'finished';

/** Mirrors the main-game `WorkerVisualEntry`: one worker visual awaiting upload. */
export interface RemoteVisual {
	revision: number;
	tick: number;
	snapshot: GameSnapshot;
	changes: Uint32Array;
	changeCount: number;
	overflow: boolean;
	districtTiles: number[];
}

/**
 * Owns every reactive value rendered by the Evolution Lab page. Feature
 * controllers mutate these through the getters/setters; keeping the
 * declarations in one `.svelte.ts` module preserves rune reactivity across
 * module boundaries, matching `src/lib/game/page/game-page-state.svelte.ts`.
 */
export function createEvolutionPageState() {
	let config = $state<EvolutionConfig>({
		...DEFAULT_EVOLUTION_CONFIG,
		fitnessWeights: { ...DEFAULT_EVOLUTION_CONFIG.fitnessWeights }
	});
	let started = $state(false);
	let restoredSession = $state(false);
	let phase = $state<EvolutionLabPhase>('idle');
	let generation = $state(0);
	let progress = $state({ match: 0, matches: 0, generation: 0 });
	let currentSeats = $state<BotGenome[]>([]);
	let population = $state<BotGenome[]>([]);
	let rows = $state<GenomePerformance[]>([]);
	let archiveRows = $state<GenomePerformance[]>([]);
	let markovStates = $state<(number | null)[]>([]);
	let lastReport = $state<EvolutionReport | null>(null);
	const emptySeats = $derived(Math.max(0, GAUNTLET_SEATS - population.length));
	let remoteView = $state<RemoteSimulationView | null>(null);
	let remoteVisualQueue = $state<RemoteVisual[]>([]);
	let snapshot = $state<GameSnapshot | null>(null);
	const cameraBridge = new GameCameraBridge();
	let running = $state(false);
	let speed = $state(4);
	let effectiveTps = $state(0);
	let matchKey = $state(0);
	let status = $state('Configure a population and start natural selection.');
	let notice = $state('');
	let fileInput = $state<HTMLInputElement | null>(null);
	let stateFileInput = $state<HTMLInputElement | null>(null);
	let buckets = $state<EvolutionBuckets>(emptyBuckets());
	let selectedBuckets = $state<Record<BotBucket, boolean>>({
		poor: false,
		good: false,
		top: true
	});
	let selectedGenomeId = $state<string | null>(null);

	const simulationActive = $derived(started && phase === 'match');
	const counts = $derived(bucketCounts(buckets));
	const selectedOwnerId = $derived.by(() => {
		if (!selectedGenomeId) return null;
		const seat = currentSeats.findIndex((genome) => genome.id === selectedGenomeId);
		return seat >= 0 ? seat + 1 : null;
	});
	const selectedGenome = $derived.by<BotGenome | null>(() => {
		if (!selectedGenomeId) return null;
		return (
			population.find((genome) => genome.id === selectedGenomeId) ??
			currentSeats.find((genome) => genome.id === selectedGenomeId) ??
			rows.find((row) => row.genome.id === selectedGenomeId)?.genome ??
			null
		);
	});
	const selectedMarkovState = $derived.by(() => {
		if (!selectedOwnerId) return null;
		return markovStates[selectedOwnerId - 1] ?? null;
	});
	const historyPoints = $derived(
		buildFitnessHistory(lastReport?.generations ?? [], selectedGenomeId)
	);

	return {
		/** Static markup data: speed presets and the bucket column order. */
		speeds: EVOLUTION_SPEEDS,
		botBuckets: BOT_BUCKETS,

		get config() {
			return config;
		},
		set config(value) {
			config = value;
		},
		get started() {
			return started;
		},
		set started(value) {
			started = value;
		},
		get restoredSession() {
			return restoredSession;
		},
		set restoredSession(value) {
			restoredSession = value;
		},
		get phase() {
			return phase;
		},
		set phase(value) {
			phase = value;
		},
		get generation() {
			return generation;
		},
		set generation(value) {
			generation = value;
		},
		get progress() {
			return progress;
		},
		set progress(value) {
			progress = value;
		},
		get currentSeats() {
			return currentSeats;
		},
		set currentSeats(value) {
			currentSeats = value;
		},
		get population() {
			return population;
		},
		set population(value) {
			population = value;
		},
		get rows() {
			return rows;
		},
		set rows(value) {
			rows = value;
		},
		get archiveRows() {
			return archiveRows;
		},
		set archiveRows(value) {
			archiveRows = value;
		},
		get markovStates() {
			return markovStates;
		},
		set markovStates(value) {
			markovStates = value;
		},
		get lastReport() {
			return lastReport;
		},
		set lastReport(value) {
			lastReport = value;
		},
		get emptySeats() {
			return emptySeats;
		},
		get remoteView() {
			return remoteView;
		},
		set remoteView(value) {
			remoteView = value;
		},
		get remoteVisualQueue() {
			return remoteVisualQueue;
		},
		set remoteVisualQueue(value) {
			remoteVisualQueue = value;
		},
		get snapshot() {
			return snapshot;
		},
		set snapshot(value) {
			snapshot = value;
		},
		get cameraBridge() {
			return cameraBridge;
		},
		get running() {
			return running;
		},
		set running(value) {
			running = value;
		},
		get speed() {
			return speed;
		},
		set speed(value) {
			speed = value;
		},
		get effectiveTps() {
			return effectiveTps;
		},
		set effectiveTps(value) {
			effectiveTps = value;
		},
		get matchKey() {
			return matchKey;
		},
		set matchKey(value) {
			matchKey = value;
		},
		get status() {
			return status;
		},
		set status(value) {
			status = value;
		},
		get notice() {
			return notice;
		},
		set notice(value) {
			notice = value;
		},
		get fileInput() {
			return fileInput;
		},
		set fileInput(value) {
			fileInput = value;
		},
		get stateFileInput() {
			return stateFileInput;
		},
		set stateFileInput(value) {
			stateFileInput = value;
		},
		get buckets() {
			return buckets;
		},
		set buckets(value) {
			buckets = value;
		},
		get selectedBuckets() {
			return selectedBuckets;
		},
		set selectedBuckets(value) {
			selectedBuckets = value;
		},
		get selectedGenomeId() {
			return selectedGenomeId;
		},
		set selectedGenomeId(value) {
			selectedGenomeId = value;
		},
		get simulationActive() {
			return simulationActive;
		},
		get counts() {
			return counts;
		},
		get selectedOwnerId() {
			return selectedOwnerId;
		},
		get selectedGenome() {
			return selectedGenome;
		},
		get selectedMarkovState() {
			return selectedMarkovState;
		},
		get historyPoints() {
			return historyPoints;
		}
	};
}

export type EvolutionPageState = ReturnType<typeof createEvolutionPageState>;
