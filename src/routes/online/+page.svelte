<script lang="ts">
	import { onMount } from 'svelte';
	import GameCanvas from '#lib/components/GameCanvas.svelte';
	import { GameCameraBridge } from '#lib/game/render/camera-bridge';
	import { RemoteEvolutionSimulation } from '#lib/game/ai/evolution-view';
	import type { WorkerMatchInit } from '#lib/game/ai/evolution-worker-protocol';
	import { generateMap } from '#lib/game/map';
	import { MAP_HEIGHT, MAP_WIDTH, TICK_RATE, colorForPlayer } from '#lib/game/constants';
	import { STRUCTURE_DEFINITIONS, type BuildableStructureType } from '#lib/game/Structures';
	import type { GameSnapshot, TerritorySimulation } from '#lib/game/simulation';
	import {
		decodeByteRuns,
		decodeOwnerRuns,
		type OnlineBaseline,
		type OnlineIntent,
		type OnlineRoomListEntry,
		type OnlineRoomView,
		type OnlineTick
	} from '#lib/game/net/online-protocol';

	interface Visual {
		revision: number;
		tick: number;
		snapshot: GameSnapshot;
		changes: Uint32Array;
		changeCount: number;
		overflow: boolean;
		districtTiles: number[];
	}

	const DEFAULT_CONFIG = {
		totalStates: 8,
		maxHumans: 4,
		seed: 0,
		botDifficulty: 'standard' as const,
		timerMinutes: 0,
		botCommandPostStacks: 0
	};

	let displayName = $state('Commander');
	let roomCodeInput = $state('');
	let config = $state({ ...DEFAULT_CONFIG });
	let room = $state<OnlineRoomView | null>(null);
	let roomList = $state<OnlineRoomListEntry[]>([]);
	let playerId = $state(0);
	let token = $state('');
	let status = $state('Create a room or join with a code.');
	let busy = $state(false);
	let connected = $state(false);
	let subscribed = false;
	let eventSource: EventSource | null = null;
	let remoteView = $state<RemoteEvolutionSimulation | null>(null);
	let snapshot = $state<GameSnapshot | null>(null);
	let visuals = $state<Visual[]>([]);
	let revision = 0;
	let cameraBridge = new GameCameraBridge();
	let selectedCardId = $state<number | null>(null);
	let artilleryMode = $state(false);
	let intentSequence = 0;
	let shareUrl = $state('');

	const currentPlayer = $derived(
		room && playerId > 0 ? room.seats.find((seat) => seat.playerId === playerId) : undefined
	);
	const isHost = $derived(currentPlayer?.host === true);
	const running = $derived(room?.phase === 'running');
	const completed = $derived(room?.phase === 'completed');
	const humanCards = $derived(snapshot?.hand ?? []);
	const playableCards = $derived(
		humanCards.map((card) => ({
			...card,
			definition: STRUCTURE_DEFINITIONS[card.type as BuildableStructureType],
			cost: STRUCTURE_DEFINITIONS[card.type as BuildableStructureType].cost,
			affordable: (snapshot?.supply ?? 0) >= STRUCTURE_DEFINITIONS[card.type].cost
		}))
	);
	const alivePlayers = $derived(snapshot?.players.filter((player) => player.alive) ?? []);
	const seatSlots = $derived(
		room ? Array.from({ length: room.config.maxHumans }, (_, index) => index) : []
	);
	const supplyLabel = $derived(
		snapshot ? `${Math.floor(snapshot.supply)} / ${Math.floor(snapshot.supplyCap)}` : '—'
	);

	function storageKey(roomId: string): string {
		return `territory.online.${roomId}`;
	}

	function saveSession(roomId: string, nextPlayerId: number, nextToken: string): void {
		try {
			sessionStorage.setItem(
				storageKey(roomId),
				JSON.stringify({ playerId: nextPlayerId, token: nextToken, sequence: intentSequence })
			);
		} catch {
			// Session storage may be unavailable in private mode.
		}
	}

	function loadSession(
		roomId: string
	): { playerId: number; token: string; sequence: number } | null {
		try {
			const raw = sessionStorage.getItem(storageKey(roomId));
			return raw ? JSON.parse(raw) : null;
		} catch {
			return null;
		}
	}

	function persistSequence(): void {
		if (room) saveSession(room.roomId, playerId, token);
	}

	async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
		const response = await fetch(path, {
			...options,
			headers: {
				'content-type': 'application/json',
				...(token ? { 'x-online-token': token } : {}),
				...options.headers
			}
		});
		const body = await response.json();
		if (!response.ok) throw new Error(body?.error ?? 'Request failed.');
		return body as T;
	}

	async function refreshRooms(): Promise<void> {
		try {
			const body = await api<{ rooms: OnlineRoomListEntry[] }>('/api/online/rooms');
			roomList = body.rooms;
		} catch {
			roomList = [];
		}
	}

	async function createRoom(): Promise<void> {
		busy = true;
		try {
			const body = await api<{
				roomId: string;
				playerId: number;
				token: string;
				room: OnlineRoomView;
			}>('/api/online/rooms', {
				method: 'POST',
				body: JSON.stringify({
					displayName,
					config: {
						totalStates: config.totalStates,
						maxHumans: config.maxHumans,
						botDifficulty: config.botDifficulty,
						timerMinutes: config.timerMinutes,
						botCommandPostStacks: config.botCommandPostStacks
					}
				})
			});
			playerId = body.playerId;
			token = body.token;
			room = body.room;
			intentSequence = 0;
			saveSession(body.roomId, playerId, token);
			setShareUrl(body.roomId);
			subscribe();
		} catch (error) {
			status = error instanceof Error ? error.message : 'Could not create the room.';
		} finally {
			busy = false;
		}
	}

	async function joinRoomWithCode(code = roomCodeInput): Promise<void> {
		const value = code.trim();
		if (!value) return;
		busy = true;
		try {
			const body = await api<{
				roomId: string;
				playerId: number;
				token: string;
				room: OnlineRoomView;
			}>(`/api/online/rooms/${encodeURIComponent(value)}/join`, {
				method: 'POST',
				body: JSON.stringify({ displayName })
			});
			playerId = body.playerId;
			token = body.token;
			room = body.room;
			intentSequence = 0;
			saveSession(body.roomId, playerId, token);
			setShareUrl(body.roomId);
			subscribe();
		} catch (error) {
			status = error instanceof Error ? error.message : 'Could not join the room.';
		} finally {
			busy = false;
		}
	}

	async function startMatch(): Promise<void> {
		if (!room || !isHost) return;
		busy = true;
		try {
			const body = await api<{ room: OnlineRoomView }>(`/api/online/rooms/${room.roomId}/start`, {
				method: 'POST'
			});
			room = body.room;
		} catch (error) {
			status = error instanceof Error ? error.message : 'Could not start the match.';
		} finally {
			busy = false;
		}
	}

	function setShareUrl(roomId: string): void {
		if (typeof window === 'undefined') return;
		const url = new URL(window.location.href);
		url.searchParams.set('room', roomId);
		shareUrl = url.toString();
		history.replaceState(null, '', url);
	}

	function closeEvents(): void {
		eventSource?.close();
		eventSource = null;
		connected = false;
		subscribed = false;
	}

	function subscribe(): void {
		if (!room || !token) return;
		closeEvents();
		const source = new EventSource(
			`/api/online/rooms/${encodeURIComponent(room.roomId)}/events?token=${encodeURIComponent(token)}`
		);
		eventSource = source;
		subscribed = true;
		source.onopen = () => {
			connected = true;
			status = 'Connected to the match server.';
		};
		source.onerror = () => {
			connected = false;
			status = 'Connection interrupted. Reconnecting…';
		};
		source.onmessage = (message) => {
			try {
				handleServerEvent(JSON.parse(message.data));
			} catch {
				// Ignore malformed events rather than desynchronising silently.
			}
		};
	}

	function handleServerEvent(event: unknown): void {
		if (!event || typeof event !== 'object') return;
		const typed = event as {
			type?: string;
			room?: OnlineRoomView;
			baseline?: OnlineBaseline;
			tick?: OnlineTick;
		};
		if (typed.type === 'room' && typed.room) {
			room = typed.room;
			return;
		}
		if (typed.type === 'welcome' && typed.baseline) {
			applyBaseline(typed.baseline);
			return;
		}
		if (typed.type === 'tick' && typed.tick) {
			applyTick(typed.tick);
			return;
		}
		if (typed.type === 'complete' && typed.room) {
			room = typed.room;
			status = typed.room.winnerId ? 'Match complete.' : 'Match complete.';
		}
	}

	function applyBaseline(baseline: OnlineBaseline): void {
		playerId = baseline.playerId;
		const map = generateMap(baseline.config.seed, {
			playerCount: baseline.config.totalStates,
			width: MAP_WIDTH,
			height: MAP_HEIGHT
		});
		const owners = decodeOwnerRuns(baseline.ownerRuns, map.width * map.height);
		const districtColorCodes = decodeByteRuns(baseline.districtColorRuns, map.width * map.height);
		const init: WorkerMatchInit = {
			width: map.width,
			height: map.height,
			starts: map.starts,
			terrain: map.land,
			terrainShade: map.shade,
			terrainElevation: map.elevation,
			owners,
			districtColorCodes,
			snapshot: baseline.snapshot
		};
		remoteView = new RemoteEvolutionSimulation(init);
		snapshot = baseline.snapshot;
		visuals = [];
		revision = 0;
		const stored = room ? loadSession(room.roomId) : null;
		if (stored && stored.sequence > intentSequence) intentSequence = stored.sequence;
	}

	function applyTick(tick: OnlineTick): void {
		if (!remoteView) {
			subscribe();
			return;
		}
		if (tick.changesOverflow) {
			subscribe();
			return;
		}
		const changes = Uint32Array.from(tick.changes);
		const districtTiles = tick.districtTiles;
		const districtTileColors =
			tick.districtTileColors.length > 0 ? Uint8Array.from(tick.districtTileColors) : null;
		remoteView.applyVisual({
			matchId: 1,
			tick: tick.tick,
			snapshot: tick.snapshot,
			changes,
			changeCount: changes.length,
			overflow: false,
			owners: null,
			districtColorCodes: null,
			districtTiles,
			districtTileColors,
			markovStates: []
		});
		snapshot = tick.snapshot;
		revision++;
		visuals = [
			...visuals,
			{
				revision,
				tick: tick.tick,
				snapshot: tick.snapshot,
				changes,
				changeCount: changes.length,
				overflow: false,
				districtTiles
			}
		].slice(-8);
	}

	function acknowledgeVisuals(lastRevision: number): void {
		visuals = visuals.filter((visual) => visual.revision > lastRevision);
	}

	async function sendIntent(intent: OnlineIntent): Promise<void> {
		if (!room) return;
		intentSequence++;
		persistSequence();
		try {
			const result = await api<{ ok: boolean; message: string }>(
				`/api/online/rooms/${room.roomId}/intent`,
				{
					method: 'POST',
					body: JSON.stringify({ sequence: intentSequence, intent })
				}
			);
			if (!result.ok) status = result.message;
		} catch (error) {
			status = error instanceof Error ? error.message : 'Command failed.';
		}
	}

	function handleCanvasClick(x: number, y: number): void {
		if (!running) return;
		if (selectedCardId !== null) {
			void sendIntent({ type: 'build', cardId: selectedCardId, x, y });
			selectedCardId = null;
			return;
		}
		if (artilleryMode) {
			void sendIntent({ type: 'artillery', x, y });
			artilleryMode = false;
			return;
		}
		const owner =
			remoteView && x >= 0 && y >= 0 && x < remoteView.width && y < remoteView.height
				? remoteView.getOwner(Math.floor(x), Math.floor(y))
				: 0;
		if (owner === playerId) {
			void sendIntent({ type: 'upgrade', x, y, levels: 1, merged: true });
			return;
		}
		void sendIntent({ type: 'attack', x, y });
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (!running) return;
		if (event.key === 'Escape') {
			selectedCardId = null;
			artilleryMode = false;
			return;
		}
		if (event.key >= '1' && event.key <= '7') {
			const card = playableCards[Number(event.key) - 1];
			if (card) {
				selectedCardId = card.id;
				artilleryMode = false;
			}
		}
	}

	onMount(() => {
		window.addEventListener('keydown', handleKeydown);
		const roomParam = new URLSearchParams(window.location.search).get('room');
		if (roomParam) {
			roomCodeInput = roomParam;
			const stored = loadSession(roomParam);
			if (stored) {
				token = stored.token;
				playerId = stored.playerId;
				intentSequence = stored.sequence;
				void api<{ room: OnlineRoomView }>(`/api/online/rooms/${roomParam}`)
					.then((body) => {
						room = body.room;
						setShareUrl(roomParam);
						subscribe();
					})
					.catch((error) => {
						status = error instanceof Error ? error.message : 'Match not found.';
					});
			}
		} else {
			void refreshRooms();
		}
		return () => {
			window.removeEventListener('keydown', handleKeydown);
			closeEvents();
		};
	});

	function leaveOnline(): void {
		closeEvents();
		room = null;
		remoteView = null;
		snapshot = null;
		visuals = [];
		playerId = 0;
		token = '';
		selectedCardId = null;
		artilleryMode = false;
		status = 'Left the room.';
	}
