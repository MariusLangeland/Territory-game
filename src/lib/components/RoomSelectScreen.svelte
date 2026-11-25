<script lang="ts">
	import RoomCard from './RoomCard.svelte';
	import { LOCAL_ROOMS, type LocalRoomDefinition } from '#lib/game/multiplayer/rooms';

	interface Props {
		onConnect: (room: LocalRoomDefinition) => void;
	}
	let { onConnect }: Props = $props();
</script>

<div class="room-select">
	<div class="room-atmosphere" aria-hidden="true"></div>

	<header class="room-header">
		<div class="brand-lockup">
			<div class="brand-mark" aria-hidden="true"><span></span></div>
			<div>
				<p class="eyebrow">FRONTIER NETWORK / LOCAL PROTOTYPE</p>
				<h1>SELECT A<br /><em>FRONTIER.</em></h1>
			</div>
		</div>
		<nav class="room-nav" aria-label="Network">
			<a href="/online">ONLINE</a>
			<a href="/evolution">AI LAB</a>
			<span class="network-state"><i></i>COORDINATOR READY</span>
		</nav>
	</header>

	<section class="room-intro" aria-labelledby="room-select-title">
		<div>
			<p class="section-index">01 / ROOMS</p>
			<h2 id="room-select-title">Connect to a room.<br /><em>Start the match.</em></h2>
		</div>
		<p class="room-lede">
			Each room is a self-contained deterministic frontier. Connecting starts the simulation
			immediately; there is no separate lobby or deploy step in this prototype.
		</p>
	</section>

	<section class="room-grid" aria-label="Available rooms">
		{#each LOCAL_ROOMS as room (room.id)}
			<RoomCard {room} {onConnect} />
		{/each}
	</section>

	<footer class="room-footer">
		<span>LOCAL MULTIPLAYER PROTOTYPE</span>
		<span>1 CLIENT + DETERMINISTIC BOTS</span>
		<span>ROOM TRANSPORT / LEDGER SYNC NOT YET CONNECTED</span>
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
