import { DEFAULT_MATCH_SETTINGS, type MatchSettings } from '#lib/game/match-config';
import { GameCameraBridge, type CameraView } from '#lib/game/render/camera-bridge';
import type { RendererFrameStats } from '#lib/game/render/territory-renderer';
import type { GameSnapshot, SimEvent } from '#lib/game/simulation';
import type { StructureContextMenu } from '#lib/game/ui/structure-menu';
import type { WorkerLocalSimulation } from '#lib/game/worker/local-simulation';
import type { LedgerBlock } from '#lib/game/ledger/agent';
import type { MatchLedger } from '#lib/game/net/match-ledger';
import type { LocalRoomDefinition } from '#lib/game/multiplayer/rooms';
import { createHudSelectors } from './selectors/hud.svelte';
import { createInteractionSelectors } from './selectors/interaction.svelte';
import { createMatchSelectors } from './selectors/match.svelte';
import { createOverlaySelectors } from './selectors/overlay.svelte';
import { createRankingSelectors } from './selectors/ranking.svelte';
import type { HoverState, OnboardingStep, WorkerVisualEntry } from './selectors/types';

export type { HoverState, OnboardingStep, WorkerVisualEntry };

/**
 * Per-feature selector groups. `game-page-state.svelte.ts` owns the writable
 * rune cells (see `createStateAccessors`) and the selector groups under
 * `./selectors/` only derive views from them.
 *
 * Reactivity contract: groups receive live accessors, never captured values, so
 * reading `state.foo` inside a group's `$derived` tracks the same source signal
 * as before the split. The `$state` cells stay in this module because the page
 * factory owns the single rune scope; the derived groups are stateless helpers.
 */
