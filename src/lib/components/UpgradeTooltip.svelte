<script lang="ts">
	import { formatSupply } from '#lib/format';

	interface Tooltip {
		x: number;
		y: number;
		levels: number;
		cost: number;
		currentLevel: number;
		projectedLevel: number;
		merged: boolean;
		structureCount: number;
		ok: boolean;
	}

	interface Props {
		tooltip: Tooltip;
	}
	let { tooltip }: Props = $props();
</script>

<div
	class="upgrade-tooltip"
	class:insufficient={!tooltip.ok}
	style={`left:${tooltip.x}px;top:${tooltip.y}px`}
	aria-hidden="true"
>
	<span>UPGRADE +{tooltip.levels} LV</span>
	<strong>{formatSupply(tooltip.cost)}<small>S TOTAL</small></strong>
	<i>
		{#if tooltip.merged}
			MERGED ×{tooltip.structureCount} · LOWEST LV.{tooltip.currentLevel}
		{:else}
			LV.{tooltip.currentLevel} → LV.{tooltip.projectedLevel + tooltip.levels}
		{/if}
	</i>
	{#if !tooltip.ok}<em>INSUFFICIENT SUPPLY</em>{/if}
</div>

<style>
	.upgrade-tooltip {
		position: fixed;
		z-index: 130;
		transform: translate(-50%, calc(-100% - 14px));
		display: grid;
		gap: 2px;
		min-width: 132px;
		padding: 7px 10px 8px;
		border: 1px solid rgba(255, 214, 144, 0.4);
		background: rgba(5, 14, 18, 0.94);
		box-shadow: 0 12px 30px var(--alpha-black-45);
		font-family: var(--font-mono);
		font-size: var(--text-2xs);
		letter-spacing: 0.08em;
		color: var(--ink-faint);
		pointer-events: none;
		backdrop-filter: blur(12px);
	}

	.upgrade-tooltip span {
		color: var(--ink-dim);
	}

	.upgrade-tooltip strong {
		font-family: var(--font-display);
		font-size: var(--text-18);
		line-height: 1;
		letter-spacing: 0.02em;
		color: var(--warning);
	}

	.upgrade-tooltip strong small {
		margin-left: 3px;
		font-family: var(--font-mono);
		font-size: var(--text-3xs);
		letter-spacing: 0.1em;
		color: var(--ink-faint);
	}

	.upgrade-tooltip i {
		font-style: normal;
		font-size: var(--text-6);
		color: var(--ink-dim);
	}

	.upgrade-tooltip em {
		font-style: normal;
		font-size: var(--text-3xs);
		letter-spacing: 0.1em;
		color: var(--danger);
	}

	.upgrade-tooltip.insufficient {
		border-color: var(--danger-50);
	}
</style>
