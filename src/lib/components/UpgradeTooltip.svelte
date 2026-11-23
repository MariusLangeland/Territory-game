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
