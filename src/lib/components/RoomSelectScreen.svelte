<script lang="ts">
	import { onMount } from 'svelte';
	import RoomCard from './RoomCard.svelte';
	import LatencyControl from './LatencyControl.svelte';
	import {
		connectRoomDirectory,
		roomDefinitionFromDirectory,
		type DirectoryConnectionState,
		type RoomDirectoryConnection
	} from '#lib/spacetime/room-directory';
	import { LOBBY_DATABASE } from '#lib/spacetime/config';
	import type { RoomDirectory } from '#lib/spacetime/lobby_bindings/types';
	import type { LocalRoomDefinition } from '#lib/game/multiplayer/rooms';

	interface Props {
		onConnect: (room: LocalRoomDefinition) => void;
		latencyMs: number;
		onLatencyChange: (value: number) => void;
	}
	let { onConnect, latencyMs, onLatencyChange }: Props = $props();

	let directory = $state<RoomDirectory[]>([]);
	let connectionState = $state<DirectoryConnectionState>('connecting');
	let error = $state('');
	let connection: RoomDirectoryConnection | null = null;
	const rooms = $derived(directory.map(roomDefinitionFromDirectory));
	const networkLabel = $derived(
		connectionState === 'ready'
			? 'LIVE DIRECTORY'
			: connectionState === 'error'
				? 'DIRECTORY OFFLINE'
				: 'LINKING DIRECTORY'
	);

	function connect(): void {
		connection?.disconnect();
		directory = [];
		error = '';
		connectionState = 'connecting';
		connection = connectRoomDirectory({
			onRooms: (next) => (directory = [...next]),
			onState: (next, message) => {
				connectionState = next;
				if (message) error = message;
			}
		});
	}

	function retry(): void {
		connect();
	}

	onMount(() => {
		connect();
		return () => connection?.disconnect();
	});
</script>

