<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import type { RoomDefinition } from '#lib/spacetime/room-definition';
	import {
		connectRoomLobby,
		type AcceptedTransaction,
		type LobbySeat,
		type LobbySnapshot,
		type RoomLobbySession
	} from '#lib/spacetime/room-session';

	interface Props {
		room: RoomDefinition;
		onCancel: () => void;
		onStarted: (session: RoomLobbySession, seats: LobbySeat[]) => void;
		onTransaction: (transaction: AcceptedTransaction) => void;
		onAvailability: (available: boolean, message?: string) => void;
	}

	let { room, onCancel, onStarted, onTransaction, onAvailability }: Props = $props();

	let session = $state<RoomLobbySession | null>(null);
	let lobby = $state<LobbySnapshot | null>(null);
	let connecting = $state(true);
	let starting = $state(false);
	let error = $state('');
	let handedOff = false;

	onMount(() => {
		let disposed = false;
		connectRoomLobby({
			room,
			onLobby: (snapshot) => {
				if (!disposed) lobby = snapshot;
			},
			onFirstTick: () => {
				if (disposed || handedOff) return;
				const current = session;
				if (!current) return;
				handedOff = true;
				onStarted(current, seats);
			},
			onTransaction,
			onAvailability
		})
			.then((connected) => {
				if (disposed) {
					connected.disconnect();
					return;
				}
				session = connected;
				connecting = false;
			})
			.catch((cause) => {
				if (disposed) return;
				connecting = false;
				error = cause instanceof Error ? cause.message : 'Could not connect to the room.';
			});
		return () => {
			disposed = true;
			if (!handedOff) session?.disconnect();
		};
	});

	onDestroy(() => {
		if (!handedOff) session?.disconnect();
	});

	const seats = $derived(lobby?.seats ?? []);
	const allReady = $derived(seats.length > 0 && seats.every((seat) => seat.ready));
	const localSeat = $derived(
		session ? seats.find((seat) => seat.playerId === session?.playerId) : undefined
	);

	async function toggleReady(): Promise<void> {
		if (!session || !localSeat) return;
		error = '';
		try {
			await session.setReady(!localSeat.ready);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Could not update readiness.';
		}
	}

	async function start(): Promise<void> {
		if (!session || !session.isHost || !allReady || starting) return;
		starting = true;
		error = '';
		try {
			await session.startMatch();
		} catch (cause) {
			starting = false;
			error = cause instanceof Error ? cause.message : 'Could not start the match.';
		}
	}

	function cancel(): void {
		session?.disconnect();
		session = null;
		onCancel();
	}
</script>

