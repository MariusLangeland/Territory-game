<script lang="ts">
	import { TICK_RATE } from '#lib/game/constants';

	interface Props {
		tick: number;
		maxTick: number;
		playing: boolean;
		speed: number;
		complete: boolean;
		onSeek: (tick: number) => void;
		onToggle: () => void;
		onStep: (delta: number) => void;
		onSpeed: (speed: number) => void;
	}
	let { tick, maxTick, playing, speed, complete, onSeek, onToggle, onStep, onSpeed }: Props =
		$props();
	const speeds = [0.25, 0.5, 1, 2, 4, 8, 16] as const;

	function formatTick(value: number): string {
		const seconds = value / TICK_RATE;
		const mins = Math.floor(seconds / 60);
		const secs = Math.floor(seconds % 60);
		return `${mins}:${secs.toString().padStart(2, '0')}`;
	}
</script>

<div class="replay-timeline">
	<div class="timeline-controls">
		<button type="button" onclick={onToggle} aria-label={playing ? 'Pause replay' : 'Play replay'}>
			{playing ? 'PAUSE' : complete ? 'REPLAY' : 'PLAY'}
		</button>
		<button type="button" onclick={() => onStep(-1)} aria-label="Step back one tick">−1</button>
		<button type="button" onclick={() => onStep(1)} aria-label="Step forward one tick">+1</button>
		<span class="tick-label">TICK {tick} / {maxTick}</span>
		<span class="time-label">{formatTick(tick)} / {formatTick(maxTick)}</span>
		{#each speeds as value (value)}
			<button
				type="button"
				class:active={speed === value}
				onclick={() => onSpeed(value)}
				aria-pressed={speed === value}
			>
				{value}×
			</button>
		{/each}
	</div>
	<input
		class="timeline-scrub"
		type="range"
		min="0"
		max={Math.max(1, maxTick)}
		step="1"
		value={tick}
		aria-label="Replay timeline"
		oninput={(event) => onSeek(Number(event.currentTarget.value))}
	/>
</div>

<style>
	.replay-timeline {
		display: flex;
		flex-direction: column;
		gap: 5px;
	}

	.timeline-controls {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 4px;
		font-family: var(--font-mono);
		font-size: var(--text-7);
		letter-spacing: 0.08em;
		color: var(--ink-faint);
	}

	.timeline-controls button {
		padding: 2px 6px;
		border: 1px solid var(--line-soft);
		background: var(--bg-raised);
		color: var(--ink-dim);
		font: inherit;
		cursor: pointer;
	}

	.timeline-controls button:hover {
		border-color: var(--signal-55);
		color: var(--ink);
	}

	.timeline-controls button.active {
		border-color: var(--signal-55);
		color: var(--signal-strong);
		background: color-mix(in srgb, var(--signal) 14%, transparent);
	}

	.tick-label {
		margin-left: 6px;
		color: var(--ink);
	}

	.time-label {
		color: var(--ink-faint);
	}

	.timeline-scrub {
		width: 100%;
		accent-color: var(--signal);
		cursor: pointer;
	}
</style>