function createStateAccessors() {
	let sim = $state<WorkerLocalSimulation | null>(null);
	let snapshot = $state<GameSnapshot | null>(null);
	let workerVisuals = $state<WorkerVisualEntry[]>([]);
	let workerVisualRevision = 0;
	let lastWorkerUiTick = -100;
	let workerTelemetryVersion = $state(0);
	let phase = $state<'loading' | 'ready' | 'error'>('ready');
	let errorMessage = $state('');
	let rendererReady = $state(false);
	let gameStarted = $state(false);
	let paused = $state(true);
	let showIntro = $state(true);
	let landing = $state(true);
	let activeRoom = $state<LocalRoomDefinition | null>(null);
	let autoStartRoom = $state(false);
	let showHelp = $state(false);
	let replayMode = $state(false);
	let replayName = $state('');
	let replayComplete = $state(false);
	let replayLedger = $state<MatchLedger | null>(null);
	let replayBlocks = $state<LedgerBlock[]>([]);
	let replayTick = $state(0);
	let replayMaxTick = $state(0);
	let replayPlaying = $state(false);
	let replaySpeed = $state(1);
	let onboardingStep = $state<OnboardingStep | null>(null);
	let onboardingDone = $state(false);
	let defeatOpen = $state(false);
	let defeatHandled = $state(false);
	let hover = $state<HoverState | null>(null);
	let structureMenu = $state<StructureContextMenu | null>(null);
	let contextMenuEl = $state<HTMLDivElement | null>(null);
	let pointerScreen = $state<{ x: number; y: number } | null>(null);
	let shiftHeld = $state(false);
	let ctrlHeld = $state(false);
	let upgradeBatch = $state<1 | 5 | 10 | 25>(1);
	let cameraView = $state<CameraView | null>(null);
	// Non-reactive anchor: the camera view captured when the popup opens, so the
	// renderer's periodic view reports do not dismiss a freshly positioned menu.
	let structureMenuCameraView: CameraView | null = null;
	let perf = $state<RendererFrameStats>({
		fps: 0,
		uploadedPixels: 0,
		uploadCalls: 0,
		frames: 0
	});
	let eventFeed = $state<SimEvent[]>([]);
	let currentSeed = $state(0);
	let seedInput = $state('');
	let rankScrollEl = $state<HTMLDivElement | null>(null);
	let rankScrollTop = $state(0);
	let rankViewportHeight = $state(360);
	let handRaised = $state(true);
	let handShellEl = $state<HTMLDivElement | null>(null);
	let matchSettings = $state<MatchSettings>({ ...DEFAULT_MATCH_SETTINGS });
	let appliedMatchSettings = $state<MatchSettings | null>(null);
	let keyboardCursor = $state<{ x: number; y: number } | null>(null);
	let draggingCardId = $state<number | null>(null);
	let keyboardPlacement = $state(false);
	let dragOrigin = $state<{ x: number; y: number } | null>(null);
	let dragPointer = $state<{ x: number; y: number } | null>(null);
	let dragLanding = $state<{
		x: number;
		y: number;
		radius: number;
		ok: boolean;
	} | null>(null);
	let transparentDragImage: HTMLCanvasElement | null = null;
	let diplomacyToast = $state<{ message: string; tone: 'success' | 'warn' | 'error' } | null>(null);
	let artilleryTargeting = $state(false);

	const cameraBridge = new GameCameraBridge();

	return {
		cameraBridge,
		get sim() {
			return sim;
		},
		set sim(value) {
			sim = value;
		},
		get snapshot() {
			return snapshot;
		},
		set snapshot(value) {
			snapshot = value;
		},
		get workerVisuals() {
			return workerVisuals;
		},
		set workerVisuals(value) {
			workerVisuals = value;
		},
		get workerVisualRevision() {
			return workerVisualRevision;
		},
		set workerVisualRevision(value) {
			workerVisualRevision = value;
		},
		get lastWorkerUiTick() {
			return lastWorkerUiTick;
		},
		set lastWorkerUiTick(value) {
			lastWorkerUiTick = value;
		},
		get workerTelemetryVersion() {
			return workerTelemetryVersion;
		},
		set workerTelemetryVersion(value) {
			workerTelemetryVersion = value;
		},
		get phase() {
			return phase;
		},
		set phase(value) {
			phase = value;
		},
		get errorMessage() {
			return errorMessage;
		},
		set errorMessage(value) {
			errorMessage = value;
		},
		get rendererReady() {
			return rendererReady;
		},
		set rendererReady(value) {
			rendererReady = value;
		},
		get gameStarted() {
			return gameStarted;
		},
		set gameStarted(value) {
			gameStarted = value;
		},
		get paused() {
			return paused;
		},
		set paused(value) {
			paused = value;
		},
		get showIntro() {
			return showIntro;
		},
		set showIntro(value) {
			showIntro = value;
		},
		get landing() {
			return landing;
		},
		set landing(value) {
			landing = value;
		},
		get activeRoom() {
			return activeRoom;
		},
		set activeRoom(value) {
			activeRoom = value;
		},
		get autoStartRoom() {
			return autoStartRoom;
		},
		set autoStartRoom(value) {
			autoStartRoom = value;
		},
		get replayMode() {
			return replayMode;
		},
		set replayMode(value) {
			replayMode = value;
		},
		get replayName() {
			return replayName;
		},
		set replayName(value) {
			replayName = value;
		},
		get replayComplete() {
			return replayComplete;
		},
		set replayComplete(value) {
			replayComplete = value;
		},
		get replayLedger() {
			return replayLedger;
		},
		set replayLedger(value) {
			replayLedger = value;
		},
		get replayBlocks() {
			return replayBlocks;
		},
		set replayBlocks(value) {
			replayBlocks = value;
		},
		get replayTick() {
			return replayTick;
		},
		set replayTick(value) {
			replayTick = value;
		},
		get replayMaxTick() {
			return replayMaxTick;
		},
		set replayMaxTick(value) {
			replayMaxTick = value;
		},
		get replayPlaying() {
			return replayPlaying;
		},
		set replayPlaying(value) {
			replayPlaying = value;
		},
		get replaySpeed() {
			return replaySpeed;
		},
		set replaySpeed(value) {
			replaySpeed = value;
		},
		get showHelp() {
			return showHelp;
		},
		set showHelp(value) {
			showHelp = value;
		},
		get onboardingStep() {
			return onboardingStep;
		},
		set onboardingStep(value) {
			onboardingStep = value;
		},
		get onboardingDone() {
			return onboardingDone;
		},
		set onboardingDone(value) {
			onboardingDone = value;
		},
		get defeatOpen() {
			return defeatOpen;
		},
		set defeatOpen(value) {
			defeatOpen = value;
		},
		get defeatHandled() {
			return defeatHandled;
		},
		set defeatHandled(value) {
			defeatHandled = value;
		},
		get hover() {
			return hover;
		},
		set hover(value) {
			hover = value;
		},
		get structureMenu() {
			return structureMenu;
		},
		set structureMenu(value) {
			structureMenu = value;
		},
		get contextMenuEl() {
			return contextMenuEl;
		},
		set contextMenuEl(value) {
			contextMenuEl = value;
		},
		get pointerScreen() {
			return pointerScreen;
		},
		set pointerScreen(value) {
			pointerScreen = value;
		},
		get shiftHeld() {
			return shiftHeld;
		},
		set shiftHeld(value) {
			shiftHeld = value;
		},
		get ctrlHeld() {
			return ctrlHeld;
		},
		set ctrlHeld(value) {
			ctrlHeld = value;
		},
		get upgradeBatch() {
			return upgradeBatch;
		},
		set upgradeBatch(value) {
			upgradeBatch = value;
		},
		get cameraView() {
			return cameraView;
		},
		set cameraView(value) {
			cameraView = value;
		},
		get structureMenuCameraView() {
			return structureMenuCameraView;
		},
		set structureMenuCameraView(value) {
			structureMenuCameraView = value;
		},
		get perf() {
			return perf;
		},
		set perf(value) {
			perf = value;
		},
		get eventFeed() {
			return eventFeed;
		},
		set eventFeed(value) {
			eventFeed = value;
		},
		get currentSeed() {
			return currentSeed;
		},
		set currentSeed(value) {
			currentSeed = value;
		},
		get seedInput() {
			return seedInput;
		},
		set seedInput(value) {
			seedInput = value;
		},
		get rankScrollEl() {
			return rankScrollEl;
		},
		set rankScrollEl(value) {
			rankScrollEl = value;
		},
		get rankScrollTop() {
			return rankScrollTop;
		},
		set rankScrollTop(value) {
			rankScrollTop = value;
		},
		get rankViewportHeight() {
			return rankViewportHeight;
		},
		set rankViewportHeight(value) {
			rankViewportHeight = value;
		},
		get handRaised() {
			return handRaised;
		},
		set handRaised(value) {
			handRaised = value;
		},
		get handShellEl() {
			return handShellEl;
		},
		set handShellEl(value) {
			handShellEl = value;
		},
		get matchSettings() {
			return matchSettings;
		},
		set matchSettings(value) {
			matchSettings = value;
		},
		get appliedMatchSettings() {
			return appliedMatchSettings;
		},
		set appliedMatchSettings(value) {
			appliedMatchSettings = value;
		},
		get keyboardCursor() {
			return keyboardCursor;
		},
		set keyboardCursor(value) {
			keyboardCursor = value;
		},
		get draggingCardId() {
			return draggingCardId;
		},
		set draggingCardId(value) {
			draggingCardId = value;
		},
		get keyboardPlacement() {
			return keyboardPlacement;
		},
		set keyboardPlacement(value) {
			keyboardPlacement = value;
		},
		get dragOrigin() {
			return dragOrigin;
		},
		set dragOrigin(value) {
			dragOrigin = value;
		},
		get dragPointer() {
			return dragPointer;
		},
		set dragPointer(value) {
			dragPointer = value;
		},
		get dragLanding() {
			return dragLanding;
		},
		set dragLanding(value) {
			dragLanding = value;
		},
		get transparentDragImage() {
			return transparentDragImage;
		},
		set transparentDragImage(value) {
			transparentDragImage = value;
		},
		get diplomacyToast() {
			return diplomacyToast;
		},
		set diplomacyToast(value) {
			diplomacyToast = value;
		},
		get artilleryTargeting() {
			return artilleryTargeting;
		},
		set artilleryTargeting(value) {
			artilleryTargeting = value;
		}
	};
}

