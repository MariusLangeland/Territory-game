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
				<div
					class="keyboard-cursor"
					class:allied={keyboardCursorAllied}
					style:left={`${keyboardCursorScreen.x}px`}
					style:top={`${keyboardCursorScreen.y}px`}
					aria-hidden="true"
				>
					<span></span>
				</div>
				<p class="visually-hidden" aria-live="polite">{keyboardCursorStatus}</p>
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
			<aside class="onboarding-hint hud" aria-live="polite">
				<div class="onboarding-meta">
					<span>FIRST MATCH / {onboardingCopy.index}</span>
					<button type="button" onclick={finishOnboarding} aria-label="Skip first-match hints">
						SKIP
					</button>
				</div>
				<h2>{onboardingCopy.title}</h2>
				<p>{onboardingCopy.body}</p>
			</aside>
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

		<div class="map-tools hud" aria-label="Map controls">
			<div class="tool-stack">
				<button type="button" onclick={() => cameraBridge.zoomIn()} aria-label="Zoom in">+</button>
				<button type="button" onclick={() => cameraBridge.zoomOut()} aria-label="Zoom out">
					−
				</button>
			</div>
			<button
				class="tool-wide"
				type="button"
				onclick={() => cameraBridge.fitMap()}
				aria-label="Fit entire map"
			>
				FIT
			</button>
			<button
				class="tool-wide"
				type="button"
				onclick={() => cameraBridge.focusHuman()}
				aria-label="Center on your territory"
			>
				FOCUS
			</button>
			<div class="perf-readout">
				<span>{perf.fps} FPS</span>
				<span>{formatCompact(perf.uploadedPixels)} PX/S</span>
				<span>{perf.uploadCalls} CALLS/S</span>
			</div>
		</div>

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
			<svg class="drag-overlay" aria-hidden="true">
				{#if dragLanding}
					<g class:blocked={!dragLanding.ok} class:valid={dragLanding.ok}>
						<circle
							cx={dragLanding.x}
							cy={dragLanding.y}
							r={dragLanding.radius}
							class="drag-landing-field"
						/>
						<circle
							cx={dragLanding.x}
							cy={dragLanding.y}
							r={dragLanding.radius}
							class="drag-landing-ring"
						/>
						<circle cx={dragLanding.x} cy={dragLanding.y} r="3.5" class="drag-landing-dot" />
					</g>
				{/if}
				<path d={dragArrow.path} class="drag-arrow-path" style={`--drag-accent:${dragAccent}`} />
				<path d={dragArrow.head} class="drag-arrow-head" style={`--drag-accent:${dragAccent}`} />
				<circle
					cx={dragOrigin.x}
					cy={dragOrigin.y}
					r="4"
					class="drag-arrow-origin"
					style={`--drag-accent:${dragAccent}`}
				/>
			</svg>
		{/if}

		{#if paused && !showResult}
			<div class="paused-flag hud">SIMULATION PAUSED <span>SPACE TO RESUME</span></div>
		{/if}
	{/if}

	{#if phase === 'loading'}
		<div class="overlay loading-overlay" role="status" aria-live="polite">
			<div class="loader-mark" aria-hidden="true"><span></span><span></span><span></span></div>
			<p class="overlay-kicker">CARTOGRAPHY IN PROGRESS</p>
			<h2>SURVEYING THE<br />FRONTIER.</h2>
			<p class="loading-copy">
				Generating {mapWidth.toLocaleString('en-US')} × {mapHeight.toLocaleString('en-US')} terrain cells
				and deploying {stateCount} states.
			</p>
		</div>
	{/if}

	{#if showIntro && phase === 'ready' && snapshot}
		<div
			class="overlay intro-overlay"
			role="dialog"
			aria-modal="true"
			aria-labelledby="intro-title"
		>
			<div class="intro-rail">
				<span>LAT 61.22 N</span>
				<span>LON 08.44 E</span>
				<span>WORLD {seedHex}</span>
			</div>

			<div class="intro-content">
				<div class="intro-copy">
					<p class="overlay-kicker">
						<span class="kicker-line"></span>FRONTAGE SYSTEM / SUPPLY WAR
					</p>
					<h2 id="intro-title">DRAW THE<br /><em>FRONTIER.</em></h2>
					<p class="intro-lede">
						Durable fronts spend supply, strength, and terrain defense against
						{stateCount} deterministic states fighting over the same pixel atlas.
					</p>

					<div class="spec-strip">
						<div><strong>{mapWidth} × {mapHeight}</strong><span>PIXEL ATLAS</span></div>
						<div><strong>{TICK_RATE} HZ</strong><span>FIXED SIMULATION</span></div>
						<div><strong>WEBGPU</strong><span>DIRTY-TILE RENDER</span></div>
						<div><strong>{stateCount}</strong><span>STATES DEPLOYED</span></div>
					</div>

					<div class="intro-actions">
						<button class="deploy-button" type="button" onclick={deploy} disabled={!canDeploy}>
							<span>{deployLabel}</span>
							<svg viewBox="0 0 16 16" aria-hidden="true">
								<path d="M2 8h11M9 3.5 13.5 8 9 12.5" />
							</svg>
						</button>
						<div class="seed-loader">
							<label for="seed-input">WORLD SEED / HEX</label>
							<div>
								<input
									id="seed-input"
									bind:value={seedInput}
									spellcheck="false"
									autocomplete="off"
									maxlength="10"
									inputmode="text"
								/>
								<button type="button" onclick={applySeed} disabled={!rendererReady}>LOAD</button>
							</div>
						</div>
					</div>

					<p class="intro-footnote">
						Frontage prototype: {stateCount - 1} AI states fight for 70% of the land while you build with
						a single supply economy. Fronts cost supply, trade strength on contact, and can be cancelled.
						Share a seed to replay the same test.
					</p>
				</div>

				<aside class="intro-brief">
					<div class="brief-head">
						<span>FIELD BRIEF / 01</span>
						<span class="brief-status"><i></i>{rendererReady ? 'READY' : 'LINKING'}</span>
					</div>
					<h3>SUPPLY IS<br />THE ONLY VERB.</h3>
					<ol>
						<li>
							<span>01</span>
							<p>Click any land touching your frontier to buy a front with supply.</p>
						</li>
						<li>
							<span>02</span>
							<p>
								Each front buys durable strength. Barracks add attack strength and logarithmic speed
								and piercing; fronts spend strength on captures and mutual attrition.
							</p>
						</li>
						<li>
							<span>03</span>
							<p>Take 70% of the land to win. Build cards and terrain defense shape the front.</p>
						</li>
					</ol>
					<div class="match-setup">
						<div class="setup-head">
							<span>MATCH SETUP</span>
							<span class:dirty={settingsDirty}>{settingsDirty ? 'CHANGED' : 'READY'}</span>
						</div>
						<label>
							<span>STATES</span>
							<select bind:value={matchSettings.states} onchange={persistMatchSettings}>
								{#each STATE_COUNT_OPTIONS as count (count)}
									<option value={count}>{count} STATES</option>
								{/each}
							</select>
						</label>
						<label>
							<span>MAP SIZE</span>
							<select bind:value={matchSettings.mapPreset} onchange={applyMapPreset}>
								{#each MAP_PRESETS as preset (preset.id)}
									<option value={preset.id}>{preset.label}</option>
								{/each}
							</select>
						</label>
						<label>
							<span>WIDTH</span>
							<input
								type="number"
								min="512"
								max="8192"
								step="16"
								bind:value={matchSettings.mapWidth}
								onchange={persistMatchSettings}
							/>
						</label>
						<label>
							<span>HEIGHT</span>
							<input
								type="number"
								min="256"
								max="8192"
								step="16"
								bind:value={matchSettings.mapHeight}
								onchange={persistMatchSettings}
							/>
						</label>
						<label>
							<span>BOT DIFFICULTY</span>
							<select bind:value={matchSettings.difficulty} onchange={persistMatchSettings}>
								{#each BOT_DIFFICULTY_OPTIONS as option (option.id)}
									<option value={option.id}>{option.label}</option>
								{/each}
							</select>
						</label>
						<label>
							<span>MATCH TIMER</span>
							<select bind:value={matchSettings.timerMinutes} onchange={persistMatchSettings}>
								{#each TIMER_OPTIONS as minutes (minutes)}
									<option value={minutes}>{minutes === 0 ? 'NO TIMER' : `${minutes} MIN`}</option>
								{/each}
							</select>
						</label>
						<label>
							<span>BOT COMMAND POSTS</span>
							<select
								bind:value={matchSettings.botCommandPostStacks}
								onchange={persistMatchSettings}
								title="Grants every AI commander a starting Command Post with this many stacks"
							>
								{#each BOT_COMMAND_POST_STACK_OPTIONS as stacks (stacks)}
									<option value={stacks}>
										{stacks === 0 ? 'STANDARD' : `${stacks}-STACK SURGE`}
									</option>
								{/each}
							</select>
						</label>
						<div class="seed-presets">
							<span>QUICK SEED</span>
							<div>
								<button type="button" onclick={() => applySeedPreset(1234)}>1234</button>
								<button type="button" onclick={() => applySeedPreset(0xbeef)}>BEEF</button>
								<button type="button" onclick={() => applySeedPreset(randomSeed())}>RANDOM</button>
							</div>
						</div>
						<p class="setup-victory">
							VICTORY: 70% OF LAND, LAST STATE STANDING{matchSettings.timerMinutes > 0
								? ', OR TIMER LEADER'
								: ''}
						</p>
						<button
							class="setup-apply"
							type="button"
							onclick={applyMatchSettings}
							disabled={!settingsDirty && phase === 'ready'}
						>
							{settingsDirty ? 'REBUILD MATCH' : 'SETTINGS APPLIED'}
						</button>
					</div>
					<div class="brief-footer">
						<span>MAP SEED</span>
						<strong>{seedHex}</strong>
					</div>
				</aside>
			</div>

			<div class="intro-footbar">
				<span>BUILD {__APP_VERSION__} / PROTOCOL 38</span>
				<span>WEBGPU RENDERER REQUIRED</span>
				<span>DRAG TO PAN · SCROLL TO ZOOM</span>
			</div>
		</div>
	{/if}

	{#if phase === 'error'}
		<div
			class="overlay error-overlay"
			role="alertdialog"
			aria-modal="true"
			aria-labelledby="error-title"
		>
			<article class="modal error-modal">
				<p class="overlay-kicker">RENDERER OFFLINE</p>
				<h2 id="error-title">WEBGPU<br /><em>UNAVAILABLE.</em></h2>
				<p>
					This prototype draws its territory map directly with WebGPU. The browser could not start a
					compatible graphics device.
				</p>
				<pre>{errorMessage}</pre>
				<p class="error-hint">
					Try a current Chromium-based browser with hardware acceleration enabled, or check <a
						href="https://caniuse.com/webgpu"
						target="_blank"
						rel="noreferrer"
					>
						WebGPU support
					</a>.
				</p>
				<div class="modal-actions">
					<button class="deploy-button" type="button" onclick={reload}><span>RELOAD</span></button>
				</div>
			</article>
		</div>
	{/if}

	{#if showResult && snapshot}
		<div
			class="overlay result-overlay"
			role="dialog"
			aria-modal="true"
			aria-labelledby="result-title"
		>
			<article class="modal result-modal">
				<p class="overlay-kicker">
					{winner?.id === snapshot.humanId
						? 'CAMPAIGN COMPLETE / VICTORY'
						: 'CAMPAIGN COMPLETE / DEFEAT'}
				</p>
				<h2 id="result-title">
					{#if winner?.id === snapshot.humanId}
						THE ATLAS<br /><em>IS YOURS.</em>
					{:else}
						{winner?.name ?? 'A RIVAL'}<br /><em>TAKES THE WORLD.</em>
					{/if}
				</h2>
				<p class="result-lede">
					{#if winner?.id === snapshot.humanId}
						You hold 70% of the land. The frontier is closed.
					{:else}
						Your command has ended. The map remembers who held the last pixel.
					{/if}
				</p>

				<div class="result-stats">
					<div><span>WAR CLOCK</span><strong>{matchClock}</strong></div>
					<div><span>WORLD CLAIMED</span><strong>{worldClaim.toFixed(1)}%</strong></div>
					<div><span>COMMANDER RANK</span><strong>#{humanRank || '—'}</strong></div>
					<div><span>SEED</span><strong>{seedHex}</strong></div>
				</div>

				{#if aiPostMatch}
					<div class="result-ai">
						<div>
							<span>AI FORTS UNDER THREAT</span><strong>
								{aiPostMatch.threatenedFortificationBuilds} built / {aiPostMatch.threatenedFortificationUpgrades}
								upgraded
							</strong>
						</div>
						<div>
							<span>DETERRENCE POSTURES</span><strong>{aiPostMatch.deterrencePostures}</strong>
						</div>
						<div>
							<span>INCOME-GAP CP / WA</span><strong>
								{aiPostMatch.incomeGapCommandPosts} / {aiPostMatch.incomeGapWarAcademies}
							</strong>
						</div>
						<div>
							<span>SUPPLY OPPORTUNITIES</span><strong>{aiPostMatch.opportunityAttacks}</strong>
						</div>
						<div>
							<span>BOT PORTS / LANDINGS</span><strong>
								{aiPostMatch.botPortBuilds} / {aiPostMatch.botNavalLandings}
							</strong>
						</div>
						<div>
							<span>STRATEGIC OPTIONS</span><strong>{aiOptionSummary}</strong>
						</div>
					</div>
				{/if}

				<ol class="result-standings">
					{#each ranked.slice(0, 4) as player, index (player.id)}
						<li
							class:is-human={player.id === snapshot.humanId}
							style={`--player-color:${colorForPlayer(player.id).hex}`}
						>
							<span>{String(index + 1).padStart(2, '0')}</span>
							<i></i>
							<b>{player.name}</b>
							<em>{(player.landShare * 100).toFixed(1)}%</em>
						</li>
					{/each}
				</ol>

				<div class="modal-actions">
					<button class="deploy-button" type="button" onclick={rematch}>
						<span>REMATCH SAME SEED</span>
					</button>
					<button class="ghost-button" type="button" onclick={copySeed}>COPY SEED</button>
					<button class="ghost-button" type="button" onclick={newWorld}>NEW WORLD</button>
					<button class="ghost-button" type="button" onclick={() => (showHelp = true)}>
						FIELD MANUAL
					</button>
				</div>
			</article>
		</div>
	{/if}

	{#if defeatOpen && !showResult && human && snapshot}
		<div
			class="overlay result-overlay defeat-overlay"
			role="dialog"
			aria-modal="true"
			aria-labelledby="defeat-title"
		>
			<article class="modal result-modal defeat-modal">
				<p class="overlay-kicker">STATE TERMINATED / NO TERRITORY</p>
				<h2 id="defeat-title">YOUR FLAG<br /><em>FALLS.</em></h2>
				<p class="result-lede">
					{human.name} no longer holds a single pixel. The simulation is paused at tick {snapshot.tick}.
				</p>
				<div class="result-stats">
					<div><span>SURVIVED</span><strong>{matchClock}</strong></div>
					<div><span>FINAL RANK</span><strong>#{humanRank}</strong></div>
					<div>
						<span>WORLD CLAIMED</span><strong>{(human.landShare * 100).toFixed(1)}%</strong>
					</div>
					<div><span>ALIVE STATES</span><strong>{aliveCount}</strong></div>
				</div>
				<div class="modal-actions">
					<button class="deploy-button" type="button" onclick={spectate}>
						<span>SPECTATE THE END</span>
					</button>
					<button class="ghost-button" type="button" onclick={rematch}>REMATCH</button>
					<button class="ghost-button" type="button" onclick={newWorld}>NEW WORLD</button>
				</div>
			</article>
		</div>
	{/if}

	{#if showHelp}
		<div class="overlay help-overlay" role="dialog" aria-modal="true" aria-labelledby="help-title">
			<article class="modal help-modal">
				<header class="help-head">
					<div>
						<p class="overlay-kicker">FIELD MANUAL / FRONTAGE V1</p>
						<h2 id="help-title">HOW TO<br /><em>ATTACK.</em></h2>
					</div>
					<button
						class="square-button close-manual"
						type="button"
						onclick={() => (showHelp = false)}
						aria-label="Close field manual"
					>
						×
					</button>
				</header>

				<div class="manual-grid">
					<section>
						<span class="manual-index">01 / THE MODEL</span>
						<h3>One supply. Durable fronts.</h3>
						<p>
							Supply is the only resource. It accrues from territory and structures, pays for cards,
							upgrades, and front launches, and has no global maximum; territory and War Academies
							raise the cap. Command Posts add supply income; Artillery is an active siege
							structure. Fortifications add district defense. Jammers project a global aura that
							subtracts one effective Barracks level from every enemy attacking you, without raising
							pixel defense. Cards are permanent. Click a district, or drop its matching card inside
							it, to upgrade; cost is the card price plus 5 × current level. Shift-click queues five
							upgrades atomically, and the cursor tooltip shows the total cost. Each capture spends
							both per-tick power and durable strength. Hold 70% of the land to win immediately.
						</p>
					</section>
					<section>
						<span class="manual-index">02 / FRONTS</span>
						<h3>Buy strength. Cancel for a refund.</h3>
						<p>
							Click neutral ground or a rival's border near your territory to launch a front. A
							launch costs 30 supply plus 15 per effective Barracks level. Barracks add attack
							strength linearly, while speed and defense piercing grow by floor(log2(levels + 1)) —
							infinite scaling with diminishing returns. Repeated clicks create separate fronts.
							When mutual fronts touch, both sides lose strength simultaneously; a front at zero
							dies and the survivor holds the contact line. Use CANCEL LAST or press X to refund the
							remaining strength share. Each State structure anchors its mainland and adds 20
							defense. Artillery costs 1000 supply, needs 16 px of district-free ground, and covers
							a 64 px district. <kbd>A</kbd> or FIRE, then click an aim point in range. Each level fires
							one inaccurate shell at 300 supply per level; shells damage structures but cannot destroy
							a State.
						</p>
					</section>
					<section>
						<span class="manual-index">03 / CAMERA</span>
						<h3>Read the whole atlas.</h3>
						<p>
							Drag to pan, scroll to zoom at the pointer, or use <kbd>F</kbd> to fit the world and
							<kbd>C</kbd> to return to your frontier. Click the minimap to jump anywhere. On touch,
							pinch with two fingers. Arrow keys move a keyboard cursor; <kbd>Enter</kbd>
							attacks or upgrades under it, <kbd>Shift</kbd> moves faster, and <kbd>Esc</kbd> clears it.
						</p>
					</section>
					<section>
						<span class="manual-index">04 / STRESS TEST</span>
						<h3>{stateCount} states, one tick.</h3>
						<p>
							{TICK_RATE} fixed ticks per second, {stateCount - 1} free-attacking AI states, and a seeded
							PRNG. The {(mapWidth * mapHeight).toLocaleString('en-US')} pixel atlas is rendered from
							a GPU control texture with only dirty tiles uploaded. Every second, land cut off from every
							live State structure is annexed by an adjacent protected mainland with the largest shared
							border. Capture a State structure to remove that state's annexation protection.
						</p>
					</section>
				</div>

				<div class="manual-footer">
					<span><kbd>SPACE</kbd> PAUSE / RESUME</span>
					<span><kbd>1</kbd>–<kbd>7</kbd> PLACE CARD · LMB BUILD · RMB CANCEL</span>
					<span><kbd>+</kbd> <kbd>−</kbd> ZOOM</span>
					<span><kbd>H</kbd> FIELD MANUAL</span>
					<span>WEBGPU / DETERMINISTIC CORE</span>
				</div>
			</article>
		</div>
	{/if}
</main>
