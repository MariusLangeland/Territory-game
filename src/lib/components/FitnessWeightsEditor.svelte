<script lang="ts">
	import {
		DEFAULT_FITNESS_WEIGHTS,
		FITNESS_WEIGHT_KEYS,
		FITNESS_WEIGHT_LABELS,
		type FitnessWeights
	} from '#lib/game/ai';

	interface Props {
		weights: FitnessWeights;
		onupdate: (weights: FitnessWeights) => void;
		compact?: boolean;
	}

	let { weights, onupdate, compact = false }: Props = $props();

	function weightStep(key: keyof FitnessWeights): number {
		if (key === 'attack') return 0.1;
		if (key === 'land' || key === 'win' || key === 'survival') return 1000;
		return 1;
	}

	function updateWeight(key: keyof FitnessWeights, raw: string): void {
		const value = Number(raw);
		if (!Number.isFinite(value)) return;
		onupdate({ ...weights, [key]: Math.max(0, Math.min(10_000_000, value)) });
	}

	function reset(): void {
		onupdate({ ...DEFAULT_FITNESS_WEIGHTS });
	}
</script>

<div class:compact class="weights">
	<div class="weight-grid">
		{#each FITNESS_WEIGHT_KEYS as key (key)}
			<label>
				<span>{FITNESS_WEIGHT_LABELS[key]}</span>
				<input
					type="number"
					min="0"
					max="10000000"
					step={weightStep(key)}
					value={weights[key]}
					oninput={(event) => updateWeight(key, event.currentTarget.value)}
				/>
			</label>
		{/each}
	</div>
	<div class="weight-actions">
		<button type="button" onclick={reset}>RESET WEIGHTS</button>
	</div>
	<p class="hint">
		Land defaults to 60k (was 120k). Combat terms reward eliminations and weak-state attacks;
		defense terms reward repelled fronts and damage absorbed. All terms are independent.
	</p>
</div>

<style>
	.weights {
		display: flex;
		flex-direction: column;
		gap: 7px;
	}

	.weight-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 6px;
	}

	label span {
		display: block;
		color: var(--ink-faint);
		font-size: var(--text-8);
		letter-spacing: 0.08em;
		margin-bottom: 3px;
	}

	input {
		width: 100%;
		border: 1px solid var(--line-online);
		background: var(--bg-deep);
		color: var(--ink);
		padding: 5px;
		font: inherit;
		font-size: var(--text-10);
	}

	.weight-actions {
		display: flex;
		justify-content: flex-end;
	}

	button {
		border: 1px solid var(--line-online);
		background: var(--bg-raised);
		color: var(--ink-dim);
		padding: 4px 7px;
		font: inherit;
		font-size: var(--text-8);
		letter-spacing: 0.08em;
		cursor: pointer;
	}

	button:hover {
		border-color: var(--accent-gold);
		color: var(--accent-gold);
	}

	.hint {
		margin: 0;
		color: var(--ink-faint);
		font-size: var(--text-8);
		line-height: 1.45;
	}

	.compact .weight-grid {
		grid-template-columns: 1fr 1fr;
	}

	.compact label span {
		font-size: var(--text-7);
	}

	.compact input {
		padding: 3px 4px;
		font-size: var(--text-9);
	}
</style>
