import { EvolutionSandbox, type EvolutionConfig, type EvolutionSessionSnapshot } from './evolution';
import type { TerritorySimulation, StepResult } from '../simulation';
import type {
	EvolutionWorkerCommand,
	EvolutionWorkerMessage,
	WorkerMatchInit,
	WorkerVisual
} from './evolution-worker-protocol';

const TICK_MS = 100;
const DISTANCE_TILE_SIZE = 32;
const FRAME_BUDGET_MS = 8;
const VISUAL_INTERVAL_MS = 16;
const MAX_PENDING_CHANGES = 250_000;
const SESSION_DB = 'territory-evolution';
const SESSION_STORE = 'session';
const SESSION_KEY = 'last';

const scope = self as unknown as {
	postMessage(message: EvolutionWorkerMessage, transfer?: Transferable[]): void;
	onmessage: ((event: MessageEvent<EvolutionWorkerCommand>) => void) | null;
};

let sandbox: EvolutionSandbox | null = null;
let running = false;
let speed = 4;
let timer: ReturnType<typeof setTimeout> | null = null;
let lastTime = 0;
let accumulator = 0;
let nextMatchAt = 0;
let activeSimulation: TerritorySimulation | null = null;
let matchId = 0;
let lastVisualAt = 0;

let pendingChanges: Uint32Array[] = [];
let pendingChangeCount = 0;
let pendingOverflow = false;
const pendingDistrictTiles = new Set<number>();
let restoredConfig: EvolutionConfig | null = null;
let sessionReady = false;
const pendingCommands: EvolutionWorkerCommand[] = [];
let sessionDb: Promise<IDBDatabase> | null = null;

