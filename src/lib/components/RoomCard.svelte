<script lang="ts">
	import { BOT_DIFFICULTY_OPTIONS } from '#lib/game/match-config';
	import { roomBotCount, roomSeedLabel, type RoomDefinition } from '#lib/spacetime/room-definition';

	interface Props {
		room: RoomDefinition;
		onConnect: (room: RoomDefinition) => void;
	}
	let { room, onConnect }: Props = $props();

	const difficulty = $derived(
		BOT_DIFFICULTY_OPTIONS.find((option) => option.id === room.settings.difficulty)?.label ??
			room.settings.difficulty.toUpperCase()
	);
	const timer = $derived(
		room.settings.timerMinutes > 0 ? `${room.settings.timerMinutes} MIN` : 'NONE'
	);
	const status = $derived(room.status ?? 'open');
	const statusLabel = $derived(
		status === 'running' ? 'LIVE' : status === 'closed' ? 'CLOSED' : 'OPEN'
	);
</script>

<article class="room-card" style={`--room-accent:${room.accent}`}>
	<header class="room-head">
		<div>
			<p class="room-class">{room.classification}</p>
			<h2>{room.name}</h2>
		</div>
		<span class="room-state" class:live={status === 'running'}><i></i>{statusLabel}</span>
	</header>

	<p class="room-description">{room.description}</p>

	<ul class="room-rules" aria-label={`${room.name} rules`}>
		{#each room.rules as rule}
			<li>{rule}</li>
		{/each}
	</ul>

	<dl class="room-params">
		<div>
			<dt>ATLAS</dt>
			<dd>{room.settings.mapWidth}×{room.settings.mapHeight}</dd>
		</div>
		<div>
			<dt>STATES</dt>
			<dd>{room.settings.states}</dd>
		</div>
		<div>
			<dt>BOTS</dt>
			<dd>{roomBotCount(room)}</dd>
		</div>
		<div>
			<dt>DIFFICULTY</dt>
			<dd>{difficulty}</dd>
		</div>
		<div>
			<dt>TIMER</dt>
			<dd>{timer}</dd>
		</div>
		<div>
			<dt>START CP</dt>
			<dd>
				{room.settings.botCommandPostStacks > 0 ? `+${room.settings.botCommandPostStacks}` : '0'}
			</dd>
		</div>
	</dl>

	<footer class="room-foot">
		<span class="room-seed">SEED {roomSeedLabel(room)}</span>
		<span class="room-humans">1 CLIENT</span>
		<button type="button" class="connect-button" onclick={() => onConnect(room)}>
			CONNECT
			<svg viewBox="0 0 16 16" aria-hidden="true">
				<path d="M2 8h11M9 3.5 13.5 8 9 12.5" />
			</svg>
		</button>
	</footer>
</article>

<style>
	.room-card {
		display: flex;
		flex-direction: column;
		gap: 12px;
		min-width: 0;
		overflow: hidden;
		padding: 16px;
		border: 1px solid color-mix(in srgb, var(--room-accent) 28%, var(--line-soft));
		background:
			linear-gradient(
				150deg,
				color-mix(in srgb, var(--room-accent) 9%, transparent),
				transparent 42%
			),
			rgba(7, 17, 21, 0.9);
		box-shadow:
			0 18px 42px var(--alpha-black-42),
			inset 0 0 0 1px var(--alpha-white-035);
	}

	.room-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
	}

	.room-class {
		margin: 0 0 4px;
		color: var(--room-accent);
		font-family: var(--font-mono);
		font-size: var(--text-8);
		letter-spacing: 0.14em;
	}

	.room-head h2 {
		margin: 0;
		color: var(--ink);
		font-family: var(--font-display);
		font-size: var(--text-20);
		font-weight: 500;
		letter-spacing: 0.06em;
	}

	.room-state {
		display: flex;
		align-items: center;
		gap: 5px;
		color: var(--ink-faint);
		font-family: var(--font-mono);
		font-size: var(--text-8);
		letter-spacing: 0.12em;
		white-space: nowrap;
	}

	.room-state i {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--room-accent);
		box-shadow: 0 0 8px var(--room-accent);
	}

	.room-state.live {
		color: var(--signal);
	}

	.room-state.live i {
		background: var(--signal);
		box-shadow: 0 0 8px var(--signal);
	}

	.room-description {
		margin: 0;
		color: var(--ink-dim);
		font-size: var(--text-10);
		line-height: 1.55;
	}

	.room-rules {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.room-rules li {
		padding: 2px 6px;
		border: 1px solid color-mix(in srgb, var(--room-accent) 24%, var(--line-soft));
		color: var(--ink-faint);
		font-family: var(--font-mono);
		font-size: var(--text-8);
		letter-spacing: 0.06em;
	}

	.room-params {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 8px 12px;
		margin: auto 0 0;
		padding-top: 10px;
		border-top: 1px solid var(--line-soft);
	}

	.room-params div {
		min-width: 0;
	}

	.room-params dt {
		color: var(--ink-faint);
		font-family: var(--font-mono);
		font-size: var(--text-8);
		letter-spacing: 0.1em;
	}

	.room-params dd {
		margin: 2px 0 0;
		overflow: hidden;
		color: var(--ink);
		font-family: var(--font-mono);
		font-size: var(--text-9);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.room-foot {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 9px;
		padding-top: 10px;
		border-top: 1px solid var(--line-soft);
	}

	.room-seed,
	.room-humans {
		color: var(--ink-faint);
		font-family: var(--font-mono);
		font-size: var(--text-8);
		letter-spacing: 0.08em;
	}

	.room-humans {
		margin-left: auto;
	}

	.connect-button {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 5px 9px;
		border: 1px solid color-mix(in srgb, var(--room-accent) 55%, var(--line-soft));
		background: color-mix(in srgb, var(--room-accent) 12%, var(--bg-raised));
		color: var(--ink);
		font-family: var(--font-mono);
		font-size: var(--text-8);
		letter-spacing: 0.08em;
		cursor: pointer;
	}

	.connect-button svg {
		width: 11px;
		height: 11px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.4;
	}

	.connect-button:hover {
		border-color: var(--room-accent);
		background: color-mix(in srgb, var(--room-accent) 20%, var(--bg-raised));
	}

	.connect-button:focus-visible {
		outline: 1px solid var(--room-accent);
		outline-offset: 2px;
	}

	@media (max-width: 700px) {
		.room-card {
			padding: 12px;
		}

		.room-params {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.room-foot {
			align-items: stretch;
		}

		.room-seed,
		.room-humans {
			display: flex;
			align-items: center;
		}

		.room-humans {
			margin-left: auto;
		}

		.connect-button {
			width: 100%;
			justify-content: center;
			padding: 8px 9px;
		}
	}
</style>