<div class="room-select">
	<div class="room-atmosphere" aria-hidden="true"></div>

	<header class="room-header">
		<div class="brand-lockup">
			<div class="brand-mark" aria-hidden="true"><span></span></div>
			<div>
				<p class="eyebrow">FRONTIER NETWORK / SPACETIME</p>
				<h1>SELECT A<br /><em>FRONTIER.</em></h1>
			</div>
		</div>
		<nav class="room-nav" aria-label="Network">
			<a href="/online">ONLINE</a>
			<a href="/evolution">AI LAB</a>
			<span class="network-state" class:offline={connectionState === 'error'}>
				<i></i>{networkLabel}
			</span>
			<LatencyControl value={latencyMs} onChange={onLatencyChange} />
		</nav>
	</header>

	<section class="room-intro" aria-labelledby="room-select-title">
		<div>
			<p class="section-index">01 / ROOMS</p>
			<h2 id="room-select-title">Connect to a room.<br /><em>Start the match.</em></h2>
		</div>
		<p class="room-lede">
			Live rooms from Spacetime. Each room is a self-contained deterministic frontier; connecting
			starts the local simulation with that room's rules and generation parameters.
		</p>
	</section>

	{#if connectionState === 'error' && rooms.length === 0}
		<section class="directory-state error-state" aria-live="polite">
			<p class="section-index">ROOM DIRECTORY UNAVAILABLE</p>
			<h2>Could not reach Spacetime.</h2>
			<p>{error || 'The room directory service did not respond.'}</p>
			<button type="button" class="retry-button" onclick={retry}>RETRY DIRECTORY</button>
		</section>
	{:else if connectionState === 'connecting' && rooms.length === 0}
		<section class="directory-state" aria-live="polite">
			<p class="section-index">ROOM DIRECTORY</p>
			<h2>Linking to {LOBBY_DATABASE}…</h2>
			<span class="loading-line"></span>
		</section>
	{:else if rooms.length === 0}
		<section class="directory-state" aria-live="polite">
			<p class="section-index">ROOM DIRECTORY</p>
			<h2>No open rooms right now.</h2>
			<p>Hosts open rooms by registering them in the Spacetime directory.</p>
			<button type="button" class="retry-button" onclick={retry}>REFRESH DIRECTORY</button>
		</section>
	{:else}
		<section class="room-grid" aria-label="Available rooms">
			{#each rooms as room (room.id)}
				<RoomCard {room} {onConnect} />
			{/each}
		</section>
	{/if}

	<footer class="room-footer">
		<span>SPACETIME ROOM DIRECTORY</span>
		<span>{LOBBY_DATABASE} / MAINCLOUD</span>
		<span>{rooms.length} OPEN ROOM{rooms.length === 1 ? '' : 'S'}</span>
	</footer>
</div>

<style>
	.room-select {
		position: fixed;
		inset: 0;
		z-index: 120;
		display: flex;
		flex-direction: column;
		gap: 22px;
		overflow-y: auto;
		padding: clamp(20px, 4vw, 46px);
		background: #050d10;
		color: var(--ink);
	}

	.room-atmosphere {
		position: fixed;
		inset: 0;
		pointer-events: none;
		background:
			radial-gradient(circle at 12% 12%, rgba(126, 214, 200, 0.12), transparent 34%),
			radial-gradient(circle at 82% 8%, rgba(183, 164, 255, 0.1), transparent 28%),
			linear-gradient(
				160deg,
				transparent 0 45%,
				rgba(224, 194, 122, 0.04) 45% 45.2%,
				transparent 45.2%
			),
			#050d10;
	}

	.room-header,
	.room-intro,
	.room-grid,
	.room-footer {
		position: relative;
		z-index: 1;
	}

	.room-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 24px;
	}

	.brand-lockup {
		display: flex;
		align-items: flex-start;
		gap: 12px;
	}

	.brand-mark {
		display: grid;
		place-items: center;
		width: 30px;
		height: 30px;
		border: 1px solid var(--signal-55);
		transform: rotate(45deg);
	}

	.brand-mark span {
		width: 8px;
		height: 8px;
		background: var(--signal);
	}

	.eyebrow,
	.section-index {
		margin: 0;
		color: var(--signal);
		font-family: var(--font-mono);
		font-size: var(--text-8);
		letter-spacing: 0.16em;
	}

	.brand-lockup h1 {
		margin: 4px 0 0;
		font-family: var(--font-display);
		font-size: clamp(28px, 5vw, 58px);
		font-weight: 500;
		line-height: 0.9;
		letter-spacing: 0.04em;
	}

	.brand-lockup h1 em,
	.room-intro h2 em {
		color: var(--signal);
		font-style: normal;
	}

	.room-nav {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 10px;
		font-family: var(--font-mono);
		font-size: var(--text-8);
		letter-spacing: 0.1em;
	}

	.room-nav a {
		color: var(--ink-dim);
		text-decoration: none;
	}

	.room-nav a:hover {
		color: var(--signal);
	}

	.network-state {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding-left: 10px;
		border-left: 1px solid var(--line-soft);
		color: var(--ink-faint);
	}

	.network-state i {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--signal);
		box-shadow: 0 0 8px var(--signal);
	}

	.room-intro {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 30px;
		padding-top: 10px;
		border-top: 1px solid var(--line-soft);
	}

	.room-intro h2 {
		margin: 8px 0 0;
		font-family: var(--font-display);
		font-size: clamp(24px, 3.2vw, 42px);
		font-weight: 500;
		line-height: 0.98;
		letter-spacing: 0.04em;
	}

	.room-lede {
		max-width: 44ch;
		margin: 0;
		color: var(--ink-dim);
		font-size: var(--text-10);
		line-height: 1.6;
	}

	.room-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 14px;
	}

	.directory-state {
		position: relative;
		z-index: 1;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 8px;
		padding: 26px;
		border: 1px solid var(--line-soft);
		background: rgba(7, 17, 21, 0.72);
	}

	.directory-state h2 {
		margin: 0;
		font-family: var(--font-display);
		font-size: clamp(22px, 3vw, 34px);
		font-weight: 500;
		letter-spacing: 0.04em;
	}

	.directory-state p:not(.section-index) {
		max-width: 60ch;
		margin: 0;
		color: var(--ink-dim);
		font-size: var(--text-10);
		line-height: 1.5;
	}

	.error-state {
		border-color: color-mix(in srgb, var(--danger-strong) 45%, var(--line-soft));
	}

	.retry-button {
		margin-top: 8px;
		padding: 7px 10px;
		border: 1px solid var(--signal);
		background: color-mix(in srgb, var(--signal) 12%, transparent);
		color: var(--ink);
		font-family: var(--font-mono);
		font-size: var(--text-8);
		letter-spacing: 0.1em;
		cursor: pointer;
	}

	.retry-button:hover {
		background: color-mix(in srgb, var(--signal) 22%, transparent);
	}

	.loading-line {
		display: block;
		width: min(280px, 50vw);
		height: 2px;
		margin-top: 6px;
		background: linear-gradient(90deg, transparent, var(--signal), transparent);
		animation: directory-scan 1.2s ease-in-out infinite;
	}

	@keyframes directory-scan {
		0% {
			transform: translateX(-30%);
			opacity: 0.2;
		}
		50% {
			transform: translateX(30%);
			opacity: 1;
		}
		100% {
			transform: translateX(-30%);
			opacity: 0.2;
		}
	}

	.network-state.offline {
		color: var(--danger-strong);
	}

	.network-state.offline i {
		background: var(--danger-strong);
		box-shadow: none;
	}

	.room-footer {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 18px;
		padding-top: 12px;
		border-top: 1px solid var(--line-soft);
		color: var(--ink-faint);
		font-family: var(--font-mono);
		font-size: var(--text-8);
		letter-spacing: 0.08em;
	}

	.room-footer span:last-child {
		margin-left: auto;
	}

	@media (max-width: 900px) {
		.room-grid {
			grid-template-columns: 1fr;
		}

		.room-intro {
			align-items: flex-start;
			flex-direction: column;
			gap: 12px;
		}

		.room-header {
			flex-direction: column;
		}

		.room-nav {
			justify-content: flex-start;
		}
	}

	@media (max-width: 620px) {
		.room-select {
			gap: 16px;
			padding: 16px;
		}

		.room-footer span:last-child {
			margin-left: 0;
		}
	}
</style>
