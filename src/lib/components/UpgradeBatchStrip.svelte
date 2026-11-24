<script lang="ts">
	interface Props {
		upgradeBatch: 1 | 5 | 10 | 25;
		onSetUpgradeBatch: (batch: 1 | 5 | 10 | 25) => void;
	}
	let { upgradeBatch, onSetUpgradeBatch }: Props = $props();
	const upgradeBatches = [1, 5, 10, 25] as const;
</script>

<!--
	Lives outside the supply dock so the raised card hand cannot intercept the
	clicks. It is anchored just above the raised hand and keeps the supply
	dock's palette so the association stays visible.
-->
<div class="upgrade-batch-strip" role="group" aria-label="Upgrade quantity">
	<span>UPGRADE</span>
	{#each upgradeBatches as batch}
		<button
			type="button"
			class:active={upgradeBatch === batch}
			aria-pressed={upgradeBatch === batch}
			title={`Upgrade ${batch} level${batch === 1 ? '' : 's'} per district click`}
			onclick={() => onSetUpgradeBatch(batch)}
		>
			{batch}
		</button>
	{/each}
</div>

<style>
	.upgrade-batch-strip {
		position: fixed;
		left: 50%;
		/* Clear the raised-card top edge at every breakpoint; see media queries. */
		bottom: 234px;
		/* Above the raised hand (z 20) and the pointer-transparent drag overlay
		   (z 80) so the fan can never swallow these clicks. Every modal/veil
		   layer that can coexist with live play is gated out in +page.svelte. */
		z-index: 85;
		display: flex;
		align-items: center;
		gap: 3px;
		padding: 3px 7px;
		border: 1px solid rgba(255, 214, 144, 0.3);
		background:
			linear-gradient(150deg, rgba(255, 214, 144, 0.08), transparent 58%), rgba(6, 15, 20, 0.9);
		box-shadow:
			0 8px 20px rgba(0, 0, 0, 0.4),
			inset 0 0 0 1px var(--alpha-white-035);
		clip-path: polygon(6px 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%, 0 6px);
		transform: translateX(-50%);
		backdrop-filter: blur(10px);
		font-family: var(--font-mono);
		font-size: var(--text-6);
		letter-spacing: 0.12em;
		color: var(--ink-faint);
		pointer-events: auto;
	}

	.upgrade-batch-strip span {
		margin-right: 3px;
	}

	.upgrade-batch-strip button {
		min-width: 22px;
		padding: 1px 4px;
		border: 1px solid var(--line-soft);
		background: var(--bg-raised);
		color: var(--ink-dim);
		font-family: var(--font-mono);
		font-size: var(--text-7);
		cursor: pointer;
	}

	.upgrade-batch-strip button:hover {
		border-color: var(--signal-35);
		color: var(--ink);
	}

	.upgrade-batch-strip button.active {
		border-color: var(--signal-55);
		background: color-mix(in srgb, var(--signal) 14%, transparent);
		color: var(--signal-strong);
	}

	.upgrade-batch-strip button:focus-visible {
		outline: 1px solid var(--signal);
		outline-offset: 1px;
	}

	@media (max-width: 1180px) {
		.upgrade-batch-strip {
			bottom: 228px;
		}
	}

	@media (max-width: 900px) {
		.upgrade-batch-strip {
			bottom: 200px;
			padding: 2px 6px;
		}
	}

	@media (max-width: 620px) {
		.upgrade-batch-strip {
			bottom: 172px;
			gap: 2px;
			padding: 2px 5px;
		}
	}

	@media (max-width: 480px) {
		.upgrade-batch-strip {
			bottom: 154px;
		}
		.upgrade-batch-strip span {
			display: none;
		}
	}
</style>