<section class="room-lobby" aria-label="Room lobby">
	<header class="lobby-head">
		<div>
			<span class="eyebrow">
				ROOM / {room.databaseName.replace('territory-room-', '').toUpperCase()}
			</span>
			<h1>{room.name}</h1>
			<p>{room.description}</p>
		</div>
		<button class="leave" type="button" onclick={cancel}>LEAVE LOBBY</button>
	</header>

	{#if connecting}
		<div class="lobby-status">
			<span class="pulse"></span>
			CONNECTING TO ROOM DATABASE…
		</div>
	{:else if error}
		<div class="lobby-error">
			<strong>ROOM ERROR</strong>
			<p>{error}</p>
			<button type="button" onclick={cancel}>BACK TO ROOMS</button>
		</div>
	{:else}
		<div class="lobby-grid">
			<div class="seat-panel">
				<div class="panel-head">
					<span>COMMANDERS</span>
					<span>{seats.length} / {room.settings.states}</span>
				</div>
				<div class="seats">
					{#each seats as seat (seat.playerId)}
						<div class="seat" class:local={seat.playerId === session?.playerId}>
							<span class="seat-index">{String(seat.playerId).padStart(3, '0')}</span>
							<span class="seat-name">{seat.name}</span>
							{#if seat.isHost}<em>HOST</em>{/if}
							{#if seat.playerId === session?.playerId}<em>YOU</em>{/if}
							<span class="seat-ready" class:ready={seat.ready}>
								{seat.ready ? 'READY' : 'WAITING'}
							</span>
						</div>
					{/each}
				</div>
				<p class="seat-note">
					Current lobby size can grow until the host starts. Participation locks on the first tick.
				</p>
			</div>

			<div class="rules-panel">
				<div class="panel-head"><span>MATCH RULES</span></div>
				<dl>
					<div>
						<dt>STATES</dt>
						<dd>{room.settings.states}</dd>
					</div>
					<div>
						<dt>ATLAS</dt>
						<dd>{room.settings.mapWidth} × {room.settings.mapHeight}</dd>
					</div>
					<div>
						<dt>DIFFICULTY</dt>
						<dd>{room.settings.difficulty.toUpperCase()}</dd>
					</div>
					<div>
						<dt>WAR CLOCK</dt>
						<dd>{room.settings.timerMinutes} MIN</dd>
					</div>
				</dl>
				<div class="lobby-actions">
					{#if session?.isHost}
						<button
							class="primary"
							type="button"
							disabled={!allReady || starting}
							onclick={() => void start()}
						>
							{starting ? 'STARTING…' : allReady ? 'START MATCH' : 'WAITING FOR READY'}
						</button>
					{:else}
						<p class="waiting-host">Waiting for the host to start.</p>
					{/if}
					<button
						class="secondary"
						type="button"
						disabled={!localSeat}
						onclick={() => void toggleReady()}
					>
						{localSeat?.ready ? 'NOT READY' : 'READY'}
					</button>
				</div>
			</div>
		</div>
	{/if}
</section>

<style>
	.room-lobby {
		position: fixed;
		inset: 0;
		z-index: 40;
		padding: clamp(20px, 5vw, 64px);
		background:
			radial-gradient(circle at 50% 0%, rgba(255, 79, 92, 0.12), transparent 42%),
			linear-gradient(180deg, rgba(7, 10, 13, 0.97), rgba(5, 7, 9, 0.99));
		overflow: auto;
	}
	.lobby-head {
		display: flex;
		justify-content: space-between;
		gap: 24px;
		max-width: 1180px;
		margin: 0 auto 28px;
	}
	.eyebrow {
		font-size: 11px;
		letter-spacing: 0.2em;
		color: var(--signal);
	}
	h1 {
		margin: 8px 0;
		font-size: clamp(32px, 5vw, 64px);
		line-height: 0.95;
		letter-spacing: -0.04em;
	}
	.lobby-head p {
		max-width: 640px;
		margin: 0;
		color: var(--ink-soft);
	}
	.leave,
	.lobby-error button {
		align-self: flex-start;
		padding: 10px 14px;
		border: 1px solid var(--line-soft);
		background: transparent;
		color: var(--ink-soft);
		cursor: pointer;
	}
	.lobby-status,
	.lobby-error {
		max-width: 1180px;
		margin: 0 auto;
		padding: 28px;
		border: 1px solid var(--line-soft);
		background: rgba(255, 255, 255, 0.02);
	}
	.pulse {
		display: inline-block;
		width: 8px;
		height: 8px;
		margin-right: 10px;
		border-radius: 50%;
		background: var(--signal);
		animation: pulse 1s infinite alternate;
	}
	@keyframes pulse {
		to {
			opacity: 0.25;
		}
	}
	.lobby-error {
		border-color: rgba(255, 79, 92, 0.45);
	}
	.lobby-error strong {
		color: var(--signal);
	}
	.lobby-grid {
		display: grid;
		grid-template-columns: minmax(0, 1.4fr) minmax(300px, 0.8fr);
		gap: 18px;
		max-width: 1180px;
		margin: 0 auto;
	}
	.seat-panel,
	.rules-panel {
		border: 1px solid var(--line-soft);
		background: rgba(255, 255, 255, 0.025);
	}
	.panel-head {
		display: flex;
		justify-content: space-between;
		padding: 12px 16px;
		border-bottom: 1px solid var(--line-soft);
		font-size: 11px;
		letter-spacing: 0.16em;
		color: var(--ink-soft);
	}
	.seats {
		display: grid;
	}
	.seat {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 16px;
		border-bottom: 1px solid var(--line-soft);
	}
	.seat.local {
		background: rgba(255, 79, 92, 0.07);
	}
	.seat-index {
		color: var(--ink-soft);
		font-size: 11px;
	}
	.seat-name {
		flex: 1;
		font-weight: 700;
		letter-spacing: 0.06em;
	}
	.seat em {
		padding: 2px 6px;
		border: 1px solid var(--line-soft);
		font-size: 10px;
		font-style: normal;
		letter-spacing: 0.1em;
	}
	.seat-ready {
		font-size: 10px;
		letter-spacing: 0.12em;
		color: var(--ink-soft);
	}
	.seat-ready.ready {
		color: #8cdb9f;
	}
	.seat-note {
		margin: 0;
		padding: 14px 16px;
		font-size: 12px;
		color: var(--ink-soft);
	}
	dl {
		margin: 0;
		padding: 8px 16px;
	}
	dl div {
		display: flex;
		justify-content: space-between;
		padding: 9px 0;
		border-bottom: 1px solid var(--line-soft);
	}
	dt {
		color: var(--ink-soft);
		font-size: 11px;
		letter-spacing: 0.12em;
	}
	dd {
		margin: 0;
	}
	.lobby-actions {
		display: grid;
		gap: 10px;
		padding: 16px;
	}
	.lobby-actions button {
		padding: 14px;
		border: 1px solid var(--line-soft);
		background: transparent;
		color: var(--ink);
		font: inherit;
		letter-spacing: 0.1em;
		cursor: pointer;
	}
	.lobby-actions button.primary {
		border-color: var(--signal);
		background: var(--signal);
		color: #140406;
		font-weight: 800;
	}
	.lobby-actions button:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.waiting-host {
		margin: 0;
		color: var(--ink-soft);
		font-size: 12px;
		text-align: center;
	}
	@media (max-width: 760px) {
		.lobby-grid {
			grid-template-columns: 1fr;
		}
		.lobby-head {
			flex-direction: column;
		}
	}
</style>