function openSessionDb(): Promise<IDBDatabase> {
	if (sessionDb) return sessionDb;
	sessionDb = new Promise((resolve, reject) => {
		const request = indexedDB.open(SESSION_DB, 1);
		request.onupgradeneeded = () => {
			if (!request.result.objectStoreNames.contains(SESSION_STORE)) {
				request.result.createObjectStore(SESSION_STORE);
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
	return sessionDb;
}

async function loadSessionSnapshot(): Promise<EvolutionSessionSnapshot | null> {
	try {
		const db = await openSessionDb();
		return await new Promise((resolve, reject) => {
			const request = db
				.transaction(SESSION_STORE, 'readonly')
				.objectStore(SESSION_STORE)
				.get(SESSION_KEY);
			request.onsuccess = () =>
				resolve((request.result as EvolutionSessionSnapshot | undefined) ?? null);
			request.onerror = () => reject(request.error);
		});
	} catch {
		return null;
	}
}

async function saveSessionSnapshot(snapshot: EvolutionSessionSnapshot | null): Promise<void> {
	if (!snapshot) return;
	try {
		const db = await openSessionDb();
		await new Promise<void>((resolve, reject) => {
			const transaction = db.transaction(SESSION_STORE, 'readwrite');
			transaction.objectStore(SESSION_STORE).put(snapshot, SESSION_KEY);
			transaction.oncomplete = () => resolve();
			transaction.onerror = () => reject(transaction.error);
		});
	} catch {
		// Persistence is best-effort; a run must continue without it.
	}
}

async function clearSessionSnapshot(): Promise<void> {
	try {
		const db = await openSessionDb();
		await new Promise<void>((resolve, reject) => {
			const transaction = db.transaction(SESSION_STORE, 'readwrite');
			transaction.objectStore(SESSION_STORE).delete(SESSION_KEY);
			transaction.oncomplete = () => resolve();
			transaction.onerror = () => reject(transaction.error);
		});
	} catch {
		// Best-effort cleanup.
	}
}

function persistCurrentSession(): void {
	if (!sandbox) return;
	const snapshot = sandbox.captureSession();
	if (snapshot) void saveSessionSnapshot(snapshot);
}

function queueLoop(): void {
	if (timer !== null) return;
	timer = setTimeout(loop, 0);
}

function stopLoop(): void {
	if (timer !== null) {
		clearTimeout(timer);
		timer = null;
	}
}

function matchDelay(): number {
	return speed >= 480 ? 20 : speed >= 120 ? 70 : speed >= 48 ? 160 : 650;
}

function resetPending(): void {
	pendingChanges = [];
	pendingChangeCount = 0;
	pendingOverflow = false;
	pendingDistrictTiles.clear();
}

function postState(): void {
	if (!sandbox) return;
	const terminal = sandbox.phase === 'finished' || sandbox.phase === 'generation-complete';
	scope.postMessage({
		type: 'state',
		state: {
			phase: sandbox.phase,
			generation: sandbox.generation,
			progress: sandbox.progress,
			seats: sandbox.currentSeats.map((genome) => genome),
			population: sandbox.population.map((genome) => genome),
			rows: sandbox.latestRows,
			archiveRows: Array.from(sandbox.archive.values()),
			report: terminal ? sandbox.report() : null,
			markovStates: sandbox.currentSeats.map(
				(_, index) => sandbox?.currentSimulation?.getBotMarkovState(index + 1) ?? null
			),
			restoredConfig
		}
	});
	restoredConfig = null;
}

function postMatchInit(simulation: TerritorySimulation): void {
	const snapshot = simulation.getSnapshot();
	const init: WorkerMatchInit = {
		width: simulation.width,
		height: simulation.height,
		starts: simulation.map.starts.map((start) => ({ ...start })),
		terrain: simulation.map.land.slice(),
		terrainShade: simulation.map.shade.slice(),
		terrainElevation: simulation.map.elevation.slice(),
		owners: simulation.owners.slice(),
		districtColorCodes: simulation.districtColorCodes.slice(),
		snapshot
	};
	scope.postMessage({ type: 'match', matchId, init });
	lastVisualAt = performance.now();
}

function startMatch(): void {
	const simulation = sandbox?.currentSimulation;
	if (!simulation) return;
	activeSimulation = simulation;
	matchId++;
	resetPending();
	postMatchInit(simulation);
	postState();
}

function accumulate(result: StepResult): void {
	if (pendingOverflow) return;
	if (result.changesOverflow || (result.districtsChanged && result.districtTiles.length === 0)) {
		pendingOverflow = true;
		pendingChanges = [];
		pendingChangeCount = 0;
		pendingDistrictTiles.clear();
		return;
	}
	if (result.changeCount > 0) {
		const copy = result.changes.slice(0, result.changeCount);
		pendingChanges.push(copy);
		pendingChangeCount += copy.length;
		if (pendingChangeCount > MAX_PENDING_CHANGES) {
			pendingOverflow = true;
			pendingChanges = [];
			pendingChangeCount = 0;
			pendingDistrictTiles.clear();
			return;
		}
	}
	for (const tile of result.districtTiles) pendingDistrictTiles.add(tile);
}

function districtTileColors(simulation: TerritorySimulation, tiles: readonly number[]): Uint8Array {
	const colors = new Uint8Array(tiles.length * DISTANCE_TILE_SIZE * DISTANCE_TILE_SIZE);
	const tilesX = Math.ceil(simulation.width / DISTANCE_TILE_SIZE);
	for (let block = 0; block < tiles.length; block++) {
		const tile = tiles[block] ?? 0;
		const x0 = (tile % tilesX) * DISTANCE_TILE_SIZE;
		const y0 = Math.floor(tile / tilesX) * DISTANCE_TILE_SIZE;
		const offset = block * DISTANCE_TILE_SIZE * DISTANCE_TILE_SIZE;
		for (let y = 0; y < DISTANCE_TILE_SIZE; y++) {
			const worldY = y0 + y;
			if (worldY >= simulation.height) break;
			for (let x = 0; x < DISTANCE_TILE_SIZE; x++) {
				const worldX = x0 + x;
				if (worldX >= simulation.width) break;
				colors[offset + y * DISTANCE_TILE_SIZE + x] =
					simulation.districtColorCodes[worldY * simulation.width + worldX] ?? 0;
			}
		}
	}
	return colors;
}

function flushVisual(): void {
	const simulation = sandbox?.currentSimulation;
	if (!simulation) return;
	const snapshot = simulation.getSnapshot();
	const visual: WorkerVisual = {
		matchId,
		tick: simulation.tick,
		snapshot,
		changes: new Uint32Array(0),
		changeCount: 0,
		overflow: false,
		owners: null,
		districtColorCodes: null,
		districtTiles: [],
		districtTileColors: null,
		markovStates: sandbox
			? sandbox.currentSeats.map(
					(_, index) => sandbox?.currentSimulation?.getBotMarkovState(index + 1) ?? null
				)
			: []
	};
	const transfer: Transferable[] = [];
	if (pendingOverflow) {
		const owners = simulation.owners.slice();
		const districtColorCodes = simulation.districtColorCodes.slice();
		visual.overflow = true;
		visual.owners = owners;
		visual.districtColorCodes = districtColorCodes;
		transfer.push(owners.buffer, districtColorCodes.buffer);
	} else {
		const changes = new Uint32Array(pendingChangeCount);
		let offset = 0;
		for (const chunk of pendingChanges) {
			changes.set(chunk, offset);
			offset += chunk.length;
		}
		const tiles = Array.from(pendingDistrictTiles).sort((left, right) => left - right);
		visual.changes = changes;
		visual.changeCount = changes.length;
		visual.districtTiles = tiles;
		visual.districtTileColors = tiles.length > 0 ? districtTileColors(simulation, tiles) : null;
		transfer.push(changes.buffer);
		if (visual.districtTileColors) transfer.push(visual.districtTileColors.buffer);
	}
	resetPending();
	lastVisualAt = performance.now();
	scope.postMessage({ type: 'visual', visual }, transfer);
}

function shouldFlush(now: number): boolean {
	return now - lastVisualAt >= VISUAL_INTERVAL_MS;
}

function loop(): void {
	timer = null;
	if (!sandbox || !running) return;
	const now = performance.now();
	const delta = Math.min(250, Math.max(0, now - lastTime));
	lastTime = now;

	if (nextMatchAt > 0 && now >= nextMatchAt) {
		nextMatchAt = 0;
		if (sandbox.nextMatch()) startMatch();
	}

	if (nextMatchAt === 0 && sandbox.currentSimulation) {
		if (activeSimulation !== sandbox.currentSimulation) startMatch();
		accumulator = Math.min(accumulator + delta * speed, TICK_MS * 2000);
		const budgetEnd = performance.now() + FRAME_BUDGET_MS;
		while (accumulator >= TICK_MS && sandbox.currentSimulation && performance.now() < budgetEnd) {
			const result = sandbox.stepOnce();
			if (!result) break;
			accumulate(result);
			accumulator -= TICK_MS;
			const simulation = sandbox.currentSimulation;
			if (!simulation) break;
			if (simulation.ended || simulation.tick >= sandbox.config.ticks) {
				flushVisual();
				sandbox.finishMatch();
				postState();
				persistCurrentSession();
				activeSimulation = null;
				accumulator = 0;
				if (sandbox.phase === 'finished') {
					running = false;
					break;
				}
				nextMatchAt = performance.now() + matchDelay();
				break;
			}
			if (shouldFlush(performance.now())) flushVisual();
		}
		if (sandbox.currentSimulation && shouldFlush(performance.now())) {
			flushVisual();
		}
	}

	if (running || nextMatchAt > 0) queueLoop();
}

function begin(config: EvolutionConfig): void {
	stopLoop();
	void clearSessionSnapshot();
	sandbox = new EvolutionSandbox(config);
	sandbox.begin();
	running = true;
	speed = Math.max(1, speed);
	activeSimulation = null;
	nextMatchAt = 0;
	accumulator = 0;
	lastTime = performance.now();
	resetPending();
	startMatch();
	queueLoop();
}

function setPopulation(
	config: EvolutionConfig,
	genomes: Parameters<EvolutionSandbox['setPopulation']>[0]
): void {
	stopLoop();
	void clearSessionSnapshot();
	const next = new EvolutionSandbox(config);
	if (!next.setPopulation(genomes)) {
		scope.postMessage({ type: 'error', message: 'Population is smaller than the player count.' });
		return;
	}
	sandbox = next;
	running = true;
	activeSimulation = null;
	nextMatchAt = 0;
	accumulator = 0;
	lastTime = performance.now();
	resetPending();
	startMatch();
	queueLoop();
}

function resumeRun(): void {
	if (!sandbox) return;
	if (sandbox.phase === 'finished') {
		if (!sandbox.continueEvolution(1)) {
			scope.postMessage({
				type: 'error',
				message: 'This run reached the maximum generation count.'
			});
			return;
		}
	}
	if (!sandbox.currentSimulation) sandbox.nextMatch();
	running = true;
	nextMatchAt = 0;
	activeSimulation = null;
	accumulator = 0;
	lastTime = performance.now();
	resetPending();
	startMatch();
	queueLoop();
}

function handleCommand(command: EvolutionWorkerCommand): void {
	try {
		switch (command.type) {
			case 'start':
				begin(command.config);
				break;
			case 'set-population':
				setPopulation(command.config, command.genomes);
				break;
			case 'continue':
				resumeRun();
				break;
			case 'pause':
				running = false;
				accumulator = 0;
				stopLoop();
				flushVisual();
				postState();
				break;
			case 'resume':
				if (!sandbox) return;
				running = true;
				lastTime = performance.now();
				queueLoop();
				break;
			case 'speed':
				speed = Math.max(1, Math.min(1000, Math.round(command.speed)));
				break;
			case 'dispose':
				running = false;
				stopLoop();
				sandbox = null;
				break;
		}
	} catch (error) {
		scope.postMessage({
			type: 'error',
			message: error instanceof Error ? error.message : 'Evolution worker failed.'
		});
	}
}

scope.onmessage = (event) => {
	if (!sessionReady) {
		pendingCommands.push(event.data);
		return;
	}
	handleCommand(event.data);
};

async function initializeSession(): Promise<void> {
	try {
		const snapshot = await loadSessionSnapshot();
		if (snapshot) {
			const restored = new EvolutionSandbox(snapshot.config);
			if (restored.restoreSession(snapshot)) {
				sandbox = restored;
				running = false;
				restoredConfig = snapshot.config;
				postState();
			}
		}
	} catch {
		// A corrupt or unavailable checkpoint must not block the lab.
	} finally {
		sessionReady = true;
		for (const command of pendingCommands) handleCommand(command);
		pendingCommands.length = 0;
	}
}

void initializeSession();