type CoreStateAccessors = ReturnType<typeof createStateAccessors>;

/**
 * The legacy `createGamePageState()` surface: writable state cells plus the
 * derived selector groups. Controllers receive this type and mutate cells
 * through the setters, exactly as before the split.
 */
export type GamePageState = CoreStateAccessors &
	ReturnType<typeof createInteractionSelectors> &
	ReturnType<typeof createHudSelectors> &
	ReturnType<typeof createRankingSelectors> &
	ReturnType<typeof createMatchSelectors> &
	ReturnType<typeof createOverlaySelectors>;

/**
 * Copies property descriptors (not values) so every accessor stays live on the
 * combined state object. A predicate that returned values here would snapshot
 * the runes and break every consumer.
 */
function mergeAccessors(...sources: readonly object[]): GamePageState {
	const target: Record<string, unknown> = {};
	for (const source of sources) {
		for (const key of Object.getOwnPropertyNames(source)) {
			const descriptor = Object.getOwnPropertyDescriptor(source, key);
			if (!descriptor) continue;
			Object.defineProperty(target, key, descriptor);
		}
	}
	return target as GamePageState;
}

/**
 * Owns every reactive value rendered by the game page. State cells live here;
 * derived selector groups live under `./selectors/` and receive live accessors
 * so rune reactivity is preserved across module boundaries.
 */
export function createGamePageState(): GamePageState {
	const core = createStateAccessors();
	const interaction = createInteractionSelectors(core);
	const hud = createHudSelectors(core);
	const ranking = createRankingSelectors(core, hud);
	const match = createMatchSelectors(core);
	const overlay = createOverlaySelectors(core);

	return mergeAccessors(core, interaction, hud, ranking, match, overlay);
}