</script>

<svelte:head>
	<title>TERRITORY — Online</title>
</svelte:head>

<main class="online-shell" oncontextmenu={(event) => event.preventDefault()}>
	<header class="online-header">
		<div>
			<p class="eyebrow">TERRITORY / AUTHORITATIVE ONLINE</p>
			<h1>{room ? (room.phase === 'waiting' ? 'MUSTER' : 'LIVE MATCH') : 'ONLINE'}</h1>
		</div>
		<div class="header-actions">
			{#if room}
				<span class="connection" class:live={connected}>
					{connected ? 'SERVER LINK' : 'RECONNECTING'}
				</span>
				<button class="ghost" type="button" onclick={leaveOnline}>LEAVE</button>
			{:else}
				<a class="ghost" href="/">LOCAL GAME</a>
			{/if}
		</div>
	</header>

	{#if !room}
		<section class="lobby">
			<div class="panel">
				<p class="label">COMMANDER NAME</p>
				<input bind:value={displayName} maxlength="24" placeholder="Commander" />
				<div class="config-grid">
					<label>
						<span>STATES</span>
						<select bind:value={config.totalStates}>
							{#each [4, 6, 8, 12, 16] as count}
								<option value={count}>{count}</option>
							{/each}
						</select>
					</label>
					<label>
						<span>HUMAN SEATS</span>
						<select bind:value={config.maxHumans}>
							{#each [2, 3, 4] as count}
								<option value={count}>{count}</option>
							{/each}
						</select>
					</label>
					<label>
						<span>DIFFICULTY</span>
						<select bind:value={config.botDifficulty}>
							<option value="relaxed">RELAXED</option>
							<option value="standard">STANDARD</option>
							<option value="ruthless">RUTHLESS</option>
						</select>
					</label>
					<label>
						<span>TIMER</span>
						<select bind:value={config.timerMinutes}>
							<option value={0}>NONE</option>
							<option value={10}>10 MIN</option>
							<option value={20}>20 MIN</option>
							<option value={30}>30 MIN</option>
						</select>
					</label>
				</div>
				<button class="primary" type="button" onclick={createRoom} disabled={busy}>
					CREATE ROOM
				</button>
			</div>

			<div class="panel">
				<p class="label">JOIN WITH CODE</p>
				<input bind:value={roomCodeInput} placeholder="Room code" />
				<button class="primary" type="button" onclick={() => joinRoomWithCode()} disabled={busy}>
					JOIN ROOM
				</button>
				{#if roomList.length > 0}
					<p class="label room-list-label">OPEN ROOMS</p>
					{#each roomList as entry (entry.roomId)}
						<button class="room-row" type="button" onclick={() => joinRoomWithCode(entry.roomId)}>
							<strong>{entry.roomId}</strong>
							<span>{entry.humanCount}/{entry.maxHumans} HUMANS · {entry.totalStates} STATES</span>
						</button>
					{/each}
				{/if}
			</div>

			<div class="panel notes">
				<p class="label">HOW IT WORKS</p>
				<p>
					The server owns the simulation and advances it at 10 Hz. Your browser renders
					authoritative snapshots and sends intents; bots fill every unfilled seat.
				</p>
				<p class="muted">{status}</p>
			</div>
		</section>
	{:else if room.phase === 'waiting'}
		<section class="lobby">
			<div class="panel">
				<p class="label">ROOM CODE</p>
				<div class="room-code">{room.roomId}</div>
				<input readonly value={shareUrl} onfocus={(event) => event.currentTarget.select()} />
				<div class="seat-list">
					{#each seatSlots as index (index)}
						{@const seat = room.seats[index]}
						<div class="seat" class:empty={!seat}>
							<span>{seat ? seat.name : 'OPEN SLOT'}</span>
							<small>
								{seat ? (seat.host ? 'HOST' : 'HUMAN') : 'BOT IF EMPTY'}
							</small>
						</div>
					{/each}
				</div>
				{#if isHost}
					<button class="primary" type="button" onclick={startMatch} disabled={busy}>
						START MATCH
					</button>
				{:else}
					<p class="muted">Waiting for the host to start.</p>
				{/if}
			</div>
		</section>
	{:else}
		<div class="match-layout">
			<div class="canvas-wrap">
				{#if remoteView}
					{#key remoteView}
						<GameCanvas
							simulation={remoteView as unknown as TerritorySimulation}
							paused={!running}
							simulate={false}
							remoteVisuals={visuals}
							onRemoteVisualsApplied={acknowledgeVisuals}
							targeting={artilleryMode}
							humanPlayerId={playerId}
							{cameraBridge}
							cameraFocus="map"
							onAttack={handleCanvasClick}
						/>
					{/key}
				{/if}
				{#if completed}
					<div class="result">
						<p class="label">MATCH COMPLETE</p>
						<h2>
							{snapshot?.winnerId
								? `${snapshot.players[snapshot.winnerId - 1]?.name ?? 'STATE'} WINS`
								: 'STALEMATE'}
						</h2>
						<button class="primary" type="button" onclick={leaveOnline}>BACK TO LOBBY</button>
					</div>
				{/if}
			</div>
			<aside class="sidebar">
				<div class="stat">
					<span>SUPPLY</span>
					<strong>{supplyLabel}</strong>
				</div>
				<div class="stat">
					<span>TICK</span>
					<strong>{snapshot?.tick ?? room.tick}</strong>
				</div>
				<div class="actions">
					<button
						class="ghost"
						class:active={artilleryMode}
						type="button"
						onclick={() => {
							artilleryMode = !artilleryMode;
							selectedCardId = null;
						}}
					>
						FIRE
					</button>
					<button class="ghost" type="button" onclick={() => sendIntent({ type: 'cancel-attack' })}>
						CANCEL FRONT
					</button>
				</div>
				<p class="label">BUILD CARDS</p>
				<div class="cards">
					{#each playableCards as card, index (card.id)}
						<button
							class="card"
							class:selected={selectedCardId === card.id}
							class:unaffordable={!card.affordable}
							type="button"
							onclick={() => {
								selectedCardId = card.id;
								artilleryMode = false;
							}}
						>
							<span>{index + 1}</span>
							<strong>{card.definition.label}</strong>
							<small>{card.cost}S</small>
						</button>
					{/each}
				</div>
				<p class="label">STATES / {alivePlayers.length} ALIVE</p>
				<div class="players">
					{#each alivePlayers as player (player.id)}
						<div class="player" class:you={player.id === playerId}>
							<span class="swatch" style={`background:${colorForPlayer(player.id).hex}`}></span>
							<span>{player.name}</span>
							<small>{Math.floor(player.territory).toLocaleString()}</small>
						</div>
					{/each}
				</div>
				<p class="muted">{status}</p>
			</aside>
		</div>
	{/if}
</main>

<style>
	:global(:root) {
		color-scheme: dark;
	}
	:global(body) {
		margin: 0;
		background: #060c10;
		color: #e7efe6;
		font-family: ui-monospace, monospace;
	}
	.online-shell {
		min-height: 100vh;
		background:
			radial-gradient(circle at 20% 10%, rgba(61, 219, 217, 0.08), transparent 35%), #060c10;
	}
	.online-header {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		padding: 18px 22px;
		border-bottom: 1px solid rgba(130, 170, 160, 0.18);
	}
	.eyebrow,
	.label {
		margin: 0;
		color: #7f9b96;
		font-size: 9px;
		letter-spacing: 0.14em;
	}
	h1 {
		margin: 4px 0 0;
		font-size: 26px;
		letter-spacing: 0.08em;
	}
	.header-actions {
		display: flex;
		gap: 10px;
		align-items: center;
	}
	.connection {
		color: #ffb46d;
		font-size: 9px;
		letter-spacing: 0.1em;
	}
	.connection.live {
		color: #92e3a5;
	}
	.lobby {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 16px;
		padding: 22px;
		max-width: 1180px;
		margin: 0 auto;
	}
	.panel {
		border: 1px solid rgba(130, 170, 160, 0.22);
		background: rgba(9, 20, 25, 0.8);
		padding: 18px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	input,
	select,
	button {
		font: inherit;
	}
	input,
	select {
		width: 100%;
		padding: 9px 10px;
		border: 1px solid rgba(130, 170, 160, 0.28);
		background: #071218;
		color: #e7efe6;
	}
	.config-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
	}
	.config-grid label {
		display: flex;
		flex-direction: column;
		gap: 5px;
		font-size: 8px;
		color: #7f9b96;
		letter-spacing: 0.1em;
	}
	button {
		cursor: pointer;
	}
	.primary,
	.ghost {
		padding: 10px 12px;
		border: 1px solid rgba(130, 170, 160, 0.4);
		background: #0c1c22;
		color: #e7efe6;
		letter-spacing: 0.08em;
		font-size: 10px;
	}
	.primary {
		background: #d7e78b;
		color: #101a14;
		font-weight: 800;
	}
	.ghost:hover,
	.ghost.active {
		border-color: #3ddbd9;
		color: #3ddbd9;
	}
	button:disabled {
		opacity: 0.45;
		cursor: wait;
	}
	.room-code {
		font-size: 30px;
		letter-spacing: 0.16em;
		color: #d7e78b;
	}
	.seat-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.seat {
		display: flex;
		justify-content: space-between;
		padding: 8px 10px;
		border: 1px solid rgba(130, 170, 160, 0.18);
	}
	.seat.empty {
		opacity: 0.45;
	}
	.seat small,
	.player small {
		color: #7f9b96;
	}
	.room-row {
		display: flex;
		justify-content: space-between;
		padding: 8px 10px;
		background: transparent;
		border: 1px solid rgba(130, 170, 160, 0.18);
		color: #e7efe6;
		text-align: left;
	}
	.room-row span {
		color: #7f9b96;
		font-size: 9px;
	}
	.notes p {
		line-height: 1.6;
		font-size: 11px;
		color: #c1d1ca;
	}
	.muted {
		color: #7f9b96;
		font-size: 10px;
		line-height: 1.5;
	}
	.match-layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 280px;
		height: calc(100vh - 78px);
	}
	.canvas-wrap {
		position: relative;
		min-width: 0;
	}
	.sidebar {
		border-left: 1px solid rgba(130, 170, 160, 0.2);
		padding: 14px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		overflow: auto;
		background: rgba(6, 14, 19, 0.96);
	}
	.stat {
		display: flex;
		justify-content: space-between;
		border-bottom: 1px solid rgba(130, 170, 160, 0.14);
		padding-bottom: 6px;
		font-size: 9px;
		color: #7f9b96;
	}
	.stat strong {
		color: #e7efe6;
		font-size: 13px;
	}
	.actions {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
	}
	.cards {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 6px;
	}
	.card {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 2px 6px;
		align-items: center;
		padding: 7px;
		background: #0a171d;
		border: 1px solid rgba(130, 170, 160, 0.25);
		color: #e7efe6;
		text-align: left;
	}
	.card span {
		grid-row: span 2;
		color: #7f9b96;
		font-size: 9px;
	}
	.card strong {
		font-size: 8px;
		letter-spacing: 0.02em;
	}
	.card small {
		color: #d7e78b;
		font-size: 8px;
	}
	.card.selected {
		border-color: #3ddbd9;
		box-shadow: inset 0 0 0 1px #3ddbd9;
	}
	.card.unaffordable {
		opacity: 0.45;
	}
	.players {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.player {
		display: grid;
		grid-template-columns: 8px 1fr auto;
		gap: 7px;
		align-items: center;
		font-size: 9px;
	}
	.player.you {
		color: #d7e78b;
	}
	.swatch {
		width: 8px;
		height: 8px;
		border-radius: 50%;
	}
	.result {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 14px;
		background: rgba(3, 9, 13, 0.82);
		backdrop-filter: blur(6px);
	}
	.result h2 {
		margin: 0;
		font-size: 28px;
	}
	@media (max-width: 850px) {
		.lobby {
			grid-template-columns: 1fr;
		}
		.match-layout {
			grid-template-columns: 1fr;
			height: auto;
		}
		.canvas-wrap {
			height: 62vh;
		}
	}
</style>
