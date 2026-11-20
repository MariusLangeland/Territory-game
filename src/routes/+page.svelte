<script lang="ts">
	import { onMount } from 'svelte';
	import { flip } from 'svelte/animate';
	import { fly } from 'svelte/transition';
	import { goto } from '$app/navigation';
	import GameCanvas from '#lib/components/GameCanvas.svelte';
	import { formatSupply } from '#lib/format';
	import Minimap from '#lib/components/Minimap.svelte';
	import {
		ARTILLERY_SUPPLY_COST_PER_LEVEL,
		ELEVATION_NAMES,
		HUMAN_PLAYER_ID,
		MAP_HEIGHT,
		MAP_WIDTH,
		PLAYER_COUNT,
		STRUCTURE_MIN_SPACING,
		TICK_RATE,
		colorForPlayer
	} from '#lib/game/constants';
	import {
		DEFAULT_GROWTH_MODE,
		GROWTH_DESCRIPTIONS,
		GROWTH_LABELS,
		GROWTH_MODES,
		type GrowthMode
	} from '#lib/game/growth';
	import { TerritorySimulation, type GameSnapshot, type SimEvent } from '#lib/game/simulation';
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

	interface Toast {
		id: number;
		message: string;
		tone: 'success' | 'error' | 'warn';
	}

	let sim = $state<TerritorySimulation | null>(null);
	let snapshot = $state<GameSnapshot | null>(null);
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
	let pointerScreen = $state<{ x: number; y: number } | null>(null);
	let shiftHeld = $state(false);
	let cameraView = $state<CameraView | null>(null);
	let perf = $state<RendererFrameStats>({
		fps: 0,
		uploadedPixels: 0,
		uploadCalls: 0,
		frames: 0
	});
	let eventFeed = $state<SimEvent[]>([]);
	let toast = $state<Toast | null>(null);
	let currentSeed = $state(0);
	let seedInput = $state('');
	let rankScrollEl = $state<HTMLDivElement | null>(null);
	let rankScrollTop = $state(0);
	let rankViewportHeight = $state(360);
	let handRaised = $state(true);
	let handShellEl = $state<HTMLDivElement | null>(null);
	let growthMode = $state<GrowthMode>(DEFAULT_GROWTH_MODE);
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
		const action = artilleryTargeting
			? 'Enter fires artillery'
			: ownerId === HUMAN_PLAYER_ID && sim.getDistrictStructureId(x, y)
				? 'Enter upgrades'
				: 'Enter attacks';
		return `Cursor ${x}, ${y}. ${owner ? owner.name : 'Unclaimed land'}. Defense ${defense}. ${action}.`;
	});
	let draggingCardId = $state<number | null>(null);
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

	let toastTimer: ReturnType<typeof setTimeout> | undefined;
	let worldTimer: ReturnType<typeof setTimeout> | undefined;
	let toastSequence = 0;

	const cameraBridge = new GameCameraBridge();
	cameraBridge.onView = (view) => {
		cameraView = view;
	};

	let humanFronts = $derived(
		snapshot?.attacks.filter((attack) => attack.attackerId === HUMAN_PLAYER_ID) ?? []
	);
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
		const quote = sim.getUpgradeQuote(HUMAN_PLAYER_ID, x, y, levels);
		if (quote.currentLevel === 0) return null;
		return {
			x: pointerScreen.x,
			y: pointerScreen.y,
			levels: quote.levels,
			cost: quote.cost,
			currentLevel: quote.currentLevel,
			projectedLevel: quote.projectedLevel,
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
	let seedHex = $derived(currentSeed.toString(16).toUpperCase().padStart(8, '0'));
	let canDeploy = $derived(phase === 'ready' && rendererReady && sim !== null);
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
					body: 'Drag one of the five cards from the bottom hand into your territory. Cards stay in hand and can be bought again.'
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

	function formatCompact(value: number): string {
		if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
		if (value >= 10_000) return `${Math.round(value / 1000)}K`;
		if (value >= 1_000) return `${(value / 1000).toFixed(1)}K`;
		return String(Math.max(0, Math.round(value)));
	}

	function formatShare(share: number): string {
		const percent = share * 100;
		return percent >= 10 ? percent.toFixed(1) : percent.toFixed(2);
	}

	function formatClock(totalSeconds: number): string {
		const seconds = Math.max(0, Math.floor(totalSeconds));
		return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
	}

	const ONBOARDING_KEY = 'territory.onboarding.v1';

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
		try {
			window.localStorage.setItem(ONBOARDING_KEY, 'done');
		} catch {
			// Storage can be unavailable in private/sandboxed contexts; the
			// current match still gets the hints, they just reappear next time.
		}
	}

	function randomSeed(): number {
		if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
			const buffer = new Uint32Array(1);
			crypto.getRandomValues(buffer);
			return buffer[0] || 1;
		}
		return (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0 || 1;
	}

	function parseSeed(raw: string): number | null {
		const cleaned = raw.trim().replace(/^0x/i, '');
		if (!/^[0-9a-f]{1,8}$/i.test(cleaned)) return null;
		return Number.parseInt(cleaned, 16) >>> 0;
	}

	function readSeedFromLocation(): number {
		try {
			const raw = new URLSearchParams(window.location.search).get('seed');
			if (raw) {
				const parsed = Number.parseInt(raw, 10);
				if (Number.isFinite(parsed) && parsed >= 0) return parsed >>> 0;
				const hex = parseSeed(raw);
				if (hex !== null) return hex;
			}
		} catch {
			// URL parsing is best-effort; a random world is a valid fallback.
		}
		return randomSeed();
	}

	function createWorld(seed: number): void {
		clearTimeout(worldTimer);
		phase = 'loading';
		errorMessage = '';
		rendererReady = false;
		artilleryTargeting = false;
		sim = null;
		snapshot = null;
		gameStarted = false;
		showIntro = true;
		showHelp = false;
		defeatOpen = false;
		defeatHandled = false;
		paused = true;
		hover = null;
		cameraView = null;
		rankScrollTop = 0;
		handRaised = true;
		growthMode = DEFAULT_GROWTH_MODE;
		clearDragState();
		eventFeed = [];
		toast = null;
		currentSeed = seed >>> 0;
		seedInput = seedHexFor(seed);
		clearTimeout(toastTimer);

		// Yield once so the loading screen paints before the CPU builds the map.
		worldTimer = setTimeout(() => {
			try {
				const next = new TerritorySimulation({ seed: seed >>> 0 });
				sim = next;
				snapshot = next.getSnapshot();
				phase = 'ready';
				const url = new URL(window.location.href);
				url.searchParams.set('seed', String(seed >>> 0));
				void goto(url, { replace: true, reset: false, state: {} });
			} catch (error) {
				errorMessage = error instanceof Error ? error.message : String(error);
				phase = 'error';
			}
		}, 40);
	}

	function seedHexFor(seed: number): string {
		return (seed >>> 0).toString(16).toUpperCase().padStart(8, '0');
	}

	function deploy(): void {
		if (!canDeploy) return;
		showIntro = false;
		gameStarted = true;
		artilleryTargeting = false;
		paused = false;
		beginOnboarding();
	}

	function togglePause(): void {
		if (!gameStarted || showResult || defeatOpen) return;
		paused = !paused;
	}

	function newWorld(): void {
		createWorld(randomSeed());
	}

	function rematch(): void {
		createWorld(currentSeed);
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

	function showToast(message: string, tone: Toast['tone'] = 'success'): void {
		clearTimeout(toastTimer);
		toast = { id: ++toastSequence, message, tone };
		toastTimer = setTimeout(() => {
			toast = null;
		}, 2800);
	}

	function handleTick(next: GameSnapshot, events: SimEvent[]): void {
		snapshot = next;
		growthMode = next.growthMode;

		const important = events.filter((event) => event.kind !== 'system');
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
		}
		if (next.ended) {
			paused = true;
			defeatOpen = false;
		}
	}

	function handleAttack(x: number, y: number): void {
		if (!sim || !snapshot || !gameStarted || showIntro) return;
		if (snapshot.ended || defeatOpen) return;
		if (paused) {
			showToast('Simulation paused. Resume to fire.', 'warn');
			return;
		}
		if (artilleryTargeting) {
			const barrage = sim.enqueueArtillery(HUMAN_PLAYER_ID, x, y);
			showToast(
				barrage.ok ? 'Artillery barrage queued.' : barrage.message,
				barrage.ok ? 'success' : 'error'
			);
			if (barrage.ok) artilleryTargeting = false;
			return;
		}
		if (
			sim.getOwner(Math.floor(x), Math.floor(y)) === HUMAN_PLAYER_ID &&
			sim.getDistrictStructureId(Math.floor(x), Math.floor(y)) !== 0
		) {
			const upgrade = sim.upgradeDistrict(HUMAN_PLAYER_ID, x, y, shiftHeld ? 5 : 1);
			showToast(upgrade.message, upgrade.ok ? 'success' : 'error');
			if (upgrade.ok && onboardingStep === 3) finishOnboarding();
			return;
		}
		const result = sim.enqueueAttack(HUMAN_PLAYER_ID, x, y);
		showToast(result.message, result.ok ? 'success' : 'error');
		if (result.ok) advanceOnboarding(1, 2);
	}

	function toggleArtilleryTargeting(): void {
		if (!sim || !snapshot || snapshot.ended) return;
		if (humanArtillery.length === 0) {
			showToast('Build an Artillery card first.', 'warn');
			return;
		}
		if (!artilleryTargeting && readyArtillery.length === 0) {
			showToast('All artillery is reloading.', 'warn');
			return;
		}
		if (!artilleryTargeting && snapshot.supply < artilleryVolleyCost) {
			showToast(`Need ${artilleryVolleyCost} supply to fire this volley.`, 'warn');
			return;
		}
		artilleryTargeting = !artilleryTargeting;
		showToast(
			artilleryTargeting
				? 'Artillery selected. Click a hostile structure or aim point in range.'
				: 'Artillery targeting cancelled.',
			artilleryTargeting ? 'success' : 'warn'
		);
	}

	function cancelLatestFront(): void {
		if (!sim) return;
		const result = sim.cancelLatestAttack(HUMAN_PLAYER_ID);
		showToast(result.message, result.ok ? 'success' : 'warn');
		snapshot = sim.getSnapshot();
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

	function selectGrowthMode(mode: GrowthMode): void {
		if (!sim) return;
		growthMode = mode;
		sim.setGrowthMode(mode);
		showToast(`${GROWTH_LABELS[mode]} growth selected for new fronts.`, 'success');
	}

	function cardDefinition(card: PublicCard) {
		return STRUCTURE_DEFINITIONS[card.type];
	}

	function cardCategory(type: BuildableStructureType): string {
		switch (type) {
			case 'artillery':
				return 'SIEGE';
			case 'barracks':
				return 'MILITARY';
			case 'fortification':
				return 'FORTIFICATION';
			case 'jammer':
				return 'SUPPRESSION';
			case 'command-post':
				return 'COMMAND';
			case 'war-academy':
				return 'DOCTRINE';
		}
	}

	function clearDragState(): void {
		draggingCardId = null;
		dragOrigin = null;
		dragPointer = null;
		dragLanding = null;
	}

	function transparentDragSource(): HTMLCanvasElement {
		if (!transparentDragImage) {
			transparentDragImage = document.createElement('canvas');
			transparentDragImage.width = 1;
			transparentDragImage.height = 1;
		}
		return transparentDragImage;
	}

	function startCardDrag(event: DragEvent, card: PublicCard): void {
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

		const mapX =
			cameraView.centerX +
			(event.clientX - cameraView.viewportWidth / 2) / Math.max(0.0001, cameraView.scale);
		const mapY =
			cameraView.centerY +
			(event.clientY - cameraView.viewportHeight / 2) / Math.max(0.0001, cameraView.scale);
		const cellX = Math.floor(mapX);
		const cellY = Math.floor(mapY);
		const validation = sim.validateBuild(HUMAN_PLAYER_ID, draggingCard.id, cellX, cellY);
		dragLanding = {
			x: cameraView.viewportWidth / 2 + (cellX + 0.5 - cameraView.centerX) * cameraView.scale,
			y: cameraView.viewportHeight / 2 + (cellY + 0.5 - cameraView.centerY) * cameraView.scale,
			radius: STRUCTURE_MIN_SPACING * cameraView.scale,
			ok: validation.ok
		};
	}

	function handleDragOver(event: DragEvent): void {
		if (draggingCardId === null) return;
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
		updateDragHover(event);
	}

	function handleCardDrop(event: DragEvent): void {
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

		const result = sim.playCard(HUMAN_PLAYER_ID, cardId, Math.floor(mapX), Math.floor(mapY));
		showToast(result.message, result.ok ? 'success' : 'error');
		if (result.ok) advanceOnboarding(2, 3);
	}

	function handleWindowPointerMove(event: PointerEvent): void {
		pointerScreen = { x: event.clientX, y: event.clientY };
		shiftHeld = event.shiftKey;
		if (!gameStarted || showIntro) return;
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
	}

	function reload(): void {
		window.location.reload();
	}

	function ensureKeyboardCursor(): { x: number; y: number } | null {
		if (!sim) return null;
		if (keyboardCursor) return keyboardCursor;
		const start = sim.map.starts[HUMAN_PLAYER_ID - 1];
		keyboardCursor = start ? { x: start.x, y: start.y } : null;
		return keyboardCursor;
	}

	function moveKeyboardCursor(dx: number, dy: number, fast: boolean): void {
		if (!sim || !cameraView) return;
		const cursor = ensureKeyboardCursor();
		if (!cursor) return;
		const step = Math.max(1, Math.round(6 / Math.max(0.2, cameraView.scale))) * (fast ? 3 : 1);
		const next = {
			x: Math.max(0, Math.min(sim.width - 1, cursor.x + dx * step)),
			y: Math.max(0, Math.min(sim.height - 1, cursor.y + dy * step))
		};
		keyboardCursor = next;

		const screenX =
			cameraView.viewportWidth / 2 + (next.x + 0.5 - cameraView.centerX) * cameraView.scale;
		const screenY =
			cameraView.viewportHeight / 2 + (next.y + 0.5 - cameraView.centerY) * cameraView.scale;
		if (
			screenX < 70 ||
			screenY < 70 ||
			screenX > cameraView.viewportWidth - 70 ||
			screenY > cameraView.viewportHeight - 70
		) {
			cameraBridge.centerOn(next.x, next.y);
		}
	}

	function activateKeyboardCursor(): void {
		const cursor = ensureKeyboardCursor();
		if (!cursor) return;
		handleAttack(cursor.x, cursor.y);
	}

	function handleKeyup(event: KeyboardEvent): void {
		if (event.key === 'Shift') shiftHeld = false;
	}

	function handleKeydown(event: KeyboardEvent): void {
		shiftHeld = event.shiftKey;
		const target = event.target as HTMLElement | null;
		if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;

		if (event.key === 'Escape') {
			if (artilleryTargeting) artilleryTargeting = false;
			else if (keyboardCursor) keyboardCursor = null;
			else if (showHelp) showHelp = false;
			else if (defeatOpen) return;
			return;
		}

		if (showIntro) {
			if (event.key === 'Enter' && canDeploy) {
				event.preventDefault();
				deploy();
			}
			return;
		}

		if (showResult || defeatOpen || showHelp) return;
		if (target?.closest('button, a')) return;

		if (event.code === 'Space') {
			event.preventDefault();
			togglePause();
			return;
		}

		const fast = event.shiftKey;
		switch (event.key) {
			case 'ArrowLeft':
				event.preventDefault();
				moveKeyboardCursor(-1, 0, fast);
				return;
			case 'ArrowRight':
				event.preventDefault();
				moveKeyboardCursor(1, 0, fast);
				return;
			case 'ArrowUp':
				event.preventDefault();
				moveKeyboardCursor(0, -1, fast);
				return;
			case 'ArrowDown':
				event.preventDefault();
				moveKeyboardCursor(0, 1, fast);
				return;
			case 'Enter':
				event.preventDefault();
				activateKeyboardCursor();
				return;
		}

		switch (event.key.toLowerCase()) {
			case 'f':
				cameraBridge.fitMap();
				break;
			case 'c':
				cameraBridge.focusHuman();
				break;
			case '+':
			case '=':
				cameraBridge.zoomIn();
				break;
			case '-':
			case '_':
				cameraBridge.zoomOut();
				break;
			case 'h':
				showHelp = true;
				break;
			case 'x':
				cancelLatestFront();
				break;
			case 'a':
				toggleArtilleryTargeting();
				break;
		}
	}

	onMount(() => {
		window.addEventListener('keydown', handleKeydown);
		window.addEventListener('keyup', handleKeyup);
		window.addEventListener('pointermove', handleWindowPointerMove);
		try {
			onboardingDone = window.localStorage.getItem(ONBOARDING_KEY) === 'done';
		} catch {
			onboardingDone = false;
		}
		createWorld(readSeedFromLocation());

		return () => {
			window.removeEventListener('keydown', handleKeydown);
			window.removeEventListener('keyup', handleKeyup);
			window.removeEventListener('pointermove', handleWindowPointerMove);
			clearTimeout(worldTimer);
			clearTimeout(toastTimer);
			cameraBridge.onView = undefined;
		};
	});
</script>

<svelte:head>
	<title>TERRITORY — Frontage v1</title>
</svelte:head>

<main class="game-shell" ondragover={handleDragOver} ondrop={handleCardDrop}>
	{#if upgradeTooltip}
		<div
			class="upgrade-tooltip"
			class:insufficient={!upgradeTooltip.ok}
			style={`left:${upgradeTooltip.x}px;top:${upgradeTooltip.y}px`}
			aria-hidden="true"
		>
			<span>UPGRADE +{upgradeTooltip.levels} LV</span>
			<strong>{formatSupply(upgradeTooltip.cost)}<small>S TOTAL</small></strong>
			<i>
				LV.{upgradeTooltip.currentLevel} → LV.{upgradeTooltip.projectedLevel +
					upgradeTooltip.levels}
			</i>
			{#if !upgradeTooltip.ok}<em>INSUFFICIENT SUPPLY</em>{/if}
		</div>
	{/if}
	{#if sim}
		{#key sim}
			<GameCanvas
				simulation={sim}
				{paused}
				targeting={artilleryTargeting}
				{cameraBridge}
				onTick={handleTick}
				onHover={handleHover}
				onAttack={handleAttack}
				onReady={handleReady}
				onError={handleError}
				onPerf={handlePerf}
			/>
			{#if keyboardCursorScreen && keyboardCursor}
				<div
					class="keyboard-cursor"
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
		<header class="hud topbar">
			<div class="brand-lockup">
				<div class="brand-mark" aria-hidden="true"><span></span></div>
				<div class="brand-type">
					<p class="eyebrow">FRONTAGE V1 / {PLAYER_COUNT} STATES</p>
					<h1>TERRITORY<span>.</span></h1>
				</div>
			</div>

			<div class="command-readout">
				<div class="commander" style={`--player-color:${colorForPlayer(human.id).hex}`}>
					<span class="commander-swatch" aria-hidden="true"></span>
					<span class="commander-name">
						<strong>{human.name}</strong>
						<small class:lost={!humanStructure}>
							{humanStructure ? 'COMMANDER / ANCHORED' : 'COMMANDER / NO ANCHOR'}
						</small>
					</span>
				</div>
				<div class="readout-stat">
					<span>LAND</span>
					<strong>{formatShare(human.landShare)}<em>%</em></strong>
				</div>
				<div class="readout-stat">
					<span>RANK</span>
					<strong>#{humanRank}<em>/{aliveCount}</em></strong>
				</div>
				<div class="readout-stat">
					<span>STATES</span>
					<strong>{aliveCount}<em>/{PLAYER_COUNT}</em></strong>
				</div>
			</div>

			<div class="top-actions">
				<div class="clock-block">
					<span>WAR CLOCK</span>
					<strong>{matchClock}</strong>
				</div>
				<button
					class="action-button pause-button"
					type="button"
					onclick={togglePause}
					disabled={showResult}
					aria-label={paused ? 'Resume simulation' : 'Pause simulation'}
				>
					{#if paused}
						<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.5 10 6l-7 4.5z" /></svg>
						<span>RESUME</span>
					{:else}
						<svg viewBox="0 0 12 12" aria-hidden="true">
							<path d="M3 1.5h2.2v9H3zm3.8 0H9v9H6.8z" />
						</svg>
						<span>PAUSE</span>
					{/if}
				</button>
				<button
					class="square-button"
					type="button"
					onclick={() => (showHelp = true)}
					aria-label="Open field manual"
				>
					<span>?</span>
				</button>
				<button class="action-button new-world-button" type="button" onclick={newWorld}>
					NEW WORLD
				</button>
			</div>
		</header>

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

		<aside class="right-rail hud">
			<section class="panel board" aria-label="World leaderboard">
				<div class="panel-head">
					<span>WORLD CONTROL</span>
					<span class="panel-meta">{aliveCount} ALIVE · {snapshot.attacks.length} FRONTS</span>
				</div>
				<div class="world-meter">
					<div class="world-meter-copy">
						<span>CLAIMED TERRITORY</span>
						<strong>{worldClaim.toFixed(1)}%</strong>
					</div>
					<div class="meter-track"><span style={`width:${Math.min(100, worldClaim)}%`}></span></div>
					<div class="world-meter-foot">
						<span>{formatCompact(snapshot.claimedLand)} PX</span>
						<span>{formatCompact(snapshot.landCount)} LAND</span>
					</div>
				</div>

				<div class="rank-scroll" bind:this={rankScrollEl} onscroll={handleRankScroll}>
					{#if rankWindow.start > 0}
						<div
							class="rank-spacer"
							style={`height:${rankWindow.start * RANK_ROW_HEIGHT}px`}
							aria-hidden="true"
						></div>
					{/if}
					<ol class="rank-list">
						{#each visibleRanked as player, index (player.id)}
							<li
								class:is-human={player.id === human.id}
								class:is-dead={!player.alive}
								style={`--player-color:${colorForPlayer(player.id).hex};--share:${Math.min(100, player.landShare * 100)}%`}
							>
								<span class="rank-index">
									{String(rankWindow.start + index + 1).padStart(3, '0')}
								</span>
								<span class="rank-swatch" aria-hidden="true"></span>
								<span class="rank-name">
									{player.name}
									{#if player.id === human.id}<em>YOU</em>{/if}
									{#if !player.alive}<em class="dead-tag">OUT</em>{/if}
								</span>
								<span class="rank-land">{formatShare(player.landShare)}%</span>
								<span class="rank-progress" aria-hidden="true"></span>
							</li>
						{/each}
					</ol>
					{#if rankWindow.end < ranked.length}
						<div
							class="rank-spacer"
							style={`height:${(ranked.length - rankWindow.end) * RANK_ROW_HEIGHT}px`}
							aria-hidden="true"
						></div>
					{/if}
				</div>

				<div class="panel-foot">
					<span><i class="live-dot"></i>WEBGPU</span>
					<span>TICK {String(snapshot.tick).padStart(5, '0')}</span>
					<span>SEED {seedHex}</span>
				</div>
			</section>

			{#if eventFeed.length > 0}
				<section class="panel feed" aria-label="War feed">
					<div class="panel-head"><span>WAR FEED</span><span class="panel-meta">LIVE</span></div>
					<ul>
						{#each eventFeed as event (event.id)}
							<li
								class:elimination={event.kind === 'elimination'}
								class:structure={event.kind === 'structure'}
								class:build={event.kind === 'build'}
							>
								<span>{event.message}</span>
								<time>{formatClock(event.tick / TICK_RATE)}</time>
							</li>
						{/each}
					</ul>
				</section>
			{/if}
		</aside>

		<div class="minimap-dock hud">
			<Minimap simulation={sim} {snapshot} {cameraView} onNavigate={navigateFromMinimap} />
			<div class="minimap-meta">
				<span>ATLAS / {MAP_WIDTH} × {MAP_HEIGHT}</span>
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

		<div class="growth-switcher hud" aria-label="Growth layer for new fronts">
			<span class="growth-label">GROWTH / NEW FRONTS</span>
			<div class="growth-options">
				{#each GROWTH_MODES as mode (mode)}
					<button
						type="button"
						class:active={growthMode === mode}
						onclick={() => selectGrowthMode(mode)}
						title={GROWTH_DESCRIPTIONS[mode]}
						aria-pressed={growthMode === mode}
					>
						{GROWTH_LABELS[mode]}
					</button>
				{/each}
			</div>
		</div>

		<div class="card-tray hud" aria-label="Build cards">
			<div class="economy-readout">
				<div class="economy-row">
					<span>SUPPLY</span>
					<strong title={String(snapshot.supply)}>{formatSupply(snapshot.supply)}</strong>
				</div>
				<div class="economy-row economy-orders">
					<span>CAP</span>
					<b title={`${snapshot.supply} / ${snapshot.supplyCap}`}>
						{formatSupply(snapshot.supply)}/{formatSupply(snapshot.supplyCap)}
					</b>
				</div>
				<div class="economy-row economy-orders">
					<span>FRONTS</span>
					<b>{humanFronts.length}</b>
				</div>
				{#if humanFronts.length > 0}
					<button class="cancel-front" type="button" onclick={cancelLatestFront}>
						CANCEL LAST
					</button>
				{/if}
				{#if humanArtillery.length > 0}
					<button
						class="fire-artillery"
						class:active={artilleryTargeting}
						class:unaffordable={!artilleryTargeting && snapshot.supply < artilleryVolleyCost}
						type="button"
						onclick={toggleArtilleryTargeting}
						disabled={!artilleryTargeting && snapshot.supply < artilleryVolleyCost}
						title={`Fire every ready battery (${readyArtilleryShells} shells, ${artilleryVolleyCost} supply) at a point within range`}
					>
						{artilleryTargeting
							? 'SELECT TARGET'
							: `FIRE ${readyArtillery.length}/${humanArtillery.length} · ${formatSupply(artilleryVolleyCost)}S`}
					</button>
				{/if}
				<div
					class="economy-row economy-defense"
					title={hover?.land
						? `${ELEVATION_NAMES[hover.elevation]} / B${hover.baseDefense}${
								hover.auraDefense > 0 ? ` / AURA +${hover.auraDefense}` : ''
							}`
						: 'Hover land to inspect defense'}
				>
					<span>DEF</span>
					<b>{hover?.land ? hover.defense : '—'}</b>
				</div>
				<small>+{snapshot.supplyIncome}/s · cards & fronts</small>
			</div>

			<div
				class="hand-shell"
				class:collapsed={!handRaised}
				bind:this={handShellEl}
				aria-label="Card hand"
			>
				<div class="hand-row">
					{#each snapshot.hand as card, index (card.id)}
						{@const definition = cardDefinition(card)}
						{@const accent = STRUCTURE_ACCENTS[card.type]}
						<article
							class="build-card"
							class:unaffordable={snapshot.supply < definition.cost}
							class:dragging={draggingCardId === card.id}
							style={`--card-accent:${accent};--card-tilt:${(index - (snapshot.hand.length - 1) / 2) * 2.2}deg`}
							draggable={snapshot.supply >= definition.cost}
							in:fly={{ y: 42, duration: 360, delay: Math.min(index, 2) * 55 }}
							out:fly={{ y: 28, duration: 240 }}
							animate:flip={{ duration: 260 }}
							ondragstart={(event) => startCardDrag(event, card)}
							ondrag={updateDragHover}
							ondragend={endCardDrag}
							onpointerdown={() => (handRaised = true)}
							title={`Drag ${definition.label} into your territory`}
						>
							<div class="card-face">
								<div class="card-banner">
									<span>BUILD CARD</span>
									<div class="card-cost">
										<b title={String(definition.cost)}>{formatSupply(definition.cost)}</b><small>
											S
										</small>
									</div>
								</div>
								<h3 class="card-title">{definition.label}</h3>
								<div class="card-art" aria-hidden="true">
									<span class="card-art-icon">
										{#if card.type === 'artillery'}
											<svg viewBox="0 0 24 24">
												<path
													d="M3 19h8M5 19a3 3 0 0 1 6 0M11 18 20 7M17 5l3 2-2 3M4 12c3-5 8-7 16-7"
												/>
											</svg>
										{:else if card.type === 'barracks'}
											<svg viewBox="0 0 24 24">
												<path d="M5 19 19 5M8 5l11 11M5 16l3 3M16 5l3 3" />
											</svg>
										{:else if card.type === 'fortification'}
											<svg viewBox="0 0 24 24">
												<path d="M12 3 19 6v5c0 5-3 8-7 10-4-2-7-5-7-10V6z" />
											</svg>
										{:else if card.type === 'jammer'}
											<svg viewBox="0 0 24 24">
												<path
													d="M12 12v9M4 8a11 11 0 0 1 16 0M7 11a7 7 0 0 1 10 0M10 14a3 3 0 0 1 4 0"
												/>
											</svg>
										{:else if card.type === 'command-post'}
											<svg viewBox="0 0 24 24">
												<path d="M12 21V9M8 9a6 6 0 0 1 8 0M5 6a10 10 0 0 1 14 0M9 21h6" />
											</svg>
										{:else}
											<svg viewBox="0 0 24 24">
												<path d="M12 4 20 8l-8 4-8-4zM4 12l8 4 8-4M4 16l8 4 8-4" />
											</svg>
										{/if}
									</span>
								</div>
								<div class="card-type">STRUCTURE / {cardCategory(card.type)}</div>
								<p class="card-rules">{definition.description}</p>
								<div class="card-footer"><span>DRAG TO BUILD</span><span>◆</span></div>
							</div>
						</article>
					{/each}
				</div>
			</div>
		</div>

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
				Generating {MAP_WIDTH.toLocaleString('en-US')} × {MAP_HEIGHT.toLocaleString('en-US')} terrain
				cells and deploying {PLAYER_COUNT} states.
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
						{PLAYER_COUNT} deterministic states fighting over the same pixel atlas.
					</p>

					<div class="spec-strip">
						<div><strong>{MAP_WIDTH} × {MAP_HEIGHT}</strong><span>PIXEL ATLAS</span></div>
						<div><strong>{TICK_RATE} HZ</strong><span>FIXED SIMULATION</span></div>
						<div><strong>WEBGPU</strong><span>DIRTY-TILE RENDER</span></div>
						<div><strong>{PLAYER_COUNT}</strong><span>STATES DEPLOYED</span></div>
					</div>

					<div class="intro-actions">
						<button class="deploy-button" type="button" onclick={deploy} disabled={!canDeploy}>
							<span>{canDeploy ? 'DEPLOY COMMANDER' : 'INITIALISING WEBGPU…'}</span>
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
						Frontage prototype: {PLAYER_COUNT - 1} AI states fight for 70% of the land while you build
						with a single supply economy. Fronts cost supply, trade strength on contact, and can be cancelled.
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
					<div class="brief-footer">
						<span>MAP SEED</span>
						<strong>{seedHex}</strong>
					</div>
				</aside>
			</div>

			<div class="intro-footbar">
				<span>BUILD 0.35.0 / PROTOCOL 36</span>
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
							it, to upgrade; cost is the card price plus current level. Shift-click queues five
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
							defense. Artillery costs 300 supply, needs 16 px of district-free ground, and covers a
							64 px district. <kbd>A</kbd> or FIRE, then click an aim point in range. Each level fires
							one inaccurate shell at 150 supply per level; shells damage structures but cannot destroy
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
						<h3>{PLAYER_COUNT} states, one tick.</h3>
						<p>
							{TICK_RATE} fixed ticks per second, {PLAYER_COUNT - 1} free-attacking AI states, and a seeded
							PRNG. The {(MAP_WIDTH * MAP_HEIGHT).toLocaleString('en-US')} pixel atlas is rendered from
							a GPU control texture with only dirty tiles uploaded. Every second, land cut off from every
							live State structure is annexed by an adjacent protected mainland with the largest shared
							border. Capture a State structure to remove that state's annexation protection.
						</p>
					</section>
				</div>

				<div class="manual-footer">
					<span><kbd>SPACE</kbd> PAUSE / RESUME</span>
					<span><kbd>+</kbd> <kbd>−</kbd> ZOOM</span>
					<span><kbd>H</kbd> FIELD MANUAL</span>
					<span>WEBGPU / DETERMINISTIC CORE</span>
				</div>
			</article>
		</div>
	{/if}

	{#if toast}
		<div
			class="toast"
			class:toast-error={toast.tone === 'error'}
			class:toast-warn={toast.tone === 'warn'}
			role="status"
		>
			<i></i>
			<span>{toast.message}</span>
		</div>
	{/if}
</main>

<style>
	.game-shell {
		position: fixed;
		inset: 0;
		overflow: hidden;
		isolation: isolate;
		background: var(--bg-abyss);
	}

	.map-atmosphere {
		position: absolute;
		inset: 0;
		z-index: 1;
		pointer-events: none;
		background:
			radial-gradient(
				ellipse at 50% 40%,
				transparent 34%,
				rgba(2, 7, 10, 0.18) 72%,
				rgba(2, 6, 9, 0.56) 100%
			),
			linear-gradient(
				to bottom,
				rgba(2, 7, 10, 0.6),
				rgba(2, 7, 10, 0.18) 10%,
				transparent 22%,
				transparent 72%,
				rgba(2, 6, 9, 0.58)
			);
	}

	.hud {
		position: absolute;
		z-index: 20;
	}

	.topbar {
		inset: 18px 22px auto;
		display: grid;
		grid-template-columns: minmax(205px, 1fr) auto minmax(270px, 1fr);
		align-items: start;
		gap: 18px;
		pointer-events: none;
		animation: hud-in 500ms ease-out both;
	}

	.topbar > * {
		pointer-events: auto;
	}

	.brand-lockup {
		display: flex;
		align-items: center;
		gap: 12px;
		min-width: 0;
		padding-top: 2px;
		filter: drop-shadow(0 2px 18px rgba(0, 0, 0, 0.78));
	}

	.brand-mark {
		position: relative;
		display: grid;
		place-items: center;
		flex: none;
		width: 37px;
		height: 37px;
		border: 1px solid var(--line-strong);
		background: rgba(6, 14, 18, 0.66);
		backdrop-filter: blur(12px);
		transform: rotate(45deg);
	}

	.brand-mark span {
		width: 9px;
		height: 9px;
		background: var(--signal);
		box-shadow: 0 0 16px rgba(220, 233, 149, 0.6);
	}

	.brand-mark::before,
	.brand-mark::after {
		content: '';
		position: absolute;
		background: var(--line-strong);
	}

	.brand-mark::before {
		inset: 5px;
		border: 1px solid var(--line-soft);
	}

	.brand-mark::after {
		width: 49px;
		height: 1px;
		opacity: 0.5;
	}

	.brand-type {
		min-width: 0;
	}

	.eyebrow,
	.overlay-kicker {
		margin: 0;
		font-family: var(--font-mono);
		font-size: 8px;
		font-weight: 600;
		letter-spacing: 0.2em;
		line-height: 1.4;
		color: var(--ink-dim);
	}

	.brand-type h1 {
		margin: 1px 0 0;
		font-family: var(--font-display);
		font-size: 30px;
		font-weight: 700;
		line-height: 0.9;
		letter-spacing: 0.035em;
	}

	.brand-type h1 span {
		color: var(--signal);
	}

	.command-readout {
		display: flex;
		align-items: stretch;
		height: 48px;
		border: 1px solid var(--line-strong);
		background: rgba(5, 13, 18, 0.76);
		box-shadow: 0 16px 50px rgba(0, 0, 0, 0.24);
		backdrop-filter: blur(18px) saturate(0.8);
		animation: hud-in 600ms 80ms ease-out both;
	}

	.commander {
		position: relative;
		display: flex;
		align-items: center;
		gap: 9px;
		min-width: 146px;
		padding: 0 16px 0 14px;
		background: linear-gradient(
			90deg,
			color-mix(in srgb, var(--player-color) 12%, transparent),
			transparent
		);
	}

	.commander::after {
		content: '';
		position: absolute;
		right: 0;
		top: 8px;
		bottom: 8px;
		width: 1px;
		background: var(--line-soft);
	}

	.commander-swatch {
		width: 8px;
		height: 22px;
		background: var(--player-color);
		box-shadow: 0 0 15px color-mix(in srgb, var(--player-color) 55%, transparent);
	}

	.commander-name {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.commander-name strong {
		font-family: var(--font-display);
		font-size: 17px;
		letter-spacing: 0.08em;
		line-height: 1;
	}

	.commander-name small.lost {
		color: #ffab98;
	}

	.commander-name small,
	.readout-stat > span,
	.clock-block > span {
		font-family: var(--font-mono);
		font-size: 7px;
		letter-spacing: 0.16em;
		color: var(--ink-faint);
	}

	.readout-stat {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 3px;
		min-width: 73px;
		padding: 0 13px;
		border-left: 1px solid var(--line-soft);
	}

	.readout-stat strong {
		font-family: var(--font-mono);
		font-size: 14px;
		font-weight: 500;
		letter-spacing: -0.03em;
		line-height: 1;
		color: var(--ink);
	}

	.readout-stat em {
		margin-left: 1px;
		font-style: normal;
		font-size: 9px;
		color: var(--ink-faint);
	}

	.top-actions {
		justify-self: end;
		display: flex;
		align-items: center;
		gap: 7px;
		height: 48px;
		animation: hud-in 600ms 140ms ease-out both;
	}

	.clock-block {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 3px;
		margin-right: 4px;
	}

	.clock-block strong {
		font-family: var(--font-mono);
		font-size: 17px;
		font-weight: 500;
		line-height: 1;
		letter-spacing: 0.03em;
	}

	.action-button,
	.square-button {
		height: 36px;
		border: 1px solid var(--line-strong);
		background: rgba(5, 13, 18, 0.76);
		font-family: var(--font-mono);
		font-size: 9px;
		letter-spacing: 0.1em;
		color: var(--ink-dim);
		backdrop-filter: blur(14px);
		cursor: pointer;
		transition:
			color 160ms ease,
			border-color 160ms ease,
			background 160ms ease;
	}

	.action-button {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		padding: 0 13px;
	}

	.action-button svg {
		width: 10px;
		height: 10px;
		fill: currentColor;
	}

	.action-button:hover,
	.square-button:hover {
		color: var(--ink);
		border-color: rgba(220, 233, 149, 0.55);
		background: rgba(14, 26, 30, 0.9);
	}

	.action-button:disabled {
		opacity: 0.4;
		cursor: default;
	}

	.square-button {
		display: grid;
		place-items: center;
		width: 36px;
		padding: 0;
		font-size: 14px;
	}

	.new-world-button {
		color: var(--signal);
	}

	.right-rail {
		top: 92px;
		right: 22px;
		display: flex;
		flex-direction: column;
		gap: 11px;
		width: 302px;
		pointer-events: none;
	}

	.right-rail > * {
		pointer-events: auto;
	}

	.panel {
		position: relative;
		border: 1px solid var(--line-strong);
		background: rgba(5, 13, 18, 0.8);
		box-shadow: 0 25px 70px rgba(0, 0, 0, 0.33);
		backdrop-filter: blur(18px) saturate(0.82);
		animation: hud-in 550ms 100ms ease-out both;
	}

	.panel::before {
		content: '';
		position: absolute;
		top: -1px;
		left: -1px;
		width: 13px;
		height: 13px;
		border-top: 1px solid rgba(220, 233, 149, 0.68);
		border-left: 1px solid rgba(220, 233, 149, 0.68);
		pointer-events: none;
	}

	.panel-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 12px 14px 10px;
		border-bottom: 1px solid var(--line-soft);
		font-family: var(--font-mono);
		font-size: 8px;
		font-weight: 600;
		letter-spacing: 0.14em;
		color: var(--ink-dim);
	}

	.panel-meta {
		color: var(--ink-faint);
		font-size: 7px;
	}

	.world-meter {
		padding: 12px 14px 11px;
		border-bottom: 1px solid var(--line-soft);
	}

	.world-meter-copy,
	.world-meter-foot {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
	}

	.world-meter-copy span,
	.world-meter-foot {
		font-family: var(--font-mono);
		font-size: 7px;
		letter-spacing: 0.1em;
		color: var(--ink-faint);
	}

	.world-meter-copy strong {
		font-family: var(--font-mono);
		font-size: 13px;
		font-weight: 500;
		color: var(--signal);
	}

	.meter-track {
		position: relative;
		height: 3px;
		margin: 9px 0 6px;
		background: rgba(255, 255, 255, 0.08);
		overflow: hidden;
	}

	.meter-track span {
		display: block;
		height: 100%;
		background: linear-gradient(90deg, #8ead71, var(--signal));
		box-shadow: 0 0 12px rgba(220, 233, 149, 0.4);
		transition: width 450ms ease;
	}

	.rank-scroll {
		max-height: min(40vh, 360px);
		overflow-y: auto;
		overscroll-behavior: contain;
		scrollbar-gutter: stable;
	}

	.rank-list {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.rank-list li {
		position: relative;
		display: grid;
		grid-template-columns: 25px 6px minmax(0, 1fr) 50px;
		align-items: center;
		gap: 8px;
		height: 28px;
		padding: 0 13px;
		overflow: hidden;
		font-size: 11px;
		transition: background 150ms ease;
	}

	.rank-list li:hover {
		background: rgba(255, 255, 255, 0.025);
	}

	.rank-list li.is-human {
		background: color-mix(in srgb, var(--player-color) 9%, transparent);
	}

	.rank-list li.is-human::before {
		content: '';
		position: absolute;
		left: 0;
		top: 6px;
		bottom: 6px;
		width: 2px;
		background: var(--player-color);
	}

	.rank-list li.is-dead {
		opacity: 0.34;
		filter: grayscale(1);
	}

	.rank-progress {
		position: absolute;
		left: 0;
		bottom: 0;
		height: 1px;
		width: var(--share);
		background: var(--player-color);
		opacity: 0.35;
	}

	.rank-index {
		font-family: var(--font-mono);
		font-size: 8px;
		color: var(--ink-faint);
	}

	.rank-swatch {
		width: 6px;
		height: 12px;
		background: var(--player-color);
	}

	.rank-name {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		font-family: var(--font-mono);
		font-size: 10px;
		letter-spacing: 0.04em;
		color: var(--ink);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.rank-name em {
		flex: none;
		padding: 1px 3px;
		border: 1px solid color-mix(in srgb, var(--player-color) 40%, transparent);
		font-family: var(--font-mono);
		font-size: 6px;
		font-style: normal;
		letter-spacing: 0.08em;
		color: var(--player-color);
	}

	.rank-name em.dead-tag {
		border-color: var(--line-strong);
		color: var(--ink-faint);
	}

	.rank-land {
		font-family: var(--font-mono);
		font-size: 9px;
		text-align: right;
		color: var(--ink-dim);
	}

	.panel-foot {
		display: flex;
		justify-content: space-between;
		gap: 6px;
		padding: 9px 13px;
		border-top: 1px solid var(--line-soft);
		font-family: var(--font-mono);
		font-size: 6.5px;
		letter-spacing: 0.08em;
		color: var(--ink-faint);
	}

	.live-dot {
		display: inline-block;
		width: 4px;
		height: 4px;
		margin-right: 5px;
		border-radius: 50%;
		background: var(--signal);
		box-shadow: 0 0 7px var(--signal);
		vertical-align: 1px;
	}

	.feed {
		animation-delay: 160ms;
	}

	.feed ul {
		margin: 0;
		padding: 7px 0;
		list-style: none;
	}

	.feed li {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 6px 13px;
		font-size: 10px;
		line-height: 1.45;
		color: var(--ink-dim);
	}

	.feed li.elimination span {
		color: #ffab98;
	}

	.feed li.structure span {
		color: #ffd690;
	}

	.feed li.build span {
		color: #b7e0c6;
	}

	.feed time {
		flex: none;
		font-family: var(--font-mono);
		font-size: 7px;
		color: var(--ink-faint);
	}

	.minimap-dock {
		left: 22px;
		bottom: 22px;
		width: clamp(220px, 22vw, 300px);
		animation: hud-in 600ms 180ms ease-out both;
	}

	.minimap-meta {
		display: flex;
		justify-content: space-between;
		gap: 8px;
		margin-top: 6px;
		font-family: var(--font-mono);
		font-size: 7px;
		letter-spacing: 0.08em;
		color: var(--ink-faint);
	}

	.map-tools {
		right: 22px;
		bottom: 22px;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 5px;
		animation: hud-in 600ms 260ms ease-out both;
	}

	.tool-stack {
		display: flex;
		gap: 5px;
	}

	.map-tools button {
		display: grid;
		place-items: center;
		width: 36px;
		height: 34px;
		padding: 0;
		border: 1px solid var(--line-strong);
		background: rgba(5, 13, 18, 0.82);
		font-family: var(--font-mono);
		font-size: 13px;
		color: var(--ink-dim);
		backdrop-filter: blur(12px);
		cursor: pointer;
		transition:
			color 150ms ease,
			border-color 150ms ease;
	}

	.map-tools button:hover {
		color: var(--signal);
		border-color: rgba(220, 233, 149, 0.55);
	}

	.map-tools .tool-wide {
		width: 77px;
		height: 26px;
		font-size: 7px;
		letter-spacing: 0.12em;
	}

	.perf-readout {
		display: flex;
		gap: 9px;
		margin-top: 3px;
		font-family: var(--font-mono);
		font-size: 6.5px;
		letter-spacing: 0.05em;
		color: var(--ink-faint);
	}

	.card-tray {
		left: 50%;
		bottom: 12px;
		transform: translateX(-50%);
		display: flex;
		align-items: flex-end;
		gap: 16px;
		padding: 0;
		border: 0;
		background: none;
		backdrop-filter: none;
		box-shadow: none;
		pointer-events: none;
		animation: hud-fade 600ms 200ms ease-out both;
	}

	.economy-readout {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		justify-content: center;
		gap: 4px;
		width: 112px;
		margin-bottom: 20px;
		padding: 9px 10px;
		border: 1px solid rgba(255, 214, 144, 0.28);
		background:
			linear-gradient(150deg, rgba(255, 214, 144, 0.1), transparent 55%), rgba(7, 16, 21, 0.86);
		box-shadow:
			0 14px 34px rgba(0, 0, 0, 0.38),
			inset 0 0 0 1px rgba(255, 255, 255, 0.035);
		clip-path: polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px);
		pointer-events: auto;
	}

	.economy-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 6px;
	}

	.economy-readout span {
		font-family: var(--font-mono);
		font-size: 6.5px;
		letter-spacing: 0.12em;
		color: var(--ink-faint);
	}

	.economy-row strong {
		font-family: var(--font-display);
		font-size: 25px;
		line-height: 0.8;
		color: #ffd690;
		text-shadow: 0 0 18px rgba(255, 214, 144, 0.28);
	}

	.economy-orders,
	.economy-defense {
		padding-top: 3px;
		border-top: 1px solid rgba(255, 248, 220, 0.1);
	}

	.economy-orders b,
	.economy-defense b {
		font-family: var(--font-mono);
		font-size: 11px;
		font-weight: 500;
		color: var(--signal);
	}

	.economy-defense b {
		color: #ffd690;
	}

	.economy-readout small {
		font-family: var(--font-mono);
		font-size: 6px;
		line-height: 1.35;
		color: var(--ink-dim);
	}

	.cancel-front {
		margin-top: 4px;
		padding: 4px 5px;
		border: 1px solid rgba(255, 120, 103, 0.45);
		background: rgba(255, 120, 103, 0.08);
		color: var(--danger);
		font-family: var(--font-mono);
		font-size: 5.5px;
		letter-spacing: 0.1em;
		cursor: pointer;
	}

	.cancel-front:hover {
		background: rgba(255, 120, 103, 0.16);
	}

	.fire-artillery {
		margin-top: 4px;
		padding: 4px 5px;
		border: 1px solid rgba(255, 155, 90, 0.45);
		background: rgba(255, 155, 90, 0.08);
		color: #ffc48a;
		font-family: var(--font-mono);
		font-size: 5.5px;
		letter-spacing: 0.1em;
		cursor: pointer;
	}

	.fire-artillery:hover,
	.fire-artillery.active {
		background: rgba(255, 155, 90, 0.2);
	}

	.fire-artillery.active {
		box-shadow: 0 0 0 1px rgba(255, 155, 90, 0.25);
	}

	.fire-artillery.unaffordable {
		border-color: rgba(255, 120, 103, 0.28);
		color: rgba(255, 196, 138, 0.4);
		cursor: not-allowed;
	}

	.hand-shell {
		display: flex;
		align-items: flex-end;
		pointer-events: none;
	}

	.hand-row {
		display: flex;
		align-items: flex-end;
		gap: 8px;
		padding: 0 4px 10px;
		pointer-events: none;
		transform: translateY(0);
		transition:
			transform 360ms cubic-bezier(0.2, 0.72, 0.2, 1),
			opacity 260ms ease;
		will-change: transform;
	}

	.hand-shell.collapsed .hand-row {
		transform: translateY(calc(100% - 30px));
		opacity: 0.92;
	}

	.build-card {
		position: relative;
		z-index: 1;
		flex: none;
		width: 136px;
		height: 204px;
		cursor: grab;
		user-select: none;
		transform: translateY(0) rotate(var(--card-tilt));
		transform-origin: 50% 100%;
		transition:
			transform 220ms cubic-bezier(0.2, 0.75, 0.25, 1),
			filter 200ms ease,
			opacity 160ms ease;
		filter: drop-shadow(0 18px 20px rgba(0, 0, 0, 0.42));
		pointer-events: auto;
	}

	.build-card:hover {
		z-index: 6;
		transform: translateY(-18px) rotate(0deg) scale(1.035);
		filter: drop-shadow(0 26px 30px rgba(0, 0, 0, 0.55));
	}

	.build-card.dragging {
		z-index: 8;
		opacity: 0.4;
		transform: translateY(-28px) rotate(4deg) scale(0.94);
		filter: drop-shadow(0 30px 38px rgba(0, 0, 0, 0.65));
		cursor: grabbing;
	}

	.build-card.unaffordable {
		cursor: not-allowed;
		filter: saturate(0.46) brightness(0.8) drop-shadow(0 12px 16px rgba(0, 0, 0, 0.38));
	}

	.build-card.unaffordable:hover {
		filter: saturate(0.62) brightness(0.9) drop-shadow(0 20px 24px rgba(0, 0, 0, 0.5));
	}

	.card-face {
		position: relative;
		display: flex;
		flex-direction: column;
		height: 100%;
		padding: 9px;
		overflow: hidden;
		border: 1px solid color-mix(in srgb, var(--card-accent) 58%, #d8cfae 42%);
		background:
			radial-gradient(
				circle at 50% 8%,
				color-mix(in srgb, var(--card-accent) 16%, transparent),
				transparent 48%
			),
			linear-gradient(150deg, rgba(255, 255, 255, 0.055), transparent 34%),
			linear-gradient(165deg, #15252c 0%, #0a151b 55%, #071116 100%);
		box-shadow:
			inset 0 0 0 1px rgba(255, 248, 220, 0.08),
			inset 0 0 32px rgba(0, 0, 0, 0.45);
		clip-path: polygon(
			11px 0,
			calc(100% - 11px) 0,
			100% 11px,
			100% calc(100% - 11px),
			calc(100% - 11px) 100%,
			11px 100%,
			0 calc(100% - 11px),
			0 11px
		);
	}

	.card-face::before {
		content: '';
		position: absolute;
		inset: 3px;
		border: 1px solid color-mix(in srgb, var(--card-accent) 24%, transparent);
		clip-path: inherit;
		pointer-events: none;
	}

	.card-face::after {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(
			115deg,
			transparent 35%,
			rgba(255, 255, 255, 0.08) 48%,
			transparent 58%
		);
		opacity: 0;
		transition: opacity 220ms ease;
		pointer-events: none;
	}

	.build-card:hover .card-face::after {
		opacity: 1;
	}

	.card-banner {
		position: relative;
		z-index: 1;
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		min-height: 28px;
		font-family: var(--font-mono);
		font-size: 5.8px;
		letter-spacing: 0.16em;
		color: color-mix(in srgb, var(--card-accent) 72%, #f7eed0 28%);
	}

	.card-cost {
		display: flex;
		align-items: baseline;
		justify-content: center;
		gap: 1px;
		width: 30px;
		height: 34px;
		margin-top: -7px;
		margin-right: -5px;
		padding-top: 4px;
		background: radial-gradient(
			circle at 34% 28%,
			#fff6cd 0%,
			#e7c477 34%,
			#a66b28 72%,
			#634017 100%
		);
		clip-path: polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%);
		color: #211508;
		box-shadow: 0 0 16px color-mix(in srgb, var(--card-accent) 38%, transparent);
	}

	.card-cost b {
		font-family: var(--font-display);
		font-size: 15px;
		line-height: 1;
	}

	.card-cost small {
		font-family: var(--font-mono);
		font-size: 5.5px;
		letter-spacing: 0;
	}

	.card-title {
		position: relative;
		z-index: 1;
		margin: 1px 0 5px;
		font-family: var(--font-display);
		font-size: 17px;
		font-weight: 500;
		line-height: 0.95;
		letter-spacing: 0.02em;
		color: #fff7df;
		text-shadow: 0 1px 12px rgba(0, 0, 0, 0.6);
	}

	.card-art {
		position: relative;
		display: grid;
		place-items: center;
		flex: none;
		height: 78px;
		margin-bottom: 5px;
		overflow: hidden;
		border-top: 1px solid color-mix(in srgb, var(--card-accent) 30%, transparent);
		border-bottom: 1px solid color-mix(in srgb, var(--card-accent) 30%, transparent);
		background:
			repeating-linear-gradient(135deg, transparent 0 7px, rgba(255, 255, 255, 0.02) 7px 8px),
			radial-gradient(
				circle at 50% 45%,
				color-mix(in srgb, var(--card-accent) 30%, transparent),
				transparent 65%
			),
			linear-gradient(180deg, rgba(255, 255, 255, 0.035), rgba(0, 0, 0, 0.18));
	}

	.card-art::before {
		content: '';
		position: absolute;
		width: 82px;
		height: 82px;
		border: 1px solid color-mix(in srgb, var(--card-accent) 20%, transparent);
		border-radius: 50%;
		box-shadow: 0 0 0 10px color-mix(in srgb, var(--card-accent) 4%, transparent);
	}

	.card-art-icon {
		position: relative;
		z-index: 1;
		display: grid;
		place-items: center;
		width: 48px;
		height: 48px;
		color: var(--card-accent);
		filter: drop-shadow(0 0 14px color-mix(in srgb, var(--card-accent) 45%, transparent));
	}

	.card-art-icon svg {
		width: 100%;
		height: 100%;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.35;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.card-type {
		position: relative;
		z-index: 1;
		margin-bottom: 4px;
		padding-bottom: 4px;
		border-bottom: 1px solid rgba(255, 248, 220, 0.11);
		font-family: var(--font-mono);
		font-size: 5.8px;
		letter-spacing: 0.1em;
		color: color-mix(in srgb, var(--card-accent) 68%, #f7eed0 32%);
	}

	.card-rules {
		position: relative;
		z-index: 1;
		flex: 1;
		margin: 0;
		font-size: 9px;
		line-height: 1.32;
		color: #c9d4cc;
	}

	.card-footer {
		position: relative;
		z-index: 1;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin-top: 4px;
		padding-top: 4px;
		border-top: 1px solid rgba(255, 248, 220, 0.1);
		font-family: var(--font-mono);
		font-size: 5.2px;
		letter-spacing: 0.12em;
		color: var(--ink-faint);
	}

	.card-footer span:last-child {
		color: var(--card-accent);
	}

	.drag-overlay {
		position: fixed;
		inset: 0;
		z-index: 80;
		width: 100%;
		height: 100%;
		overflow: visible;
		pointer-events: none;
	}

	.drag-arrow-path {
		fill: none;
		stroke: var(--drag-accent);
		stroke-width: 2.6;
		stroke-linecap: round;
		filter: drop-shadow(0 0 6px color-mix(in srgb, var(--drag-accent) 55%, transparent));
	}

	.drag-arrow-head {
		fill: var(--drag-accent);
		filter: drop-shadow(0 0 5px color-mix(in srgb, var(--drag-accent) 55%, transparent));
	}

	.drag-arrow-origin {
		fill: var(--drag-accent);
		stroke: rgba(6, 14, 18, 0.9);
		stroke-width: 2;
	}

	.drag-landing-field {
		fill: rgba(255, 95, 87, 0.17);
		stroke: none;
	}

	.drag-landing-ring {
		fill: none;
		stroke: #ff5f57;
		stroke-width: 2.8;
		stroke-dasharray: 6 5;
		filter: drop-shadow(0 0 9px rgba(255, 95, 87, 0.65));
	}

	.drag-landing-dot {
		fill: #ff7069;
		stroke: rgba(6, 14, 18, 0.9);
		stroke-width: 1.4;
	}

	.drag-overlay .valid .drag-landing-field {
		fill: rgba(131, 226, 124, 0.15);
	}

	.drag-overlay .valid .drag-landing-ring {
		stroke: #83e27c;
		filter: drop-shadow(0 0 9px rgba(131, 226, 124, 0.65));
	}

	.drag-overlay .valid .drag-landing-dot {
		fill: #93e08d;
	}

	.growth-switcher {
		left: 22px;
		bottom: 240px;
		transform: none;
		display: flex;
		align-items: center;
		gap: 10px;
		height: 32px;
		padding: 0 7px 0 12px;
		border: 1px solid var(--line-strong);
		background: rgba(5, 13, 18, 0.82);
		backdrop-filter: blur(14px);
		box-shadow: 0 10px 32px rgba(0, 0, 0, 0.24);
		animation: hud-in 600ms 240ms ease-out both;
	}

	.growth-label {
		font-family: var(--font-mono);
		font-size: 7px;
		letter-spacing: 0.12em;
		color: var(--ink-faint);
	}

	.growth-options {
		display: flex;
		gap: 3px;
	}

	.growth-options button {
		height: 22px;
		padding: 0 8px;
		border: 1px solid transparent;
		background: transparent;
		font-family: var(--font-mono);
		font-size: 7px;
		letter-spacing: 0.06em;
		color: var(--ink-dim);
		cursor: pointer;
		transition:
			color 140ms ease,
			background 140ms ease,
			border-color 140ms ease;
	}

	.growth-options button:hover {
		color: var(--ink);
		border-color: var(--line-strong);
	}

	.growth-options button.active {
		border-color: var(--signal);
		background: var(--signal);
		color: #0a1310;
	}

	kbd {
		display: inline-block;
		padding: 2px 4px;
		border: 1px solid rgba(196, 216, 200, 0.24);
		background: rgba(255, 255, 255, 0.035);
		font-family: var(--font-mono);
		font-size: 7px;
		letter-spacing: 0.05em;
		color: var(--ink-dim);
	}

	.paused-flag {
		top: 84px;
		left: 50%;
		transform: translateX(-50%);
		padding: 7px 14px;
		border: 1px solid rgba(220, 233, 149, 0.4);
		background: rgba(4, 12, 15, 0.74);
		font-family: var(--font-mono);
		font-size: 8px;
		letter-spacing: 0.14em;
		color: var(--signal);
		backdrop-filter: blur(10px);
	}

	.paused-flag span {
		margin-left: 9px;
		color: var(--ink-faint);
	}

	.overlay {
		position: fixed;
		inset: 0;
		z-index: 60;
		display: grid;
		place-items: center;
		overflow: auto;
		background: rgba(3, 8, 11, 0.84);
		backdrop-filter: blur(7px);
		animation: veil-in 350ms ease-out both;
	}

	.loading-overlay {
		z-index: 90;
		align-content: center;
		background: #040b0f;
		text-align: center;
	}

	.loader-mark {
		position: relative;
		width: 54px;
		height: 54px;
		margin: 0 auto 24px;
		border: 1px solid rgba(220, 233, 149, 0.26);
		transform: rotate(45deg);
	}

	.loader-mark span {
		position: absolute;
		background: var(--signal);
		animation: loader-pulse 1.6s ease-in-out infinite;
	}

	.loader-mark span:nth-child(1) {
		inset: 8px 8px auto auto;
		width: 8px;
		height: 8px;
	}

	.loader-mark span:nth-child(2) {
		inset: auto auto 8px 8px;
		width: 8px;
		height: 8px;
		animation-delay: 180ms;
	}

	.loader-mark span:nth-child(3) {
		top: 50%;
		left: 50%;
		width: 18px;
		height: 1px;
		transform: translate(-50%, -50%) rotate(-45deg);
		opacity: 0.45;
	}

	.loading-overlay .overlay-kicker {
		color: var(--signal);
	}

	.loading-overlay h2 {
		margin: 9px 0 10px;
		font-family: var(--font-display);
		font-size: clamp(38px, 5vw, 64px);
		font-weight: 700;
		line-height: 0.84;
		letter-spacing: 0.02em;
	}

	.loading-copy {
		margin: 0;
		font-family: var(--font-mono);
		font-size: 9px;
		letter-spacing: 0.04em;
		color: var(--ink-faint);
	}

	.intro-overlay {
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		align-items: stretch;
		padding: 24px 32px;
		background:
			linear-gradient(
				90deg,
				rgba(3, 9, 12, 0.9) 0%,
				rgba(3, 9, 12, 0.66) 38%,
				rgba(3, 9, 12, 0.26) 68%,
				rgba(3, 9, 12, 0.55) 100%
			),
			linear-gradient(0deg, rgba(3, 8, 11, 0.52), transparent 30%);
		backdrop-filter: blur(1px);
	}

	.intro-overlay::before {
		content: '';
		position: absolute;
		inset: 0;
		pointer-events: none;
		background-image:
			linear-gradient(rgba(183, 205, 184, 0.035) 1px, transparent 1px),
			linear-gradient(90deg, rgba(183, 205, 184, 0.035) 1px, transparent 1px);
		background-size: 80px 80px;
		mask-image: linear-gradient(90deg, black, transparent 62%);
	}

	.intro-rail {
		display: flex;
		gap: 22px;
		font-family: var(--font-mono);
		font-size: 7px;
		letter-spacing: 0.15em;
		color: var(--ink-faint);
	}

	.intro-rail span:first-child {
		color: var(--signal);
	}

	.intro-content {
		position: relative;
		display: grid;
		grid-template-columns: minmax(0, 690px) minmax(260px, 320px);
		justify-content: space-between;
		align-items: end;
		gap: clamp(40px, 9vw, 150px);
		width: 100%;
		max-width: 1680px;
		margin: 0 auto;
		padding: 24px 0;
	}

	.intro-copy {
		max-width: 720px;
	}

	.intro-copy .overlay-kicker {
		display: flex;
		align-items: center;
		gap: 9px;
		color: var(--signal);
	}

	.kicker-line {
		width: 28px;
		height: 1px;
		background: var(--signal);
	}

	.intro-copy h2 {
		margin: 15px 0 19px;
		font-family: var(--font-display);
		font-size: clamp(66px, 9.6vw, 148px);
		font-weight: 700;
		line-height: 0.79;
		letter-spacing: -0.015em;
		text-transform: uppercase;
	}

	.intro-copy h2 em {
		font-style: normal;
		color: transparent;
		-webkit-text-stroke: 1px rgba(241, 236, 217, 0.78);
	}

	.intro-lede {
		max-width: 515px;
		margin: 0 0 27px;
		font-size: 14px;
		font-weight: 350;
		line-height: 1.65;
		color: var(--ink-dim);
	}

	.spec-strip {
		display: flex;
		flex-wrap: wrap;
		gap: 0;
		max-width: 620px;
		margin-bottom: 27px;
		border-top: 1px solid var(--line-soft);
		border-bottom: 1px solid var(--line-soft);
	}

	.spec-strip div {
		display: flex;
		flex-direction: column;
		gap: 3px;
		padding: 10px 18px;
		border-right: 1px solid var(--line-soft);
	}

	.spec-strip div:first-child {
		padding-left: 0;
	}

	.spec-strip div:last-child {
		border-right: 0;
	}

	.spec-strip strong {
		font-family: var(--font-display);
		font-size: 17px;
		font-weight: 600;
		letter-spacing: 0.04em;
		color: var(--ink);
	}

	.spec-strip span {
		font-family: var(--font-mono);
		font-size: 6.5px;
		letter-spacing: 0.1em;
		color: var(--ink-faint);
	}

	.intro-actions {
		display: flex;
		align-items: flex-end;
		gap: 20px;
		flex-wrap: wrap;
	}

	.deploy-button {
		display: inline-flex;
		align-items: center;
		justify-content: space-between;
		gap: 30px;
		min-width: 228px;
		height: 47px;
		padding: 0 17px;
		border: 1px solid var(--signal);
		background: var(--signal);
		color: #0a1310;
		font-family: var(--font-mono);
		font-size: 9px;
		font-weight: 700;
		letter-spacing: 0.12em;
		cursor: pointer;
		transition:
			background 160ms ease,
			color 160ms ease,
			transform 160ms ease;
	}

	.deploy-button svg {
		width: 16px;
		height: 16px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.2;
	}

	.deploy-button:hover:not(:disabled) {
		background: var(--signal-strong);
		transform: translateY(-1px);
	}

	.deploy-button:disabled {
		cursor: wait;
		opacity: 0.52;
	}

	.seed-loader {
		display: flex;
		flex-direction: column;
		gap: 5px;
	}

	.seed-loader label {
		font-family: var(--font-mono);
		font-size: 7px;
		letter-spacing: 0.12em;
		color: var(--ink-faint);
	}

	.seed-loader > div {
		display: flex;
		height: 30px;
	}

	.seed-loader input {
		width: 105px;
		padding: 0 8px;
		border: 1px solid var(--line-strong);
		border-right: 0;
		border-radius: 0;
		background: rgba(3, 9, 12, 0.65);
		font-family: var(--font-mono);
		font-size: 10px;
		letter-spacing: 0.12em;
		color: var(--ink);
	}

	.seed-loader button {
		padding: 0 11px;
		border: 1px solid var(--line-strong);
		background: transparent;
		font-family: var(--font-mono);
		font-size: 7px;
		letter-spacing: 0.08em;
		color: var(--ink-dim);
		cursor: pointer;
	}

	.seed-loader button:hover:not(:disabled) {
		color: var(--signal);
		border-color: var(--signal);
	}

	.seed-loader button:disabled {
		opacity: 0.35;
		cursor: wait;
	}

	.intro-footnote {
		margin: 18px 0 0;
		font-family: var(--font-mono);
		font-size: 7px;
		line-height: 1.6;
		letter-spacing: 0.03em;
		color: var(--ink-faint);
	}

	.intro-brief {
		position: relative;
		padding: 15px 16px 0;
		border: 1px solid var(--line-strong);
		background: rgba(5, 13, 18, 0.62);
		backdrop-filter: blur(16px);
	}

	.intro-brief::before,
	.result-modal::before,
	.help-modal::before,
	.error-modal::before {
		content: '';
		position: absolute;
		top: -1px;
		left: -1px;
		width: 18px;
		height: 18px;
		border-top: 1px solid var(--signal);
		border-left: 1px solid var(--signal);
	}

	.brief-head {
		display: flex;
		justify-content: space-between;
		padding-bottom: 11px;
		border-bottom: 1px solid var(--line-soft);
		font-family: var(--font-mono);
		font-size: 7px;
		letter-spacing: 0.12em;
		color: var(--ink-faint);
	}

	.brief-status {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		color: var(--signal);
	}

	.brief-status i {
		width: 4px;
		height: 4px;
		border-radius: 50%;
		background: var(--signal);
		box-shadow: 0 0 6px var(--signal);
	}

	.intro-brief h3 {
		margin: 18px 0 16px;
		font-family: var(--font-display);
		font-size: 27px;
		font-weight: 600;
		line-height: 0.94;
		letter-spacing: 0.035em;
	}

	.intro-brief ol {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.intro-brief li {
		display: flex;
		gap: 10px;
		padding: 10px 0;
		border-top: 1px solid var(--line-soft);
	}

	.intro-brief li > span {
		flex: none;
		font-family: var(--font-mono);
		font-size: 8px;
		color: var(--signal);
	}

	.intro-brief li p {
		margin: 0;
		font-size: 10px;
		line-height: 1.5;
		color: var(--ink-dim);
	}

	.brief-footer {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		margin: 8px -16px 0;
		padding: 10px 16px;
		border-top: 1px solid var(--line-soft);
		font-family: var(--font-mono);
		font-size: 7px;
		letter-spacing: 0.1em;
		color: var(--ink-faint);
	}

	.brief-footer strong {
		font-size: 10px;
		font-weight: 500;
		color: var(--ink);
	}

	.intro-footbar {
		display: flex;
		justify-content: space-between;
		gap: 20px;
		padding-top: 14px;
		border-top: 1px solid var(--line-soft);
		font-family: var(--font-mono);
		font-size: 7px;
		letter-spacing: 0.1em;
		color: var(--ink-faint);
	}

	.modal {
		position: relative;
		width: min(92vw, 680px);
		max-height: 92vh;
		overflow: auto;
		padding: clamp(28px, 4vw, 48px);
		border: 1px solid var(--line-strong);
		background: rgba(5, 13, 18, 0.94);
		box-shadow: 0 40px 120px rgba(0, 0, 0, 0.6);
		animation: modal-in 400ms 60ms ease-out both;
	}

	.modal h2 {
		margin: 12px 0 16px;
		font-family: var(--font-display);
		font-size: clamp(48px, 6vw, 80px);
		font-weight: 700;
		line-height: 0.82;
		letter-spacing: 0.01em;
	}

	.modal h2 em {
		font-style: normal;
		color: transparent;
		-webkit-text-stroke: 1px rgba(241, 236, 217, 0.76);
	}

	.modal > p {
		max-width: 540px;
		margin: 0 0 16px;
		font-size: 13px;
		line-height: 1.65;
		color: var(--ink-dim);
	}

	.error-modal {
		max-width: 590px;
	}

	.error-modal h2 {
		color: var(--danger);
	}

	.error-modal h2 em {
		-webkit-text-stroke-color: rgba(255, 120, 103, 0.8);
	}

	.error-modal pre {
		padding: 13px;
		border: 1px solid rgba(255, 120, 103, 0.22);
		background: rgba(255, 120, 103, 0.055);
		white-space: pre-wrap;
		font-family: var(--font-mono);
		font-size: 10px;
		line-height: 1.5;
		color: #ffb3a5;
	}

	.error-hint {
		font-size: 11px !important;
		color: var(--ink-faint) !important;
	}

	.error-hint a {
		color: var(--signal);
	}

	.modal-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 9px;
		margin-top: 24px;
	}

	.ghost-button {
		height: 47px;
		padding: 0 18px;
		border: 1px solid var(--line-strong);
		background: transparent;
		font-family: var(--font-mono);
		font-size: 9px;
		letter-spacing: 0.1em;
		color: var(--ink-dim);
		cursor: pointer;
		transition:
			border-color 150ms ease,
			color 150ms ease;
	}

	.ghost-button:hover {
		border-color: var(--signal);
		color: var(--signal);
	}

	.result-modal {
		width: min(92vw, 670px);
	}

	.result-modal h2 {
		font-size: clamp(56px, 7vw, 94px);
	}

	.result-lede {
		max-width: 490px;
		margin: 0 0 24px;
		font-size: 13px;
		line-height: 1.6;
		color: var(--ink-dim);
	}

	.result-stats {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		margin: 20px 0 22px;
		border-top: 1px solid var(--line-soft);
		border-bottom: 1px solid var(--line-soft);
	}

	.result-stats div {
		display: flex;
		flex-direction: column;
		gap: 5px;
		padding: 12px 14px;
		border-right: 1px solid var(--line-soft);
	}

	.result-stats div:last-child {
		border-right: 0;
	}

	.result-stats span {
		font-family: var(--font-mono);
		font-size: 6.5px;
		letter-spacing: 0.1em;
		color: var(--ink-faint);
	}

	.result-stats strong {
		font-family: var(--font-mono);
		font-size: 16px;
		font-weight: 500;
		color: var(--ink);
	}

	.result-standings {
		margin: 0 0 10px;
		padding: 0;
		list-style: none;
	}

	.result-standings li {
		display: grid;
		grid-template-columns: 26px 5px 1fr auto;
		align-items: center;
		gap: 10px;
		height: 28px;
		padding: 0 8px;
		border-bottom: 1px solid var(--line-soft);
	}

	.result-standings li.is-human {
		background: color-mix(in srgb, var(--player-color) 8%, transparent);
	}

	.result-standings span,
	.result-standings em {
		font-family: var(--font-mono);
		font-size: 8px;
		font-style: normal;
		color: var(--ink-faint);
	}

	.result-standings i {
		width: 5px;
		height: 12px;
		background: var(--player-color);
	}

	.result-standings b {
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 500;
		letter-spacing: 0.04em;
	}

	.defeat-modal h2 {
		color: #ff8f7d;
	}

	.defeat-modal h2 em {
		-webkit-text-stroke-color: rgba(255, 143, 125, 0.8);
	}

	.help-overlay {
		z-index: 80;
	}

	.help-modal {
		width: min(96vw, 900px);
		max-height: 92vh;
		padding: clamp(24px, 3.5vw, 42px);
	}

	.help-head {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 20px;
		padding-bottom: 20px;
		border-bottom: 1px solid var(--line-soft);
	}

	.help-head h2 {
		margin-bottom: 0;
		font-size: clamp(44px, 5vw, 66px);
	}

	.close-manual {
		flex: none;
		font-size: 20px;
		line-height: 1;
	}

	.manual-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0;
		margin-top: 4px;
	}

	.manual-grid section {
		padding: 22px 26px 20px 0;
		border-bottom: 1px solid var(--line-soft);
	}

	.manual-grid section:nth-child(even) {
		padding-left: 26px;
		border-left: 1px solid var(--line-soft);
	}

	.manual-grid section:nth-last-child(-n + 2) {
		border-bottom: 0;
	}

	.manual-index {
		font-family: var(--font-mono);
		font-size: 7px;
		letter-spacing: 0.13em;
		color: var(--signal);
	}

	.manual-grid h3 {
		margin: 8px 0 8px;
		font-family: var(--font-display);
		font-size: 25px;
		font-weight: 600;
		line-height: 1;
		letter-spacing: 0.02em;
	}

	.manual-grid p {
		margin: 0;
		font-size: 11.5px;
		line-height: 1.65;
		color: var(--ink-dim);
	}

	.manual-footer {
		display: flex;
		flex-wrap: wrap;
		gap: 17px;
		margin-top: 20px;
		padding-top: 14px;
		border-top: 1px solid var(--line-soft);
		font-family: var(--font-mono);
		font-size: 7px;
		letter-spacing: 0.07em;
		color: var(--ink-faint);
	}

	.manual-footer span:last-child {
		margin-left: auto;
	}

	.upgrade-tooltip {
		position: fixed;
		z-index: 130;
		transform: translate(-50%, calc(-100% - 14px));
		display: grid;
		gap: 2px;
		min-width: 132px;
		padding: 7px 10px 8px;
		border: 1px solid rgba(255, 214, 144, 0.4);
		background: rgba(5, 14, 18, 0.94);
		box-shadow: 0 12px 30px rgba(0, 0, 0, 0.45);
		font-family: var(--font-mono);
		font-size: 6.5px;
		letter-spacing: 0.08em;
		color: var(--ink-faint);
		pointer-events: none;
		backdrop-filter: blur(12px);
	}

	.upgrade-tooltip span {
		color: var(--ink-dim);
	}

	.upgrade-tooltip strong {
		font-family: var(--font-display);
		font-size: 18px;
		line-height: 1;
		letter-spacing: 0.02em;
		color: #ffd690;
	}

	.upgrade-tooltip strong small {
		margin-left: 3px;
		font-family: var(--font-mono);
		font-size: 5.5px;
		letter-spacing: 0.1em;
		color: var(--ink-faint);
	}

	.upgrade-tooltip i {
		font-style: normal;
		font-size: 6px;
		color: var(--ink-dim);
	}

	.upgrade-tooltip em {
		font-style: normal;
		font-size: 5.5px;
		letter-spacing: 0.1em;
		color: var(--danger);
	}

	.upgrade-tooltip.insufficient {
		border-color: rgba(255, 120, 103, 0.5);
	}

	.toast {
		position: fixed;
		z-index: 120;
		left: 50%;
		bottom: 258px;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 9px;
		padding: 10px 15px;
		border: 1px solid rgba(220, 233, 149, 0.36);
		background: rgba(5, 14, 15, 0.92);
		box-shadow: 0 16px 44px rgba(0, 0, 0, 0.35);
		font-family: var(--font-mono);
		font-size: 9px;
		letter-spacing: 0.03em;
		color: var(--ink);
		backdrop-filter: blur(15px);
		animation: toast-in 220ms ease-out both;
	}

	.toast i {
		width: 4px;
		height: 4px;
		border-radius: 50%;
		background: var(--signal);
		box-shadow: 0 0 7px var(--signal);
	}

	.toast-error {
		border-color: rgba(255, 120, 103, 0.45);
	}

	.toast-error i {
		background: var(--danger);
		box-shadow: 0 0 7px var(--danger);
	}

	.toast-warn {
		border-color: rgba(255, 209, 102, 0.4);
	}

	.toast-warn i {
		background: #ffd166;
		box-shadow: 0 0 7px #ffd166;
	}

	@keyframes hud-in {
		from {
			opacity: 0;
			transform: translateY(-6px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@keyframes hud-fade {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes veil-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes modal-in {
		from {
			opacity: 0;
			transform: translateY(12px) scale(0.985);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}

	@keyframes toast-in {
		from {
			opacity: 0;
			transform: translate(-50%, 8px);
		}
		to {
			opacity: 1;
			transform: translate(-50%, 0);
		}
	}

	@keyframes loader-pulse {
		0%,
		100% {
			opacity: 0.3;
		}
		50% {
			opacity: 1;
		}
	}

	@media (max-width: 1180px) {
		.topbar {
			grid-template-columns: minmax(170px, 1fr) auto minmax(220px, 1fr);
			gap: 10px;
		}

		.commander {
			min-width: 112px;
			padding: 0 11px;
		}

		.readout-stat {
			min-width: 62px;
			padding: 0 10px;
		}

		.readout-stat > span {
			font-size: 6px;
		}

		.action-button span {
			display: none;
		}

		.pause-button {
			width: 36px;
			justify-content: center;
			padding: 0;
		}

		.right-rail {
			width: 272px;
		}

		.intro-content {
			grid-template-columns: minmax(0, 610px) minmax(240px, 290px);
			gap: 40px;
		}

		.intro-copy h2 {
			font-size: clamp(64px, 9.4vw, 120px);
		}

		.build-card {
			width: 138px;
			height: 198px;
		}

		.card-title {
			font-size: 15px;
		}

		.card-art {
			height: 64px;
		}

		.card-rules {
			font-size: 8px;
		}

		.economy-readout {
			width: 104px;
		}
	}

	@media (max-width: 900px) {
		.topbar {
			inset: 12px 14px auto;
			grid-template-columns: 1fr auto;
		}

		.brand-lockup {
			display: none;
		}

		.command-readout {
			justify-self: start;
		}

		.commander {
			display: none;
		}

		.top-actions {
			height: 42px;
		}

		.right-rail,
		.growth-switcher,
		.clock-block {
			display: none;
		}

		.minimap-dock {
			left: 14px;
			top: 64px;
			bottom: auto;
			width: 150px;
		}

		.map-tools {
			right: 14px;
			bottom: 202px;
		}

		.perf-readout {
			display: none;
		}

		.card-tray {
			left: 8px;
			right: 8px;
			width: auto;
			max-width: none;
			transform: none;
			justify-content: safe center;
			overflow-x: auto;
			scrollbar-width: none;
		}

		.card-tray::-webkit-scrollbar {
			display: none;
		}

		.map-tools .tool-wide {
			width: 36px;
		}

		.intro-overlay {
			padding: 18px;
			overflow-y: auto;
		}

		.intro-content {
			grid-template-columns: 1fr;
			align-content: center;
			align-items: start;
			gap: 28px;
			min-height: 100%;
			padding: 40px 0 20px;
		}

		.intro-copy h2 {
			font-size: clamp(58px, 14vw, 100px);
		}

		.intro-brief {
			max-width: 520px;
		}

		.intro-footbar {
			display: none;
		}

		.intro-rail {
			display: none;
		}

		.intro-lede {
			font-size: 13px;
		}

		.manual-grid {
			grid-template-columns: 1fr;
		}

		.manual-grid section:nth-child(even) {
			padding-left: 0;
			border-left: 0;
		}

		.manual-grid section:nth-last-child(2) {
			border-bottom: 1px solid var(--line-soft);
		}

		.result-stats {
			grid-template-columns: 1fr 1fr;
		}

		.result-stats div:nth-child(2) {
			border-right: 0;
		}

		.result-stats div:nth-child(-n + 2) {
			border-bottom: 1px solid var(--line-soft);
		}

		.card-tray {
			bottom: 10px;
			max-width: calc(100vw - 16px);
			gap: 8px;
			padding: 0;
		}

		.hand-row {
			gap: 7px;
			padding-bottom: 8px;
		}

		.build-card {
			width: 116px;
			height: 174px;
		}

		.card-face {
			padding: 8px;
		}

		.card-title {
			font-size: 14px;
		}

		.card-art {
			height: 56px;
		}

		.card-art-icon {
			width: 40px;
			height: 40px;
		}

		.card-rules {
			font-size: 7.5px;
		}

		.economy-readout {
			width: 96px;
			margin-bottom: 18px;
			padding: 8px 7px;
		}

		.paused-flag {
			top: 72px;
			font-size: 7px;
		}
	}

	@media (max-width: 620px) {
		.topbar {
			grid-template-columns: 1fr auto;
		}

		.readout-stat:nth-child(4) {
			display: none;
		}

		.new-world-button {
			display: none;
		}

		.command-readout {
			height: 42px;
		}

		.readout-stat strong {
			font-size: 12px;
		}

		.card-tray {
			bottom: 8px;
			justify-content: flex-start;
			max-width: calc(100vw - 16px);
			overflow-x: auto;
			gap: 7px;
			padding: 0 2px;
		}

		.hand-row {
			gap: 6px;
			padding-bottom: 6px;
		}

		.build-card {
			width: 98px;
			height: 150px;
		}

		.card-face {
			padding: 6px;
		}

		.card-banner {
			min-height: 22px;
			font-size: 5px;
		}

		.card-cost {
			width: 25px;
			height: 28px;
			margin-top: -5px;
			margin-right: -4px;
			padding-top: 2px;
		}

		.card-cost b {
			font-size: 12px;
		}

		.card-title {
			margin-bottom: 3px;
			font-size: 12px;
		}

		.card-art {
			height: 44px;
			margin-bottom: 3px;
		}

		.card-art::before {
			width: 54px;
			height: 54px;
		}

		.card-art-icon {
			width: 32px;
			height: 32px;
		}

		.card-type {
			margin-bottom: 2px;
			padding-bottom: 2px;
			font-size: 4.8px;
		}

		.card-rules {
			font-size: 6.5px;
			line-height: 1.22;
		}

		.card-footer {
			display: none;
		}

		.economy-readout {
			width: 88px;
			margin-bottom: 14px;
			padding: 7px 6px;
		}

		.economy-row strong {
			font-size: 21px;
		}

		.toast {
			bottom: 172px;
		}

		.minimap-dock {
			display: none;
		}

		.map-tools {
			gap: 4px;
		}

		.minimap-meta {
			display: none;
		}

		.spec-strip div {
			padding: 8px 10px;
		}

		.spec-strip div:first-child {
			padding-left: 0;
		}

		.spec-strip strong {
			font-size: 14px;
		}

		.intro-actions {
			align-items: stretch;
			flex-direction: column;
		}

		.deploy-button {
			width: 100%;
		}

		.toast {
			bottom: 120px;
			width: calc(100vw - 40px);
			justify-content: center;
			text-align: center;
		}
	}

	@media (max-width: 480px) {
		.card-tray {
			gap: 6px;
		}

		.hand-row {
			gap: 4px;
		}

		.build-card {
			width: 82px;
			height: 132px;
		}

		.card-face {
			padding: 5px;
		}

		.card-banner {
			min-height: 19px;
			font-size: 4.4px;
		}

		.card-cost {
			width: 22px;
			height: 25px;
			margin-top: -4px;
			margin-right: -3px;
		}

		.card-cost b {
			font-size: 10px;
		}

		.card-title {
			font-size: 10px;
			margin-bottom: 2px;
		}

		.card-art {
			height: 34px;
			margin-bottom: 2px;
		}

		.card-art::before {
			width: 40px;
			height: 40px;
		}

		.card-art-icon {
			width: 24px;
			height: 24px;
		}

		.card-type {
			font-size: 4.1px;
			margin-bottom: 1px;
			padding-bottom: 1px;
		}

		.card-rules {
			font-size: 5.8px;
			line-height: 1.18;
		}

		.economy-readout {
			width: 68px;
			padding: 6px 5px;
			margin-bottom: 12px;
		}

		.economy-row span {
			font-size: 5.5px;
		}

		.economy-row strong {
			font-size: 18px;
		}

		.economy-orders b,
		.economy-defense b {
			font-size: 9px;
		}

		.economy-readout small {
			font-size: 5px;
		}
	}

	.keyboard-cursor {
		position: absolute;
		z-index: 18;
		width: 34px;
		height: 34px;
		transform: translate(-50%, -50%);
		border: 2px solid rgba(61, 219, 217, 0.96);
		border-radius: 50%;
		background: radial-gradient(circle, rgba(61, 219, 217, 0.2), transparent 68%);
		box-shadow:
			0 0 0 2px rgba(3, 8, 13, 0.88),
			0 0 24px rgba(61, 219, 217, 0.62);
		pointer-events: none;
	}

	.keyboard-cursor::before,
	.keyboard-cursor::after {
		content: '';
		position: absolute;
		background: rgba(61, 219, 217, 0.94);
	}

	.keyboard-cursor::before {
		left: 50%;
		top: -9px;
		width: 1px;
		height: 50px;
		transform: translateX(-50%);
	}

	.keyboard-cursor::after {
		top: 50%;
		left: -9px;
		height: 1px;
		width: 50px;
		transform: translateY(-50%);
	}

	.keyboard-cursor span {
		position: absolute;
		inset: 13px;
		border-radius: 50%;
		background: #d9ffff;
	}

	.onboarding-hint {
		position: fixed;
		top: 94px;
		left: 50%;
		z-index: 26;
		width: min(430px, calc(100vw - 28px));
		padding: 13px 15px 14px;
		transform: translateX(-50%);
		background: rgba(9, 19, 23, 0.95);
		border: 1px solid rgba(220, 233, 149, 0.42);
		box-shadow: 0 16px 44px rgba(0, 0, 0, 0.42);
		backdrop-filter: blur(16px);
		animation: hint-in 220ms ease-out both;
	}

	.onboarding-meta {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		color: var(--ink-faint);
		font-size: 7px;
		letter-spacing: 0.16em;
	}

	.onboarding-meta button {
		padding: 2px 0;
		background: none;
		border: 0;
		color: var(--ink-faint);
		font: inherit;
		letter-spacing: 0.16em;
		cursor: pointer;
	}

	.onboarding-meta button:hover {
		color: var(--ink);
	}

	.onboarding-hint h2 {
		margin: 7px 0 5px;
		color: var(--ink);
		font-size: 17px;
		font-weight: 600;
		letter-spacing: 0.06em;
	}

	.onboarding-hint p {
		margin: 0;
		color: var(--ink-dim);
		font-size: 10px;
		line-height: 1.45;
	}

	@keyframes hint-in {
		from {
			opacity: 0;
			transform: translate(-50%, -6px);
		}
		to {
			opacity: 1;
			transform: translate(-50%, 0);
		}
	}

	@media (max-width: 620px) {
		.onboarding-hint {
			top: 74px;
			padding: 11px 13px 12px;
		}

		.onboarding-hint h2 {
			font-size: 15px;
		}

		.onboarding-hint p {
			font-size: 9px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		*,
		*::before,
		*::after {
			animation-duration: 0.01ms !important;
			animation-iteration-count: 1 !important;
			scroll-behavior: auto !important;
			transition-duration: 0.01ms !important;
		}
	}
</style>
