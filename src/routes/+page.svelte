<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import GameCanvas from '#lib/components/GameCanvas.svelte';
	import Minimap from '#lib/components/Minimap.svelte';
	import {
		ATTACK_LIFETIME_TICKS,
		ELEVATION_NAMES,
		HUMAN_PLAYER_ID,
		MAX_ATTACKS_PER_PLAYER,
		MAP_HEIGHT,
		MAP_WIDTH,
		PLAYER_COUNT,
		REFRESH_COST,
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
	import { STRUCTURE_DEFINITIONS, type PublicCard } from '#lib/game/structures';
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
	let defeatOpen = $state(false);
	let defeatHandled = $state(false);
	let hover = $state<HoverState | null>(null);
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
	let growthMode = $state<GrowthMode>(DEFAULT_GROWTH_MODE);
	let draggingCardId = $state<number | null>(null);

	const RANK_ROW_HEIGHT = 28;
	const RANK_OVERSCAN = 3;

	let toastTimer: ReturnType<typeof setTimeout> | undefined;
	let worldTimer: ReturnType<typeof setTimeout> | undefined;
	let toastSequence = 0;

	const cameraBridge = new GameCameraBridge();
	cameraBridge.onView = (view) => {
		cameraView = view;
	};

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
	let activeHumanAttacks = $derived(
		snapshot && human
			? snapshot.attacks.filter((attack) => attack.attackerId === human.id).length
			: 0
	);
	let winner = $derived(
		snapshot?.winnerId
			? (snapshot.players.find((player) => player.id === snapshot?.winnerId) ?? null)
			: null
	);
	let showResult = $derived(Boolean(gameStarted && snapshot?.ended));
	let seedHex = $derived(currentSeed.toString(16).toUpperCase().padStart(8, '0'));
	let canDeploy = $derived(phase === 'ready' && rendererReady && sim !== null);
	let matchClock = $derived(formatClock((snapshot?.tick ?? 0) / TICK_RATE));
	let hoverTitle = $derived.by(() => {
		if (!hover) return 'NO TARGET';
		if (!hover.land) return 'OPEN WATER';
		if (hover.owner === 0) return 'UNCLAIMED LAND';
		const ownerId = hover.owner;
		const owner = snapshot?.players.find((player) => player.id === ownerId);
		return owner ? `${owner.name} TERRITORY` : 'UNKNOWN TERRITORY';
	});
	let hoverSub = $derived.by(() => {
		if (!hover) return 'Move the cursor over the atlas.';
		if (!hover.land) return 'Ocean cannot be claimed.';
		if (hover.owner === 0) return 'Unclaimed terrain — base defense still applies.';
		if (hover.owner === snapshot?.humanId) return 'Friendly territory.';
		return 'Hostile frontier. Click to order an assault.';
	});
	let hoverCoords = $derived(
		hover
			? `${String(hover.x).padStart(4, '0')} : ${String(hover.y).padStart(4, '0')}`
			: '---- : ----'
	);
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
		growthMode = DEFAULT_GROWTH_MODE;
		draggingCardId = null;
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
		paused = false;
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
			showToast('Simulation paused. Resume to issue orders.', 'warn');
			return;
		}
		const result = sim.enqueueAttack(HUMAN_PLAYER_ID, x, y);
		showToast(result.message, result.ok ? 'success' : 'error');
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
		showToast(`${GROWTH_LABELS[mode]} growth selected for new orders.`, 'success');
	}

	function cardDefinition(card: PublicCard) {
		return STRUCTURE_DEFINITIONS[card.type];
	}

	function startCardDrag(event: DragEvent, card: PublicCard): void {
		draggingCardId = card.id;
		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = 'move';
			event.dataTransfer.setData('text/plain', String(card.id));
		}
	}

	function endCardDrag(): void {
		draggingCardId = null;
	}

	function handleDragOver(event: DragEvent): void {
		if (draggingCardId === null) return;
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
	}

	function handleCardDrop(event: DragEvent): void {
		event.preventDefault();
		const rawCardId = event.dataTransfer?.getData('text/plain');
		const cardId = rawCardId ? Number(rawCardId) : draggingCardId;
		draggingCardId = null;
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
	}

	function refreshHand(): void {
		if (!sim) return;
		if (paused || defeatOpen || snapshot?.ended) {
			showToast('Resume the simulation before refreshing.', 'warn');
			return;
		}
		const result = sim.refreshCards(HUMAN_PLAYER_ID);
		showToast(result.message, result.ok ? 'success' : 'error');
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

	function handleKeydown(event: KeyboardEvent): void {
		const target = event.target as HTMLElement | null;
		if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;

		if (event.key === 'Escape') {
			if (showHelp) showHelp = false;
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
		}
	}

	onMount(() => {
		window.addEventListener('keydown', handleKeydown);
		createWorld(readSeedFromLocation());

		return () => {
			window.removeEventListener('keydown', handleKeydown);
			clearTimeout(worldTimer);
			clearTimeout(toastTimer);
			cameraBridge.onView = undefined;
		};
	});
</script>

<svelte:head>
	<title>TERRITORY — Attack stress test</title>
</svelte:head>

<main class="game-shell" ondragover={handleDragOver} ondrop={handleCardDrop}>
	{#if sim}
		{#key sim}
			<GameCanvas
				simulation={sim}
				{paused}
				{cameraBridge}
				onTick={handleTick}
				onHover={handleHover}
				onAttack={handleAttack}
				onReady={handleReady}
				onError={handleError}
				onPerf={handlePerf}
			/>
		{/key}
	{/if}

	<div class="map-atmosphere" aria-hidden="true"></div>

	{#if gameStarted && !showIntro && phase === 'ready' && sim && snapshot && human}
		<header class="hud topbar">
			<div class="brand-lockup">
				<div class="brand-mark" aria-hidden="true"><span></span></div>
				<div class="brand-type">
					<p class="eyebrow">ATTACK STRESS / {PLAYER_COUNT} STATES</p>
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

		<div class="status-console hud">
			<div class="coords-block">
				<span class="status-label">GRID REF</span>
				<strong>{hoverCoords}</strong>
			</div>
			<div class="target-block">
				<span class="status-label">
					{#if hover && hover.land && hover.owner === human.id}FRIENDLY
					{:else if hover && hover.land && hover.owner !== 0}HOSTILE
					{:else if hover && hover.land}NEUTRAL
					{:else}RECON
					{/if}
				</span>
				<strong>{hoverTitle}</strong>
				<small>{hoverSub}</small>
			</div>
			<div class="orders-block">
				<span class="status-label">ORDERS</span>
				<strong>{activeHumanAttacks}<em>/{MAX_ATTACKS_PER_PLAYER}</em></strong>
			</div>
			<div class="defense-block">
				<span class="status-label">DEFENSE</span>
				<strong>{hover?.land ? hover.defense : '—'}</strong>
				<small>
					{hover?.land
						? `${ELEVATION_NAMES[hover.elevation]} / B${hover.baseDefense}${
								hover.auraDefense > 0 ? ` / AURA +${hover.auraDefense}` : ''
							}`
						: '—'}
				</small>
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

		<div class="growth-switcher hud" aria-label="Growth layer for new attack orders">
			<span class="growth-label">GROWTH / NEW ORDERS</span>
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
				<span>GOLD</span>
				<strong>{snapshot.gold}</strong>
				<small>+{snapshot.income} / 10s</small>
			</div>

			<div class="hand-row">
				{#each [0, 1, 2] as slot (`slot-${slot}`)}
					{@const card = snapshot.hand[slot]}
					{#if card}
						{@const definition = cardDefinition(card)}
						<article
							class="build-card"
							class:unaffordable={snapshot.gold < definition.cost}
							class:dragging={draggingCardId === card.id}
							draggable="true"
							ondragstart={(event) => startCardDrag(event, card)}
							ondragend={endCardDrag}
							title={`Drag ${definition.label} into your territory`}
						>
							<div class="build-card-head">
								<span>{definition.label}</span>
								<b>{definition.cost}g</b>
							</div>
							<div class="build-card-body">
								<span class="build-card-icon" aria-hidden="true">
									{#if card.type === 'mine'}
										<svg viewBox="0 0 24 24">
											<path d="M4 20 16 8M12 4c3 0 6 1 8 4M8 8c2-2 6-3 9-2" />
										</svg>
									{:else if card.type === 'barracks'}
										<svg viewBox="0 0 24 24">
											<path d="M5 19 19 5M8 5l11 11M5 16l3 3M16 5l3 3" />
										</svg>
									{:else}
										<svg viewBox="0 0 24 24">
											<path d="M12 3 19 6v5c0 5-3 8-7 10-4-2-7-5-7-10V6z" />
										</svg>
									{/if}
								</span>
								<p>{definition.description}</p>
							</div>
						</article>
					{:else}
						<div class="build-card empty">
							<span>EMPTY</span>
						</div>
					{/if}
				{/each}
			</div>

			<button
				type="button"
				class="refresh-button"
				onclick={refreshHand}
				disabled={snapshot.gold < REFRESH_COST}
				title="Replace your hand with three new cards"
			>
				<span>REFRESH</span>
				<small>{REFRESH_COST}g</small>
			</button>
		</div>

		{#if draggingCardId !== null}
			<div class="build-drop-hint hud">DROP CARD INSIDE CONTROLLED TERRITORY</div>
		{/if}

		<div class="key-hints hud">
			<span><kbd>DRAG</kbd> PAN</span>
			<span><kbd>SCROLL</kbd> ZOOM</span>
			<span><kbd>CLICK</kbd> ATTACK</span>
			<span><kbd>SPACE</kbd> {paused ? 'RESUME' : 'PAUSE'}</span>
			<span><kbd>F</kbd> FIT</span>
			<span><kbd>C</kbd> FOCUS</span>
		</div>

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
						<span class="kicker-line"></span>ATTACK SYSTEM / STRESS BUILD
					</p>
					<h2 id="intro-title">DRAW THE<br /><em>FRONTIER.</em></h2>
					<p class="intro-lede">
						Free, resource-free attacks are the experiment. Launch fronts into neutral land or rival
						states and watch {PLAYER_COUNT} deterministic actors fight over the same pixel atlas.
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
						Attack stress prototype: {PLAYER_COUNT - 1} AI states attack automatically while you build
						from a small gold/card economy. This is not the intended final combat model. Share a seed
						to replay the same test.
					</p>
				</div>

				<aside class="intro-brief">
					<div class="brief-head">
						<span>FIELD BRIEF / 01</span>
						<span class="brief-status"><i></i>{rendererReady ? 'READY' : 'LINKING'}</span>
					</div>
					<h3>ATTACK IS<br />THE ONLY VERB.</h3>
					<ol>
						<li>
							<span>01</span>
							<p>Click any land touching your frontier to open a free attack.</p>
						</li>
						<li>
							<span>02</span>
							<p>Each front lasts at most {ATTACK_LIFETIME_TICKS / TICK_RATE} seconds.</p>
						</li>
						<li>
							<span>03</span>
							<p>Every state attacks at once. Build cards and terrain defense shape the front.</p>
						</li>
					</ol>
					<div class="brief-footer">
						<span>MAP SEED</span>
						<strong>{seedHex}</strong>
					</div>
				</aside>
			</div>

			<div class="intro-footbar">
				<span>BUILD 0.8.0 / PROTOCOL 12</span>
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
						Every land pixel flies your colour. The frontier is closed.
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
						<p class="overlay-kicker">FIELD MANUAL / ATTACK STRESS</p>
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
						<span class="manual-index">01 / THE EXPERIMENT</span>
						<h3>Cards, gold, and fronts.</h3>
						<p>
							Troops and production caps are removed. The human commander earns 1 gold every 10
							seconds and draws three build cards; drag a card into controlled territory to build a
							Mine, Barracks, or Defense Post. Terrain matters: base defense is 1 plus the elevation
							tier, occupied pixels add 1 more, and each front spends 30 attack points per tick.
							State auras add another 20 defense. This is still not the final combat design.
						</p>
					</section>
					<section>
						<span class="manual-index">02 / ORDERS</span>
						<h3>Click a shared frontier.</h3>
						<p>
							Click neutral ground or a rival's border near your territory. A free front opens there
							and consumes up to 30 connected target pixels per tick. Up to three fronts may run at
							once. Each order expires after {ATTACK_LIFETIME_TICKS / TICK_RATE} seconds, and a severed
							front peters out immediately. If two states attack each other and their fronts touch, every
							order between them cancels and the contact line becomes the border. Each state begins with
							a State structure at its capital, marked by a circled star; territory connected to it cannot
							be annexed, and its aura adds 20 defense to surrounding pixels. The HUD growth switch selects
							the frontier layer for new orders: circular, smooth, or organic. Existing orders keep the
							layer they started with.
						</p>
					</section>
					<section>
						<span class="manual-index">03 / CAMERA</span>
						<h3>Read the whole atlas.</h3>
						<p>
							Drag to pan, scroll to zoom at the pointer, or use <kbd>F</kbd> to fit the world and
							<kbd>C</kbd> to return to your frontier. Click the minimap to jump anywhere.
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

	.status-console {
		left: 50%;
		bottom: 22px;
		transform: translateX(-50%);
		display: flex;
		align-items: stretch;
		height: 50px;
		border: 1px solid var(--line-strong);
		background: rgba(5, 13, 18, 0.8);
		backdrop-filter: blur(18px);
		box-shadow: 0 18px 50px rgba(0, 0, 0, 0.28);
		animation: hud-in 600ms 220ms ease-out both;
	}

	.coords-block,
	.orders-block,
	.defense-block {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 4px;
		padding: 0 16px;
		min-width: 110px;
	}

	.orders-block {
		min-width: 70px;
		border-left: 1px solid var(--line-soft);
	}

	.defense-block {
		min-width: 82px;
		padding: 0 13px;
		border-left: 1px solid var(--line-soft);
	}

	.defense-block strong {
		font-family: var(--font-mono);
		font-size: 13px;
		font-weight: 600;
		color: #ffd690;
	}

	.defense-block small {
		font-family: var(--font-mono);
		font-size: 7px;
		letter-spacing: 0.04em;
		color: var(--ink-faint);
		white-space: nowrap;
	}

	.target-block {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 2px;
		width: clamp(190px, 18vw, 280px);
		padding: 0 18px;
		border-left: 1px solid var(--line-soft);
		border-right: 1px solid var(--line-soft);
		background: rgba(255, 255, 255, 0.018);
	}

	.status-label {
		font-family: var(--font-mono);
		font-size: 6.5px;
		letter-spacing: 0.14em;
		color: var(--ink-faint);
	}

	.coords-block strong,
	.orders-block strong {
		font-family: var(--font-mono);
		font-size: 12px;
		font-weight: 500;
		letter-spacing: 0.03em;
		color: var(--ink-dim);
	}

	.orders-block strong {
		color: var(--signal);
	}

	.orders-block strong em {
		font-style: normal;
		color: var(--ink-faint);
	}

	.target-block strong {
		overflow: hidden;
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 500;
		letter-spacing: 0.06em;
		color: var(--ink);
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.target-block small {
		overflow: hidden;
		font-size: 9px;
		line-height: 1.25;
		color: var(--ink-faint);
		white-space: nowrap;
		text-overflow: ellipsis;
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
		bottom: 150px;
		transform: translateX(-50%);
		display: flex;
		align-items: stretch;
		gap: 10px;
		padding: 7px;
		border: 1px solid var(--line-strong);
		background: rgba(5, 13, 18, 0.88);
		backdrop-filter: blur(16px);
		box-shadow: 0 18px 50px rgba(0, 0, 0, 0.3);
		animation: hud-in 600ms 200ms ease-out both;
	}

	.economy-readout {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 2px;
		width: 64px;
		padding: 0 8px;
		border-right: 1px solid var(--line-soft);
	}

	.economy-readout span,
	.build-card-head span,
	.refresh-button span {
		font-family: var(--font-mono);
		font-size: 6.5px;
		letter-spacing: 0.12em;
		color: var(--ink-faint);
	}

	.economy-readout strong {
		font-family: var(--font-display);
		font-size: 20px;
		line-height: 0.9;
		color: #ffd690;
	}

	.economy-readout small {
		font-family: var(--font-mono);
		font-size: 7px;
		color: var(--ink-dim);
	}

	.hand-row {
		display: flex;
		gap: 6px;
	}

	.build-card {
		display: flex;
		flex-direction: column;
		gap: 5px;
		width: 136px;
		height: 76px;
		padding: 6px 8px;
		border: 1px solid var(--line-strong);
		background: rgba(255, 255, 255, 0.035);
		cursor: grab;
		user-select: none;
		transition:
			border-color 140ms ease,
			background 140ms ease,
			opacity 140ms ease;
	}

	.build-card:hover {
		border-color: var(--signal);
		background: rgba(255, 255, 255, 0.06);
	}

	.build-card.dragging {
		opacity: 0.35;
	}

	.build-card.unaffordable {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.build-card-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 6px;
	}

	.build-card-head b {
		font-family: var(--font-mono);
		font-size: 9px;
		color: #ffd690;
	}

	.build-card-body {
		display: flex;
		align-items: center;
		gap: 7px;
		min-height: 0;
	}

	.build-card-icon {
		display: grid;
		place-items: center;
		flex: none;
		width: 25px;
		height: 25px;
		border: 1px solid var(--line-soft);
		color: #f7eed0;
	}

	.build-card-icon svg {
		width: 17px;
		height: 17px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.build-card p {
		margin: 0;
		overflow: hidden;
		font-size: 8px;
		line-height: 1.3;
		color: var(--ink-dim);
	}

	.build-card.empty {
		align-items: center;
		justify-content: center;
		border-style: dashed;
		color: var(--ink-faint);
		font-family: var(--font-mono);
		font-size: 7px;
		letter-spacing: 0.12em;
		cursor: default;
	}

	.refresh-button {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 3px;
		width: 62px;
		border: 1px solid var(--line-soft);
		background: transparent;
		cursor: pointer;
		transition:
			border-color 140ms ease,
			color 140ms ease;
	}

	.refresh-button small {
		font-family: var(--font-mono);
		font-size: 8px;
		color: #ffd690;
	}

	.refresh-button:hover:not(:disabled) {
		border-color: var(--signal);
	}

	.refresh-button:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	.build-drop-hint {
		left: 50%;
		bottom: 246px;
		transform: translateX(-50%);
		padding: 8px 12px;
		border: 1px dashed rgba(255, 214, 144, 0.6);
		background: rgba(5, 13, 18, 0.86);
		font-family: var(--font-mono);
		font-size: 8px;
		letter-spacing: 0.1em;
		color: #ffd690;
		pointer-events: none;
	}

	.growth-switcher {
		left: 50%;
		bottom: 112px;
		transform: translateX(-50%);
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

	.key-hints {
		left: 50%;
		bottom: 82px;
		transform: translateX(-50%);
		display: flex;
		gap: 15px;
		white-space: nowrap;
		font-family: var(--font-mono);
		font-size: 7px;
		letter-spacing: 0.07em;
		color: var(--ink-faint);
		opacity: 0.8;
		animation: hud-in 800ms 500ms ease-out both;
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
		top: 82px;
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
			width: 116px;
		}

		.build-card p {
			font-size: 7.5px;
		}

		.economy-readout {
			width: 56px;
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
		.key-hints,
		.growth-switcher,
		.clock-block {
			display: none;
		}

		.minimap-dock {
			left: 14px;
			bottom: 14px;
			width: 200px;
		}

		.status-console {
			bottom: 14px;
			height: 45px;
		}

		.target-block {
			width: 180px;
		}

		.coords-block {
			min-width: 94px;
			padding: 0 11px;
		}

		.orders-block {
			min-width: 58px;
			padding: 0 10px;
		}

		.defense-block {
			min-width: 62px;
			padding: 0 9px;
		}

		.map-tools {
			right: 14px;
			bottom: 14px;
		}

		.perf-readout {
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
			bottom: 74px;
			max-width: calc(100vw - 24px);
			gap: 6px;
			padding: 5px;
		}

		.build-card {
			width: 108px;
			height: 70px;
		}

		.build-card p {
			font-size: 7px;
		}

		.economy-readout {
			width: 54px;
			padding: 0 6px;
		}

		.refresh-button {
			width: 56px;
		}

		.build-drop-hint {
			bottom: 170px;
		}

		.status-console {
			left: auto;
			right: 72px;
			transform: none;
			max-width: calc(100vw - 300px);
		}

		.coords-block {
			display: none;
		}

		.target-block {
			width: auto;
			min-width: 160px;
			border-left: 0;
		}

		.paused-flag {
			top: 66px;
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
			bottom: 68px;
			justify-content: flex-start;
			overflow-x: auto;
		}

		.build-card {
			width: 96px;
			height: 68px;
		}

		.build-card p {
			display: none;
		}

		.economy-readout {
			width: 48px;
			padding: 0 4px;
		}

		.refresh-button {
			width: 50px;
		}

		.build-drop-hint {
			bottom: 158px;
		}

		.toast {
			bottom: 160px;
		}

		.status-console {
			right: 60px;
			bottom: 14px;
			max-width: calc(100vw - 272px);
			min-width: 0;
		}

		.target-block {
			min-width: 0;
			width: auto;
			padding: 0 10px;
		}

		.target-block small {
			display: none;
		}

		.target-block strong {
			font-size: 8px;
		}

		.orders-block {
			display: none;
		}

		.defense-block {
			min-width: 54px;
			padding: 0 7px;
		}

		.defense-block small {
			display: none;
		}

		.minimap-dock {
			width: 180px;
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
