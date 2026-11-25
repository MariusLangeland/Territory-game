<script lang="ts">
	import {
		LATENCY_OPTIONS,
		latencyLabel,
		nextSimulatedLatency
	} from '#lib/game/multiplayer/latency';

	interface Props {
		value: number;
		onChange: (value: number) => void;
		compact?: boolean;
	}
	let { value, onChange, compact = false }: Props = $props();
</script>

{#if compact}
	<button
		class="latency-compact"
		type="button"
		onclick={() => onChange(nextSimulatedLatency(value))}
		title="Cycle simulated network round-trip latency"
	>
		<span>SIM RTT</span>
		<strong>{latencyLabel(value)}</strong>
	</button>
{:else}
	<div class="latency-control" role="group" aria-label="Simulated network latency">
		<span class="latency-title">SIM RTT</span>
		{#each LATENCY_OPTIONS as option (option)}
			<button
				type="button"
				class:selected={value === option}
				onclick={() => onChange(option)}
				aria-pressed={value === option}
			>
				{option === 0 ? 'OFF' : `${option}MS`}
			</button>
		{/each}
	</div>
{/if}

<style>
	.latency-control {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-family: var(--font-mono);
		font-size: var(--text-8);
		letter-spacing: 0.08em;
	}

	.latency-title {
		margin-right: 3px;
		color: var(--ink-faint);
	}

	.latency-control button,
	.latency-compact {
		padding: 3px 6px;
		border: 1px solid var(--line-soft);
		background: rgba(7, 17, 21, 0.6);
		color: var(--ink-faint);
		font-family: var(--font-mono);
		font-size: var(--text-8);
		letter-spacing: 0.06em;
		cursor: pointer;
	}

	.latency-control button:hover,
	.latency-control button.selected {
		border-color: var(--signal);
		color: var(--signal);
	}

	.latency-control button.selected {
		background: color-mix(in srgb, var(--signal) 12%, transparent);
	}

	.latency-compact {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 6px 8px;
		white-space: nowrap;
	}

	.latency-compact span {
		color: var(--ink-faint);
	}

	.latency-compact strong {
		color: var(--signal);
		font-weight: 500;
	}

	.latency-compact:hover {
		border-color: var(--signal);
	}
</style>
