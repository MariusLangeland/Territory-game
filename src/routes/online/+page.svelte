<script lang="ts">
	import GameCanvas from '#lib/components/GameCanvas.svelte';
	import { colorForPlayer } from '#lib/game/constants';
	import { createOnlinePage } from '#lib/game/online/page/online-page.svelte';

	const online = createOnlinePage();
</script>

<svelte:head>
	<title>TERRITORY — Online</title>
</svelte:head>

<main class="online-shell" oncontextmenu={(event) => event.preventDefault()}>
	<header class="online-header">
		<div>
			<p class="eyebrow">TERRITORY / AUTHORITATIVE ONLINE</p>
			<h1>
				{online.room ? (online.room.phase === 'waiting' ? 'MUSTER' : 'LIVE MATCH') : 'ONLINE'}
			</h1>
		</div>
		<div class="header-actions">
			{#if online.room}
				<span class="connection" class:live={online.connected}>
					{online.connected ? 'SERVER LINK' : 'RECONNECTING'}
				</span>
				<button class="ghost" type="button" onclick={online.leaveOnline}>LEAVE</button>
			{:else}
				<a class="ghost" href="/">LOCAL GAME</a>
			{/if}
		</div>
	</header>

	{#if !online.room}
		<section class="lobby">
			<div class="panel">
				<p class="label">COMMANDER NAME</p>
				<input bind:value={online.displayName} maxlength="24" placeholder="Commander" />
				<div class="config-grid">
					<label>
						<span>STATES</span>
						<select bind:value={online.config.totalStates}>
							{#each [8, 12, 16, 24, 32] as count}
								<option value={count}>{count}</option>
							{/each}
						</select>
					</label>
					<label>
						<span>HUMAN SEATS</span>
						<select bind:value={online.config.maxHumans}>
							{#each [2, 4, 6, 8] as count}
								<option value={count}>{count}</option>
							{/each}
						</select>
					</label>
					<label>
						<span>DIFFICULTY</span>
						<select bind:value={online.config.botDifficulty}>
							<option value="relaxed">RELAXED</option>
							<option value="standard">STANDARD</option>
							<option value="ruthless">RUTHLESS</option>
						</select>
					</label>
					<label>
						<span>TIMER</span>
						<select bind:value={online.config.timerMinutes}>
							<option value={0}>NONE</option>
							<option value={10}>10 MIN</option>
							<option value={20}>20 MIN</option>
							<option value={30}>30 MIN</option>
						</select>
					</label>
				</div>
				<button class="primary" type="button" onclick={online.createRoom} disabled={online.busy}>
					CREATE ROOM
				</button>
			</div>

			<div class="panel">
				<p class="label">JOIN WITH CODE</p>
				<input bind:value={online.roomCodeInput} placeholder="Room code" />
				<button
					class="primary"
					type="button"
					onclick={() => online.joinRoomWithCode()}
					disabled={online.busy}
				>
					JOIN ROOM
				</button>
				{#if online.roomList.length > 0}
					<p class="label room-list-label">OPEN ROOMS</p>
					{#each online.roomList as entry (entry.roomId)}
						<button
							class="room-row"
							type="button"
							onclick={() => online.joinRoomWithCode(entry.roomId)}
						>
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
				<p class="muted">{online.status}</p>
			</div>
		</section>
	{:else if online.room.phase === 'waiting'}
		<section class="lobby">
			<div class="panel">
				<p class="label">ROOM CODE</p>
				<div class="room-code">{online.room.roomId}</div>
				<input readonly value={online.shareUrl} onfocus={(event) => event.currentTarget.select()} />
				<div class="seat-list">
					{#each online.seatSlots as index (index)}
						{@const seat = online.room.seats[index]}
						<div class="seat" class:empty={!seat}>
							<span>{seat ? seat.name : 'OPEN SLOT'}</span>
							<small>
								{seat ? (seat.host ? 'HOST' : 'HUMAN') : 'BOT IF EMPTY'}
							</small>
						</div>
					{/each}
				</div>
				{#if online.isHost}
					<button class="primary" type="button" onclick={online.startMatch} disabled={online.busy}>
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
				{#if online.remoteView}
					{#key online.remoteView}
						<GameCanvas
							simulation={online.remoteView}
							paused={!online.running}
							simulate={false}
							remoteVisuals={online.visuals}
							onRemoteVisualsApplied={online.acknowledgeVisuals}
							targeting={online.artilleryMode}
							humanPlayerId={online.playerId}
							cameraBridge={online.cameraBridge}
							cameraFocus="map"
							onAttack={online.handleCanvasClick}
						/>
					{/key}
				{/if}
				{#if online.completed}
					<div class="result">
						<p class="label">MATCH COMPLETE</p>
						<h2>
							{online.snapshot?.winnerId
								? `${online.snapshot.players[online.snapshot.winnerId - 1]?.name ?? 'STATE'} WINS`
								: 'STALEMATE'}
						</h2>
						<button class="primary" type="button" onclick={online.leaveOnline}>
							BACK TO LOBBY
						</button>
					</div>
				{/if}
			</div>
			<aside class="sidebar">
				<div class="stat">
					<span>SUPPLY</span>
					<strong>{online.supplyLabel}</strong>
				</div>
				<div class="stat">
					<span>TICK</span>
					<strong>{online.snapshot?.tick ?? online.room.tick}</strong>
				</div>
				<div class="actions">
					<button
						class="ghost"
						class:active={online.artilleryMode}
						type="button"
						onclick={online.toggleArtillery}
					>
						FIRE
					</button>
					<button class="ghost" type="button" onclick={online.cancelFront}>CANCEL FRONT</button>
				</div>
				<p class="label">BUILD CARDS</p>
				<div class="cards">
					{#each online.playableCards as card, index (card.id)}
						<button
							class="card"
							class:selected={online.selectedCardId === card.id}
							class:unaffordable={!card.affordable}
							type="button"
							onclick={() => online.selectCard(card.id)}
						>
							<span>{index + 1}</span>
							<strong>{card.definition.label}</strong>
							<small>{card.cost}S</small>
						</button>
					{/each}
				</div>
				<p class="label">STATES / {online.alivePlayers.length} ALIVE</p>
				<div class="players">
					{#each online.alivePlayers as player (player.id)}
						<div class="player" class:you={player.id === online.playerId}>
							<span class="swatch" style={`background:${colorForPlayer(player.id).hex}`}></span>
							<span>{player.name}</span>
							<small>{Math.floor(player.territory).toLocaleString()}</small>
						</div>
					{/each}
				</div>
				<p class="muted">{online.status}</p>
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
		background: var(--bg-online);
		color: var(--ink);
		font-family: ui-monospace, monospace;
	}
	.online-shell {
		min-height: 100vh;
		background:
			radial-gradient(circle at 20% 10%, rgba(61, 219, 217, 0.08), transparent 35%),
			var(--bg-online);
	}
	.online-header {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		padding: 18px 22px;
		border-bottom: 1px solid var(--online-line);
	}
	.eyebrow,
	.label {
		margin: 0;
		color: var(--ink-dim);
		font-size: var(--text-9);
		letter-spacing: 0.14em;
	}
	h1 {
		margin: 4px 0 0;
		font-size: var(--text-26);
		letter-spacing: 0.08em;
	}
	.header-actions {
		display: flex;
		gap: 10px;
		align-items: center;
	}
	.connection {
		color: var(--warning);
		font-size: var(--text-9);
		letter-spacing: 0.1em;
	}
	.connection.live {
		color: var(--success);
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
		background: var(--bg-raised);
		color: var(--ink);
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
		font-size: var(--text-8);
		color: var(--ink-dim);
		letter-spacing: 0.1em;
	}
	button {
		cursor: pointer;
	}
	.primary,
	.ghost {
		padding: 10px 12px;
		border: 1px solid rgba(130, 170, 160, 0.4);
		background: var(--bg-online-panel);
		color: var(--ink);
		letter-spacing: 0.08em;
		font-size: var(--text-10);
	}
	.primary {
		background: var(--signal);
		color: #101a14;
		font-weight: 800;
	}
	.ghost:hover,
	.ghost.active {
		border-color: var(--accent-teal);
		color: var(--accent-teal);
	}
	button:disabled {
		opacity: 0.45;
		cursor: wait;
	}
	.room-code {
		font-size: var(--text-30);
		letter-spacing: 0.16em;
		color: var(--signal);
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
		border: 1px solid var(--online-line);
	}
	.seat.empty {
		opacity: 0.45;
	}
	.seat small,
	.player small {
		color: var(--ink-dim);
	}
	.room-row {
		display: flex;
		justify-content: space-between;
		padding: 8px 10px;
		background: transparent;
		border: 1px solid var(--online-line);
		color: var(--ink);
		text-align: left;
	}
	.room-row span {
		color: var(--ink-dim);
		font-size: var(--text-9);
	}
	.notes p {
		line-height: 1.6;
		font-size: var(--text-11);
		color: #c1d1ca;
	}
	.muted {
		color: var(--ink-dim);
		font-size: var(--text-10);
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
		font-size: var(--text-9);
		color: var(--ink-dim);
	}
	.stat strong {
		color: var(--ink);
		font-size: var(--text-13);
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
		color: var(--ink);
		text-align: left;
	}
	.card span {
		grid-row: span 2;
		color: var(--ink-dim);
		font-size: var(--text-9);
	}
	.card strong {
		font-size: var(--text-8);
		letter-spacing: 0.02em;
	}
	.card small {
		color: var(--signal);
		font-size: var(--text-8);
	}
	.card.selected {
		border-color: var(--accent-teal);
		box-shadow: inset 0 0 0 1px var(--accent-teal);
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
		font-size: var(--text-9);
	}
	.player.you {
		color: var(--signal);
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
		font-size: var(--text-28);
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
