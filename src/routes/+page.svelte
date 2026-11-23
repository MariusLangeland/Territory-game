<script lang="ts">
	import './game-page.css';
	import { onMount, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import GameCanvas from '#lib/components/GameCanvas.svelte';
	import CardTray from '#lib/components/CardTray.svelte';
	import GameTopBar from '#lib/components/GameTopBar.svelte';
	import WorldRail from '#lib/components/WorldRail.svelte';
	import DiplomacyToast from '#lib/components/DiplomacyToast.svelte';
	import StructureMenu from '#lib/components/StructureMenu.svelte';
	import SupplyPanel from '#lib/components/SupplyPanel.svelte';
	import MapTools from '#lib/components/MapTools.svelte';
	import DragOverlay from '#lib/components/DragOverlay.svelte';
	import IntroOverlay from '#lib/components/IntroOverlay.svelte';
	import LoadingOverlay from '#lib/components/LoadingOverlay.svelte';
	import ErrorModal from '#lib/components/ErrorModal.svelte';
	import ResultModal from '#lib/components/ResultModal.svelte';
	import DefeatModal from '#lib/components/DefeatModal.svelte';
	import HelpOverlay from '#lib/components/HelpOverlay.svelte';
	import OnboardingHint from '#lib/components/OnboardingHint.svelte';
	import KeyboardCursor from '#lib/components/KeyboardCursor.svelte';
	import UpgradeTooltip from '#lib/components/UpgradeTooltip.svelte';
	import { formatClock, formatCompact, formatShare, formatSupply } from '#lib/format';
	import Minimap from '#lib/components/Minimap.svelte';
	import {
		ARTILLERY_SUPPLY_COST_PER_LEVEL,
		HUMAN_PLAYER_ID,
		STRUCTURE_MIN_SPACING,
		TICK_RATE,
		colorForPlayer
	} from '#lib/game/constants';
	import { GameSession } from '#lib/game/session/game-session';
	import { loadOnboardingDone, saveOnboardingDone } from '#lib/game/session/onboarding';
	import { parseSeed, randomSeed, readSeedFromLocation, seedHexFor } from '#lib/game/session/seed';
	import { type GameSnapshot, type SimEvent } from '#lib/game/simulation';
	import { WorkerLocalSimulation } from '#lib/game/worker/local-simulation';
	import {
		buildStructureMenu,
		clampContextMenu,
		contextMenuItemButtons,
		focusContextMenuItem,
		handleContextMenuKey,
		moveContextMenuFocus,
		type StructureContextMenu
	} from '#lib/game/ui/structure-menu';
	import { createActions } from '#lib/game/ui/actions';
	import { createKeyboardInput } from '#lib/game/ui/keyboard';
	import type { LocalWorkerVisual } from '#lib/game/worker/local-protocol';
	import {
		BOT_COMMAND_POST_STACK_OPTIONS,
		BOT_DIFFICULTY_OPTIONS,
		DEFAULT_MATCH_SETTINGS,
		MAP_PRESETS,
		STATE_COUNT_OPTIONS,
		TIMER_OPTIONS,
		loadMatchSettings,
		mapPreset,
		matchSettingsEqual,
		normalizeMatchSettings,
		saveMatchSettings,
		type MatchSettings
	} from '#lib/game/match-config';
	import {
		STRUCTURE_ACCENTS,
		STRUCTURE_DEFINITIONS,
		type BuildableStructureType,
		type PublicCard
	} from '#lib/game/Structures';
	import { GameCameraBridge, type CameraView } from '#lib/game/render/camera-bridge';
	import type { RendererFrameStats } from '#lib/game/render/territory-renderer';

	interface HoverState {
		x: number;
		y: number;
		owner: number;
		land: boolean;
		elevation: number;
		baseDefense: number;
		auraDefense: number;
		defense: number;
	}

	let sim = $state<WorkerLocalSimulation | null>(null);
	let snapshot = $state<GameSnapshot | null>(null);
	let workerVisuals = $state<
		Array<{
			revision: number;
			tick: number;
			snapshot: GameSnapshot;
			changes: Uint32Array;
			changeCount: number;
			overflow: boolean;
			districtTiles: number[];
		}>
	>([]);
	let workerVisualRevision = 0;
	let lastWorkerUiTick = -100;
	let workerTelemetryVersion = $state(0);
	const gameSession = new GameSession({
		onReady: handleSessionReady,
		onVisual: handleWorkerVisual,
		onTelemetry: () => workerTelemetryVersion++,
		onError: handleError
	});
	let phase = $state<'loading' | 'ready' | 'error'>('loading');
	let errorMessage = $state('');
	let rendererReady = $state(false);
	let gameStarted = $state(false);
	let paused = $state(true);
	let showIntro = $state(true);
	let showHelp = $state(false);
	type OnboardingStep = 1 | 2 | 3;
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
	let settingsDirty = $derived(
		appliedMatchSettings !== null && !matchSettingsEqual(matchSettings, appliedMatchSettings)
	);
	let stateCount = $derived(sim?.playerCount ?? matchSettings.states);
	let mapWidth = $derived(sim?.width ?? matchSettings.mapWidth);
	let mapHeight = $derived(sim?.height ?? matchSettings.mapHeight);
	let keyboardCursor = $state<{ x: number; y: number } | null>(null);
	let keyboardCursorScreen = $derived.by(() => {
		if (!keyboardCursor || !cameraView) return null;
		return {
			x:
				cameraView.viewportWidth / 2 +
				(keyboardCursor.x + 0.5 - cameraView.centerX) * cameraView.scale,
			y:
				cameraView.viewportHeight / 2 +
				(keyboardCursor.y + 0.5 - cameraView.centerY) * cameraView.scale
		};
	});
	let keyboardCursorStatus = $derived.by(() => {
		if (!keyboardCursor || !sim || !snapshot) return '';
		const { x, y } = keyboardCursor;
		const ownerId = sim.getOwner(x, y);
		const owner = snapshot.players.find((player) => player.id === ownerId);
		const defense = sim.getDefense(x, y);
		const action = keyboardCursorAllied
			? 'Allied territory; Enter is disabled'
			: artilleryTargeting
				? 'Enter fires artillery'
				: ownerId === HUMAN_PLAYER_ID && sim.getDistrictStructureId(x, y)
					? 'Enter upgrades'
					: 'Enter attacks';
		return `Cursor ${x}, ${y}. ${owner ? owner.name : 'Unclaimed land'}. Defense ${defense}. ${action}.`;
	});
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

	const RANK_ROW_HEIGHT = 28;
	const RANK_OVERSCAN = 3;

	const cameraBridge = new GameCameraBridge();
	cameraBridge.onView = (view) => {
		cameraView = view;
		if (!structureMenu) return;
		// Reports arrive on an interval even when nothing moved, so only a real
		// camera change (pan/zoom/fit/keyboard recentre) dismisses the menu.
		if (!structureMenuCameraView) {
			structureMenuCameraView = view;
			return;
		}
		if (!cameraViewsEqual(structureMenuCameraView, view)) closeStructureMenu();
	};

	let humanFronts = $derived(
		snapshot?.attacks.filter((attack) => attack.attackerId === HUMAN_PLAYER_ID) ?? []
	);
	let humanAllyName = $derived.by(() => {
		if (!snapshot) return null;
		const alliance = snapshot.alliances.find(
			(entry) => entry.playerA === HUMAN_PLAYER_ID || entry.playerB === HUMAN_PLAYER_ID
		);
		if (!alliance) return null;
		const allyId = alliance.playerA === HUMAN_PLAYER_ID ? alliance.playerB : alliance.playerA;
		return snapshot.players[allyId - 1]?.name ?? `STATE ${allyId}`;
	});
	let humanAlliancePending = $derived(
		snapshot?.allianceProposals.some(
			(proposal) =>
				proposal.fromPlayerId === HUMAN_PLAYER_ID || proposal.toPlayerId === HUMAN_PLAYER_ID
		) ?? false
	);
	let hoverIsAlly = $derived.by(() => {
		if (!snapshot || !hover?.land || hover.owner <= 0 || hover.owner === snapshot.humanId) {
			return false;
		}
		return snapshot.alliances.some(
			(alliance) =>
				(alliance.playerA === snapshot?.humanId && alliance.playerB === hover?.owner) ||
				(alliance.playerB === snapshot?.humanId && alliance.playerA === hover?.owner)
		);
	});
	let keyboardCursorAllied = $derived.by(() => {
		if (!keyboardCursor || !sim || !snapshot) return false;
		const ownerId = sim.getOwner(keyboardCursor.x, keyboardCursor.y);
		if (ownerId <= 0 || ownerId === snapshot.humanId) return false;
		return snapshot.alliances.some(
			(alliance) =>
				(alliance.playerA === snapshot?.humanId && alliance.playerB === ownerId) ||
				(alliance.playerB === snapshot?.humanId && alliance.playerA === ownerId)
		);
	});
	let diplomacyToast = $state<{ message: string; tone: 'success' | 'warn' | 'error' } | null>(null);
	let diplomacyToastTimer: ReturnType<typeof setTimeout> | null = null;

	function showDiplomacyToast(
		message: string,
		tone: 'success' | 'warn' | 'error' = 'success'
	): void {
		diplomacyToast = { message, tone };
		if (diplomacyToastTimer) clearTimeout(diplomacyToastTimer);
		diplomacyToastTimer = setTimeout(() => {
			diplomacyToast = null;
			diplomacyToastTimer = null;
		}, 3400);
	}

	function diplomacyRemaining(expiresAtTick: number | null): string {
		if (expiresAtTick === null) return '';
		const ticks = Math.max(0, expiresAtTick - (snapshot?.tick ?? 0));
		const seconds = Math.ceil(ticks / TICK_RATE);
		return seconds >= 60
			? `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
			: `${seconds}s`;
	}
	let humanArtillery = $derived(
		snapshot?.structures.filter(
			(structure) => structure.type === 'artillery' && structure.ownerId === HUMAN_PLAYER_ID
		) ?? []
	);
	let readyArtillery = $derived(
		humanArtillery.filter((structure) => structure.readyAtTick <= (snapshot?.tick ?? 0))
	);
	let readyArtilleryShells = $derived(
		readyArtillery.reduce((total, structure) => total + structure.stacks, 0)
	);
	let artilleryVolleyCost = $derived(readyArtilleryShells * ARTILLERY_SUPPLY_COST_PER_LEVEL);
	let artilleryTargeting = $state(false);
	const actions = createActions({
		get sim() {
			return sim;
		},
		get snapshot() {
			return snapshot;
		},
		get paused() {
			return paused;
		},
		get gameStarted() {
			return gameStarted;
		},
		get showIntro() {
			return showIntro;
		},
		get defeatOpen() {
			return defeatOpen;
		},
		get artilleryTargeting() {
			return artilleryTargeting;
		},
		get keyboardPlacement() {
			return keyboardPlacement;
		},
		get shiftHeld() {
			return shiftHeld;
		},
		get ctrlHeld() {
			return ctrlHeld;
		},
		get humanArtillery() {
			return humanArtillery;
		},
		get readyArtillery() {
			return readyArtillery;
		},
		get artilleryVolleyCost() {
			return artilleryVolleyCost;
		},
		get onboardingStep() {
			return onboardingStep;
		},
		setArtilleryTargeting(value) {
			artilleryTargeting = value;
		},
		showToast,
		advanceOnboarding,
		finishOnboarding,
		buildKeyboardPlacement,
		session: gameSession
	});
	const keyboard = createKeyboardInput({
		get sim() {
			return sim;
		},
		get cameraView() {
			return cameraView;
		},
		get keyboardCursor() {
			return keyboardCursor;
		},
		get keyboardCursorAllied() {
			return keyboardCursorAllied;
		},
		get keyboardPlacement() {
			return keyboardPlacement;
		},
		get structureMenu() {
			return structureMenu;
		},
		get artilleryTargeting() {
			return artilleryTargeting;
		},
		get showHelp() {
			return showHelp;
		},
		get defeatOpen() {
			return defeatOpen;
		},
		get showIntro() {
			return showIntro;
		},
		get showResult() {
			return showResult;
		},
		get canDeploy() {
			return canDeploy;
		},
		setKeyboardCursor(cursor) {
			keyboardCursor = cursor;
		},
		setArtilleryTargeting(value) {
			artilleryTargeting = value;
		},
		setShowHelp(value) {
			showHelp = value;
		},
		setShiftHeld(value) {
			shiftHeld = value;
		},
		setCtrlHeld(value) {
			ctrlHeld = value;
		},
		cancelKeyboardPlacement,
		beginKeyboardPlacement,
		togglePause,
		deploy,
		handleStructureMenuKey,
		showDiplomacyToast,
		camera: cameraBridge,
		actions
	});
	let supplyPreview: { label: string; cost: number; affordable: boolean } | null = $derived.by(
		() => {
			if (
				!sim ||
				!snapshot ||
				!hover?.land ||
				!gameStarted ||
				showIntro ||
				defeatOpen ||
				snapshot.ended ||
				paused
			) {
				return null;
			}
			const x = Math.floor(hover.x);
			const y = Math.floor(hover.y);
			if (artilleryTargeting) {
				const barrage = sim.validateArtillery(HUMAN_PLAYER_ID, x, y);
				if (!barrage.ok && barrage.reason !== 'no-supply') return null;
				return {
					label: 'ARTILLERY',
					cost: artilleryVolleyCost,
					affordable: snapshot.supply >= artilleryVolleyCost
				};
			}
			if (hover.owner === HUMAN_PLAYER_ID) {
				if (sim.getDistrictStructureId(x, y) === 0) return null;
				const levels = shiftHeld ? 5 : 1;
				const quote = sim.getUpgradeQuote(HUMAN_PLAYER_ID, x, y, levels, !ctrlHeld);
				if (quote.currentLevel === 0) return null;
				return {
					label: quote.merged
						? levels === 5
							? 'MERGED ×5'
							: 'MERGED'
						: levels === 5
							? 'UPGRADE ×5'
							: 'UPGRADE',
					cost: quote.cost,
					affordable: quote.ok
				};
			}
			const attack = sim.validateAttack(HUMAN_PLAYER_ID, x, y);
			if (!attack.ok && attack.reason !== 'no-orders') return null;
			const cost = sim.getAttackStats(HUMAN_PLAYER_ID, hover.owner).cost;
			return {
				label: 'FRONT',
				cost,
				affordable: snapshot.supply >= cost
			};
		}
	);

	let supplyBar = $derived.by(() => {
		const cap = Math.max(1, snapshot?.supplyCap ?? 1);
		const supply = snapshot?.supply ?? 0;
		const fill = Math.max(0, Math.min(100, (supply / cap) * 100));
		const cost = supplyPreview?.cost ?? 0;
		const costWidth = Math.min(fill, (cost / cap) * 100);
		return { cap, supply, fill, costWidth, costStart: fill - costWidth };
	});

	let upgradeTooltip = $derived.by(() => {
		if (
			!sim ||
			!snapshot ||
			!hover?.land ||
			!pointerScreen ||
			!gameStarted ||
			showIntro ||
			showHelp ||
			defeatOpen ||
			snapshot.ended ||
			draggingCardId !== null ||
			artilleryTargeting
		) {
			return null;
		}
		const x = hover.x;
		const y = hover.y;
		if (sim.getOwner(x, y) !== HUMAN_PLAYER_ID) return null;
		if (sim.getDistrictStructureId(x, y) === 0) return null;
		const levels = shiftHeld ? 5 : 1;
		const quote = sim.getUpgradeQuote(HUMAN_PLAYER_ID, x, y, levels, !ctrlHeld);
		if (quote.currentLevel === 0) return null;
		return {
			x: pointerScreen.x,
			y: pointerScreen.y,
			levels: quote.levels,
			cost: quote.cost,
			currentLevel: quote.currentLevel,
			projectedLevel: quote.projectedLevel,
			merged: quote.merged,
			structureCount: quote.structureCount,
			ok: quote.ok
		};
	});
	let human = $derived.by(() => {
		if (!snapshot) return null;
		const humanId = snapshot.humanId;
		return snapshot.players.find((player) => player.id === humanId) ?? null;
	});
	let humanStructure = $derived(
		snapshot && human
			? (snapshot.structures.find((structure) => structure.ownerId === human.id) ?? null)
			: null
	);
	let ranked = $derived(
		snapshot
			? [...snapshot.players].sort(
					(a, b) => Number(b.alive) - Number(a.alive) || b.territory - a.territory || a.id - b.id
				)
			: []
	);
	let humanRank = $derived(human ? ranked.findIndex((p) => p.id === human.id) + 1 : 0);
	let rankWindow = $derived.by(() => {
		const start = Math.max(0, Math.floor(rankScrollTop / RANK_ROW_HEIGHT) - RANK_OVERSCAN);
		const visibleRows = Math.ceil(rankViewportHeight / RANK_ROW_HEIGHT) + RANK_OVERSCAN * 2;
		return {
			start,
			end: Math.min(ranked.length, start + visibleRows)
		};
	});
	let visibleRanked = $derived(ranked.slice(rankWindow.start, rankWindow.end));
	let aliveCount = $derived(snapshot ? snapshot.players.filter((p) => p.alive).length : 0);
	let worldClaim = $derived(
		snapshot && snapshot.landCount > 0 ? (snapshot.claimedLand / snapshot.landCount) * 100 : 0
	);
	let winner = $derived(
		snapshot?.winnerId
			? (snapshot.players.find((player) => player.id === snapshot?.winnerId) ?? null)
			: null
	);
	let showResult = $derived(Boolean(gameStarted && snapshot?.ended));
	let aiPostMatch = $derived.by(() => {
		void snapshot;
		void workerTelemetryVersion;
		return sim?.getBotBehaviorTelemetry() ?? null;
	});
	let aiOptionSummary = $derived.by(() => {
		void snapshot;
		if (!aiPostMatch) return '—';
		return Object.entries(aiPostMatch.optionSelections)
			.sort((left, right) => right[1] - left[1])
			.slice(0, 3)
			.map(([id, count]) => `${id} ${count}`)
			.join(' / ');
	});
	let seedHex = $derived(currentSeed.toString(16).toUpperCase().padStart(8, '0'));
	let canDeploy = $derived(phase === 'ready' && rendererReady && sim !== null && !settingsDirty);
	let deployLabel = $derived(
		settingsDirty
			? 'APPLY MATCH SETUP FIRST'
			: canDeploy
				? 'DEPLOY COMMANDER'
				: 'INITIALISING WEBGPU…'
	);
	let onboardingVisible = $derived(
		onboardingStep !== null &&
			gameStarted &&
			!showIntro &&
			!showHelp &&
			!defeatOpen &&
			!paused &&
			snapshot?.ended !== true
	);
	let onboardingCopy = $derived.by(() => {
		switch (onboardingStep) {
			case 1:
				return {
					index: '01 / 03',
					title: 'OPEN A FRONT',
					body: 'Click any land pixel touching your border. One click buys a front; repeated clicks create separate fronts.'
				};
			case 2:
				return {
					index: '02 / 03',
					title: 'BUILD SOMETHING',
					body: 'Drag a card into your territory, or press its number key then left-click the map. Right-click cancels placement.'
				};
			case 3:
				return {
					index: '03 / 03',
					title: 'UPGRADE A DISTRICT',
					body: 'Click anywhere inside one of your built districts to raise its structure. Each level costs more supply.'
				};
			default:
				return null;
		}
	});
	let matchClock = $derived(formatClock((snapshot?.tick ?? 0) / TICK_RATE));
	let matchTimeRemaining = $derived(
		sim && sim.matchDurationTicks > 0
			? formatClock(Math.max(0, (sim.matchDurationTicks - (snapshot?.tick ?? 0)) / TICK_RATE))
			: null
	);
	let draggingCard = $derived(
		draggingCardId === null
			? null
			: (snapshot?.hand.find((card) => card.id === draggingCardId) ?? null)
	);
	let dragAccent = $derived(draggingCard ? STRUCTURE_ACCENTS[draggingCard.type] : '#f7eed0');
	let dragArrow = $derived.by(() => {
		if (!dragOrigin || !dragPointer) return null;
		const startX = dragOrigin.x;
		const startY = dragOrigin.y;
		const endX = dragPointer.x;
		const endY = dragPointer.y;
		const dx = endX - startX;
		const dy = endY - startY;
		const length = Math.max(1, Math.hypot(dx, dy));
		const bend = Math.min(95, Math.max(34, length * 0.2));
		const midX = (startX + endX) / 2;
		const midY = (startY + endY) / 2;
		const controlX = midX + (-dy / length) * bend;
		const controlY = midY + (dx / length) * bend;
		const angle = Math.atan2(endY - controlY, endX - controlX);
		const head = 13;
		const left = angle + Math.PI * 0.82;
		const right = angle - Math.PI * 0.82;
		return {
			path: `M ${startX} ${startY} Q ${controlX} ${controlY} ${endX} ${endY}`,
			head: `M ${endX} ${endY} L ${endX + Math.cos(left) * head} ${
				endY + Math.sin(left) * head
			} L ${endX + Math.cos(right) * head} ${endY + Math.sin(right) * head} Z`
		};
	});
	let scaleLegend = $derived(
		cameraView ? `${Math.round(100 / cameraView.scale)} px / 100 px` : '—'
	);

	function beginOnboarding(): void {
		if (onboardingDone) return;
		onboardingStep = 1;
	}

	function advanceOnboarding(from: OnboardingStep, to: OnboardingStep): void {
		if (onboardingStep === from) onboardingStep = to;
	}

	function finishOnboarding(): void {
		onboardingDone = true;
		onboardingStep = null;
		saveOnboardingDone();
	}

	function persistMatchSettings(): void {
		saveMatchSettings(matchSettings);
	}

	function applyMapPreset(): void {
		const preset = mapPreset(matchSettings.mapPreset);
		matchSettings = {
			...matchSettings,
			mapWidth: preset.width,
			mapHeight: preset.height
		};
		persistMatchSettings();
	}

	function applyMatchSettings(): void {
		persistMatchSettings();
		createWorld(currentSeed || readSeedFromLocation(), matchSettings);
	}

	function applySeedPreset(seed: number): void {
		persistMatchSettings();
		createWorld(seed >>> 0, matchSettings);
	}

	function createWorld(seed: number, settings: MatchSettings = matchSettings): void {
		const normalized = normalizeMatchSettings(settings);
		matchSettings = { ...normalized };
		appliedMatchSettings = { ...normalized };
		phase = 'loading';
		errorMessage = '';
		rendererReady = false;
		artilleryTargeting = false;
		sim = null;
		snapshot = null;
		workerVisuals = [];
		workerVisualRevision = 0;
		lastWorkerUiTick = -100;
		gameStarted = false;
		showIntro = true;
		showHelp = false;
		defeatOpen = false;
		defeatHandled = false;
		paused = true;
		hover = null;
		closeStructureMenu();
		cameraView = null;
		rankScrollTop = 0;
		handRaised = true;
		clearDragState();
		eventFeed = [];
		currentSeed = seed >>> 0;
		seedInput = seedHexFor(seed);
		gameSession.start(seed, normalized);
	}

	function deploy(): void {
		if (!canDeploy) return;
		showIntro = false;
		gameStarted = true;
		artilleryTargeting = false;
		paused = false;
		gameSession.resume();
		beginOnboarding();
	}

	function togglePause(): void {
		if (!gameStarted || showResult || defeatOpen) return;
		paused = !paused;
		if (paused) gameSession.pause();
		else gameSession.resume();
	}

	function newWorld(): void {
		createWorld(randomSeed());
	}

	function rematch(): void {
		createWorld(currentSeed);
	}

	async function copySeed(): Promise<void> {
		try {
			await navigator.clipboard.writeText(String(currentSeed));
			showToast(`Seed ${currentSeed} copied.`, 'success');
		} catch {
			showToast(`Seed: ${currentSeed}`, 'warn');
		}
	}

	function applySeed(): void {
		const parsed = parseSeed(seedInput);
		if (parsed === null) {
			showToast('Seed must be 1–8 hexadecimal characters.', 'warn');
			return;
		}
		if (parsed === currentSeed && phase === 'ready') {
			showToast('That world is already loaded.', 'warn');
			return;
		}
		createWorld(parsed);
	}

	/**
	 * The floating last-action box was removed. Keep this as a no-op sink for
	 * existing command feedback paths until they get inline HUD treatment.
	 */
	function showToast(_message: string, _tone: 'success' | 'error' | 'warn' = 'success'): void {}

	function handleSessionReady(next: WorkerLocalSimulation, seed: number): void {
		sim = next;
		snapshot = next.getSnapshot();
		phase = 'ready';
		const url = new URL(window.location.href);
		url.searchParams.set('seed', String(seed >>> 0));
		void goto(url, { replace: true, reset: false, state: {} });
	}

	function handleWorkerVisual(visual: LocalWorkerVisual): void {
		if (!sim) return;
		workerVisualRevision++;
		workerVisuals = [
			...workerVisuals,
			{
				revision: workerVisualRevision,
				tick: visual.tick,
				snapshot: visual.snapshot,
				changes: visual.changes,
				changeCount: visual.changes.length,
				overflow: visual.changesOverflow,
				districtTiles: visual.districtTiles
			}
		].slice(-8);
		if (visual.tick - lastWorkerUiTick >= 2 || visual.events.length > 0 || visual.snapshot.ended) {
			lastWorkerUiTick = visual.tick;
			handleTick(visual.snapshot, visual.events);
		}
	}

	function acknowledgeWorkerVisuals(lastRevision: number): void {
		workerVisuals = workerVisuals.filter((visual) => visual.revision > lastRevision);
	}

	function handleTick(next: GameSnapshot, events: SimEvent[]): void {
		const previous = snapshot;
		snapshot = next;

		const important = events.filter((event) => event.kind !== 'system');
		if (previous && next.humanId > 0) {
			const hadActive = previous.alliances.some(
				(alliance) => alliance.playerA === next.humanId || alliance.playerB === next.humanId
			);
			const hasActive = next.alliances.some(
				(alliance) => alliance.playerA === next.humanId || alliance.playerB === next.humanId
			);
			const hadPending = previous.allianceProposals.some(
				(proposal) => proposal.fromPlayerId === next.humanId || proposal.toPlayerId === next.humanId
			);
			const hasPending = next.allianceProposals.some(
				(proposal) => proposal.fromPlayerId === next.humanId || proposal.toPlayerId === next.humanId
			);
			if (!hadActive && hasActive) {
				showDiplomacyToast('Alliance formed. Allied territory is now protected.', 'success');
			} else if (hadPending && !hasPending && !hasActive) {
				const declined = important.some(
					(event) => event.kind === 'alliance' && event.message.includes('declined')
				);
				showDiplomacyToast(
					declined ? 'Alliance request declined.' : 'Alliance request expired.',
					'warn'
				);
			} else if (hadActive && !hasActive) {
				const broke = important.some(
					(event) => event.kind === 'alliance' && event.message.includes('broke')
				);
				if (!broke) showDiplomacyToast('Alliance expired.', 'warn');
			}
		}
		if (important.length > 0) {
			eventFeed = [...important, ...eventFeed].slice(0, 4);
		}
		if (
			gameStarted &&
			events.some((event) => event.kind === 'structure' && event.playerId === next.humanId)
		) {
			showToast(
				'Your State structure was destroyed. Territory is no longer protected from annexation.',
				'error'
			);
		}

		if (!gameStarted) return;
		const humanState = next.players.find((player) => player.id === next.humanId);
		if (!humanState?.alive && !defeatHandled && !next.ended) {
			defeatHandled = true;
			defeatOpen = true;
			paused = true;
			gameSession.pause();
		}
		if (next.ended) {
			paused = true;
			defeatOpen = false;
		}
	}

	function handleHover(next: HoverState | null): void {
		hover = next;
	}

	function handleReady(): void {
		rendererReady = true;
	}

	function handleError(error: Error): void {
		errorMessage = error.message;
		phase = 'error';
		paused = true;
	}

	function handlePerf(stats: RendererFrameStats): void {
		perf = stats;
	}

	function navigateFromMinimap(x: number, y: number): void {
		cameraBridge.centerOn(x, y, Math.max(2.2, cameraView?.zoom ?? 2.2));
	}

	function handleRankScroll(event: Event): void {
		rankScrollTop = (event.currentTarget as HTMLElement).scrollTop;
	}

	function clearDragState(): void {
		draggingCardId = null;
		keyboardPlacement = false;
		dragOrigin = null;
		dragPointer = null;
		dragLanding = null;
	}

	function dragLandingAt(clientX: number, clientY: number, card: PublicCard) {
		if (!sim || !cameraView) return null;
		const mapX =
			cameraView.centerX +
			(clientX - cameraView.viewportWidth / 2) / Math.max(0.0001, cameraView.scale);
		const mapY =
			cameraView.centerY +
			(clientY - cameraView.viewportHeight / 2) / Math.max(0.0001, cameraView.scale);
		const cellX = Math.floor(mapX);
		const cellY = Math.floor(mapY);
		const validation = sim.validateBuild(HUMAN_PLAYER_ID, card.id, cellX, cellY);
		const targetX = validation.targetX ?? cellX;
		const targetY = validation.targetY ?? cellY;
		return {
			x: cameraView.viewportWidth / 2 + (targetX + 0.5 - cameraView.centerX) * cameraView.scale,
			y: cameraView.viewportHeight / 2 + (targetY + 0.5 - cameraView.centerY) * cameraView.scale,
			radius: STRUCTURE_MIN_SPACING * cameraView.scale,
			ok: validation.ok
		};
	}

	function beginKeyboardPlacement(index: number): void {
		if (!snapshot || !gameStarted || showIntro || showResult || defeatOpen || showHelp) return;
		const card = snapshot.hand[index];
		if (!card) return;
		if (artilleryTargeting) artilleryTargeting = false;
		keyboardPlacement = true;
		draggingCardId = card.id;
		const element = document.querySelector<HTMLElement>(`[data-card-id="${card.id}"]`);
		const rect = element?.getBoundingClientRect();
		dragOrigin = rect
			? { x: rect.left + rect.width / 2, y: rect.top + 28 }
			: { x: window.innerWidth / 2, y: window.innerHeight - 120 };
		const pointer = pointerScreen ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 };
		dragPointer = pointer;
		dragLanding = dragLandingAt(pointer.x, pointer.y, card);
		handRaised = true;
	}

	function cancelKeyboardPlacement(notify = true): void {
		if (!keyboardPlacement) return;
		clearDragState();
		handRaised = false;
		if (notify) showToast('Build cancelled.', 'warn');
	}

	async function buildKeyboardPlacement(x: number, y: number): Promise<void> {
		if (!sim || !snapshot || !draggingCard) return;
		if (paused || defeatOpen || snapshot.ended) {
			showToast('Resume the simulation before building.', 'warn');
			return;
		}
		const result = await gameSession.command('build', {
			cardId: draggingCard.id,
			x: Math.floor(x),
			y: Math.floor(y)
		});
		showToast(result.message, result.ok ? 'success' : 'error');
		if (result.ok) {
			advanceOnboarding(2, 3);
			clearDragState();
		}
	}

	function structureAtScreen(clientX: number, clientY: number) {
		if (!snapshot || !cameraView) return null;
		let best: GameSnapshot['structures'][number] | null = null;
		let bestDistance = 16 * 16;
		for (const structure of snapshot.structures) {
			const screenX =
				cameraView.viewportWidth / 2 + (structure.x + 0.5 - cameraView.centerX) * cameraView.scale;
			const screenY =
				cameraView.viewportHeight / 2 + (structure.y + 0.5 - cameraView.centerY) * cameraView.scale;
			const dx = clientX - screenX;
			const dy = clientY - screenY;
			const distance = dx * dx + dy * dy;
			if (distance > bestDistance) continue;
			best = structure;
			bestDistance = distance;
		}
		return best;
	}

	function ownerAtScreen(clientX: number, clientY: number): number {
		if (!sim || !cameraView) return 0;
		const mapX =
			cameraView.centerX +
			(clientX - cameraView.viewportWidth / 2) / Math.max(0.0001, cameraView.scale);
		const mapY =
			cameraView.centerY +
			(clientY - cameraView.viewportHeight / 2) / Math.max(0.0001, cameraView.scale);
		return sim.getOwner(Math.floor(mapX), Math.floor(mapY));
	}

	function cameraViewsEqual(a: CameraView, b: CameraView): boolean {
		return (
			a.centerX === b.centerX &&
			a.centerY === b.centerY &&
			a.zoom === b.zoom &&
			a.scale === b.scale &&
			a.viewportWidth === b.viewportWidth &&
			a.viewportHeight === b.viewportHeight
		);
	}

	function menuItemButtons(): HTMLButtonElement[] {
		return contextMenuItemButtons(contextMenuEl);
	}

	function focusMenuItem(index = 0): void {
		focusContextMenuItem(contextMenuEl, index);
	}

	function moveMenuFocus(delta: 1 | -1): void {
		moveContextMenuFocus(contextMenuEl, delta);
	}

	function handleStructureMenuKey(event: KeyboardEvent): void {
		handleContextMenuKey(event, contextMenuEl, closeStructureMenu);
	}

	function clampStructureMenuToViewport(): void {
		const menu = structureMenu;
		const element = contextMenuEl;
		if (!menu || !element) return;
		structureMenu = clampContextMenu(menu, element, window.innerWidth, window.innerHeight);
	}

	function focusMenuAfterRender(index = 0): void {
		void tick().then(() => {
			if (!structureMenu) return;
			clampStructureMenuToViewport();
			focusMenuItem(index);
		});
	}

	function handleContextMenu(event: MouseEvent): void {
		event.preventDefault();
		const target = event.target as HTMLElement;
		if (target.closest('.context-menu')) return;
		cancelKeyboardPlacement();
		closeStructureMenu();
		if (target.closest('.hud, .card-tray, button')) return;
		if (
			!sim ||
			!snapshot ||
			!cameraView ||
			showIntro ||
			!gameStarted ||
			showResult ||
			defeatOpen ||
			showHelp
		) {
			return;
		}
		const structure = structureAtScreen(event.clientX, event.clientY);
		const ownerId = structure?.ownerId ?? ownerAtScreen(event.clientX, event.clientY);
		const menu = buildStructureMenu({
			snapshot,
			structure,
			ownerId,
			clientX: event.clientX,
			clientY: event.clientY,
			viewportWidth: window.innerWidth,
			viewportHeight: window.innerHeight
		});
		if (!menu) return;
		structureMenu = menu;
		structureMenuCameraView = cameraView;
		focusMenuAfterRender(0);
	}

	function closeStructureMenu(): void {
		structureMenu = null;
		structureMenuCameraView = null;
	}

	function handleWindowPointerDown(event: PointerEvent): void {
		if (!structureMenu) return;
		if ((event.target as HTMLElement).closest('.context-menu')) return;
		closeStructureMenu();
	}

	function requestDemolish(): void {
		const menu = structureMenu;
		if (!menu || menu.structureId === null || !menu.isOwn || menu.isState) return;
		if (paused) {
			showToast('Resume the simulation before demolishing.', 'warn');
			return;
		}
		structureMenu = { ...menu, confirmingDemolish: true };
		focusMenuAfterRender(0);
	}

	function cancelDemolishConfirm(): void {
		const menu = structureMenu;
		if (!menu) return;
		structureMenu = { ...menu, confirmingDemolish: false };
		focusMenuAfterRender(0);
	}

	async function demolishStructure(): Promise<void> {
		const menu = structureMenu;
		if (!menu || !menu.confirmingDemolish) return;
		closeStructureMenu();
		if (!sim || menu.structureId === null || !menu.isOwn || menu.isState) return;
		if (paused) {
			showToast('Resume the simulation before demolishing.', 'warn');
			return;
		}
		const result = await gameSession.command('demolish', { structureId: menu.structureId });
		showToast(result.message, result.ok ? 'success' : 'error');
	}

	async function requestAlliance(): Promise<void> {
		const menu = structureMenu;
		closeStructureMenu();
		if (!menu || !sim || menu.allianceOwnerId === null || menu.allianceStatus !== 'none') return;
		if (paused) {
			showToast('Resume the simulation before requesting an alliance.', 'warn');
			return;
		}
		const result = await gameSession.command('alliance-request', {
			targetPlayerId: menu.allianceOwnerId
		});
		showDiplomacyToast(result.message, result.ok ? 'success' : 'error');
	}

	async function breakAlliance(): Promise<void> {
		const menu = structureMenu;
		closeStructureMenu();
		if (!menu || !sim || menu.allianceOwnerId === null || menu.allianceStatus !== 'active') {
			return;
		}
		if (paused) {
			showToast('Resume the simulation before breaking an alliance.', 'warn');
			return;
		}
		const result = await gameSession.command('alliance-break', {
			targetPlayerId: menu.allianceOwnerId
		});
		showDiplomacyToast(result.message, result.ok ? 'success' : 'error');
	}

	function transparentDragSource(): HTMLCanvasElement {
		if (!transparentDragImage) {
			transparentDragImage = document.createElement('canvas');
			transparentDragImage.width = 1;
			transparentDragImage.height = 1;
		}
		return transparentDragImage;
	}

	async function startCardDrag(event: DragEvent, card: PublicCard): Promise<void> {
		keyboardPlacement = false;
		draggingCardId = card.id;
		const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
		dragOrigin = { x: rect.left + rect.width / 2, y: rect.top + 28 };
		dragPointer = { x: event.clientX, y: event.clientY };
		dragLanding = null;
		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = 'move';
			event.dataTransfer.setData('text/plain', String(card.id));
			event.dataTransfer.setDragImage(transparentDragSource(), 0, 0);
		}
	}

	function endCardDrag(): void {
		clearDragState();
	}

	function updateDragHover(event: DragEvent): void {
		if (draggingCardId === null) return;
		dragPointer = { x: event.clientX, y: event.clientY };
		if (!sim || !snapshot || !cameraView || !draggingCard) {
			dragLanding = null;
			return;
		}
		if ((event.target as HTMLElement).closest('.card-tray')) {
			dragLanding = null;
			return;
		}
		dragLanding = dragLandingAt(event.clientX, event.clientY, draggingCard);
	}

	function handleDragOver(event: DragEvent): void {
		if (draggingCardId === null) return;
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
		updateDragHover(event);
	}

	async function handleCardDrop(event: DragEvent): Promise<void> {
		event.preventDefault();
		const rawCardId = event.dataTransfer?.getData('text/plain');
		const cardId = rawCardId ? Number(rawCardId) : draggingCardId;
		clearDragState();
		if (!sim || !snapshot || !gameStarted || !cameraView || cardId === null) return;
		if (paused || defeatOpen || snapshot.ended) {
			showToast('Resume the simulation before building.', 'warn');
			return;
		}

		if ((event.target as HTMLElement).closest('.card-tray')) return;
		const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
		const screenX = event.clientX - rect.left;
		const screenY = event.clientY - rect.top;
		const mapX =
			cameraView.centerX +
			(screenX - cameraView.viewportWidth / 2) / Math.max(0.0001, cameraView.scale);
		const mapY =
			cameraView.centerY +
			(screenY - cameraView.viewportHeight / 2) / Math.max(0.0001, cameraView.scale);

		const result = await gameSession.command('build', {
			cardId,
			x: Math.floor(mapX),
			y: Math.floor(mapY)
		});
		showToast(result.message, result.ok ? 'success' : 'error');
		if (result.ok) advanceOnboarding(2, 3);
	}

	function handleWindowPointerMove(event: PointerEvent): void {
		pointerScreen = { x: event.clientX, y: event.clientY };
		shiftHeld = event.shiftKey;
		ctrlHeld = event.ctrlKey;
		if (!gameStarted || showIntro) return;
		if (keyboardPlacement) {
			if (draggingCard) {
				dragPointer = { x: event.clientX, y: event.clientY };
				dragLanding = dragLandingAt(event.clientX, event.clientY, draggingCard);
			}
			handRaised = true;
			return;
		}
		if (draggingCardId !== null) {
			handRaised = true;
			return;
		}
		const shell = handShellEl;
		if (!shell) return;
		const rect = shell.getBoundingClientRect();
		// When collapsed, only the peeking strip should reopen the hand; the
		// invisible layout box above it must not become a map dead zone.
		const hitTop = handRaised ? rect.top : rect.bottom - 38;
		handRaised =
			event.clientX >= rect.left &&
			event.clientX <= rect.right &&
			event.clientY >= hitTop &&
			event.clientY <= rect.bottom;
	}

	$effect(() => {
		const element = rankScrollEl;
		if (!element) return;

		rankViewportHeight = element.clientHeight;
		const observer = new ResizeObserver(() => {
			rankViewportHeight = element.clientHeight;
		});
		observer.observe(element);
		return () => observer.disconnect();
	});

	function spectate(): void {
		defeatOpen = false;
		paused = false;
		gameSession.resume();
	}

	function reload(): void {
		window.location.reload();
	}

	onMount(() => {
		window.addEventListener('keydown', keyboard.handleKeydown);
		window.addEventListener('keyup', keyboard.handleKeyup);
		window.addEventListener('pointermove', handleWindowPointerMove);
		window.addEventListener('pointerdown', handleWindowPointerDown);
		onboardingDone = loadOnboardingDone();
		matchSettings = loadMatchSettings();
		createWorld(readSeedFromLocation(), matchSettings);

		return () => {
			window.removeEventListener('keydown', keyboard.handleKeydown);
			window.removeEventListener('keyup', keyboard.handleKeyup);
			window.removeEventListener('pointermove', handleWindowPointerMove);
			window.removeEventListener('pointerdown', handleWindowPointerDown);
			if (diplomacyToastTimer) clearTimeout(diplomacyToastTimer);
			gameSession.dispose();
			cameraBridge.onView = undefined;
		};
	});
</script>

<svelte:head>
	<title>TERRITORY — Frontage v1</title>
</svelte:head>

<main
	class="game-shell"
	ondragover={handleDragOver}
	ondrop={handleCardDrop}
	oncontextmenu={handleContextMenu}
>
	{#if diplomacyToast}
		<DiplomacyToast message={diplomacyToast.message} tone={diplomacyToast.tone} />
	{/if}
	{#if upgradeTooltip}
		<UpgradeTooltip tooltip={upgradeTooltip} />
	{/if}
	{#if structureMenu}
		<StructureMenu
			bind:menuElement={contextMenuEl}
			menu={structureMenu}
			{paused}
			{diplomacyRemaining}
			onRequestDemolish={requestDemolish}
			onCancelDemolish={cancelDemolishConfirm}
			onConfirmDemolish={demolishStructure}
			onRequestAlliance={requestAlliance}
			onBreakAlliance={breakAlliance}
			onClose={closeStructureMenu}
		/>
	{/if}
	{#if sim}
		{#key sim}
			<GameCanvas
				simulation={sim}
				{paused}
				simulate={false}
				remoteVisuals={workerVisuals}
				onRemoteVisualsApplied={acknowledgeWorkerVisuals}
				targeting={artilleryTargeting}
				allyTarget={hoverIsAlly}
				mergeDistricts={!ctrlHeld}
				highlightType={draggingCard?.type ?? null}
				{cameraBridge}
				onTick={handleTick}
				onHover={handleHover}
				onAttack={actions.handleAttack}
				onReady={handleReady}
				onError={handleError}
				onPerf={handlePerf}
			/>
			{#if keyboardCursorScreen && keyboardCursor}
				<KeyboardCursor
					position={keyboardCursorScreen}
					allied={keyboardCursorAllied}
					status={keyboardCursorStatus}
				/>
			{/if}
		{/key}
	{/if}

	<div class="map-atmosphere" aria-hidden="true"></div>

	{#if gameStarted && !showIntro && phase === 'ready' && sim && snapshot && human}
		<GameTopBar
			{human}
			humanStructure={Boolean(humanStructure)}
			humanAllyName={humanAllyName ?? null}
			humanAlliancePending={Boolean(humanAlliancePending)}
			{humanRank}
			{aliveCount}
			{stateCount}
			{matchClock}
			{matchTimeRemaining}
			{paused}
			{showResult}
			onTogglePause={togglePause}
			onOpenHelp={() => (showHelp = true)}
			onOnline={() => goto('/online')}
			onEvolution={() => goto('/evolution')}
			onNewWorld={newWorld}
		/>

		{#if onboardingVisible && onboardingCopy}
			<OnboardingHint copy={onboardingCopy} onSkip={finishOnboarding} />
		{/if}

		<WorldRail
			{snapshot}
			{human}
			{ranked}
			{visibleRanked}
			{rankWindow}
			rankRowHeight={RANK_ROW_HEIGHT}
			bind:rankScrollElement={rankScrollEl}
			{worldClaim}
			{aliveCount}
			{seedHex}
			{eventFeed}
			onRankScroll={handleRankScroll}
		/>

		<div class="minimap-dock hud">
			<Minimap simulation={sim} {snapshot} {cameraView} onNavigate={navigateFromMinimap} />
			<div class="minimap-meta">
				<span>ATLAS / {mapWidth} × {mapHeight}</span>
				<span>{scaleLegend}</span>
			</div>
		</div>

		<MapTools
			{perf}
			onZoomIn={() => cameraBridge.zoomIn()}
			onZoomOut={() => cameraBridge.zoomOut()}
			onFit={() => cameraBridge.fitMap()}
			onFocus={() => cameraBridge.focusHuman()}
		/>

		<SupplyPanel
			{snapshot}
			{supplyBar}
			{supplyPreview}
			{humanFronts}
			{humanArtillery}
			{readyArtillery}
			{readyArtilleryShells}
			{artilleryVolleyCost}
			{artilleryTargeting}
			onCancelFront={actions.cancelLatestFront}
			onToggleArtillery={actions.toggleArtilleryTargeting}
		/>
		<CardTray
			{snapshot}
			{handRaised}
			bind:handShellElement={handShellEl}
			{draggingCardId}
			onStartDrag={startCardDrag}
			onDrag={updateDragHover}
			onDragEnd={endCardDrag}
			onRaise={() => (handRaised = true)}
		/>
		{#if draggingCardId !== null && dragOrigin && dragPointer && dragArrow}
			<DragOverlay
				origin={dragOrigin}
				landing={dragLanding}
				arrow={dragArrow}
				accent={dragAccent}
			/>
		{/if}
		{#if paused && !showResult}
			<div class="paused-flag hud">SIMULATION PAUSED <span>SPACE TO RESUME</span></div>
		{/if}
	{/if}

	{#if phase === 'loading'}
		<LoadingOverlay {mapWidth} {mapHeight} {stateCount} />
	{/if}

	{#if showIntro && phase === 'ready' && snapshot}
		<IntroOverlay
			{phase}
			{stateCount}
			{mapWidth}
			{mapHeight}
			{seedHex}
			{rendererReady}
			{canDeploy}
			{deployLabel}
			bind:seedInput
			bind:matchSettings
			{settingsDirty}
			onDeploy={deploy}
			onApplySeed={applySeed}
			onPersistSettings={persistMatchSettings}
			onApplyMapPreset={applyMapPreset}
			onApplySeedPreset={applySeedPreset}
			onApplyMatchSettings={applyMatchSettings}
		/>
	{/if}
	{#if phase === 'error'}
		<ErrorModal message={errorMessage} onReload={reload} />
	{/if}

	{#if showResult && snapshot}
		<ResultModal
			humanId={snapshot.humanId}
			{winner}
			{humanRank}
			{worldClaim}
			{matchClock}
			{seedHex}
			{ranked}
			{aiPostMatch}
			{aiOptionSummary}
			onRematch={rematch}
			onCopySeed={copySeed}
			onNewWorld={newWorld}
			onOpenHelp={() => (showHelp = true)}
		/>
	{/if}

	{#if defeatOpen && !showResult && human && snapshot}
		<DefeatModal
			{human}
			tick={snapshot.tick}
			{matchClock}
			{humanRank}
			{aliveCount}
			onSpectate={spectate}
			onRematch={rematch}
			onNewWorld={newWorld}
		/>
	{/if}

	{#if showHelp}
		<HelpOverlay {stateCount} {mapWidth} {mapHeight} onClose={() => (showHelp = false)} />
	{/if}
</main>
