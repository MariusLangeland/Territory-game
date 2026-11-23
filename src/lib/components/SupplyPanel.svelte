<script lang="ts">
	import { formatSupply } from '#lib/format';
	import type { PublicStructure } from '#lib/game/Structures';
	import type { GameSnapshot } from '#lib/game/simulation';

	interface SupplyBar {
		supply: number;
		cap: number;
		fill: number;
		costWidth: number;
		costStart: number;
	}
	interface SupplyPreview {
		label: string;
		cost: number;
		affordable: boolean;
	}
	interface Props {
		snapshot: GameSnapshot;
		supplyBar: SupplyBar;
		supplyPreview: SupplyPreview | null;
		humanFronts: readonly unknown[];
		humanArtillery: readonly PublicStructure[];
		readyArtillery: readonly PublicStructure[];
		readyArtilleryShells: number;
		artilleryVolleyCost: number;
		artilleryTargeting: boolean;
		onCancelFront: () => void;
		onToggleArtillery: () => void;
	}
	let {
		snapshot,
		supplyBar,
		supplyPreview,
		humanFronts,
		humanArtillery,
		readyArtillery,
		readyArtilleryShells,
		artilleryVolleyCost,
		artilleryTargeting,
		onCancelFront,
		onToggleArtillery
	}: Props = $props();
</script>

<div
	class="supply-dock hud"
	class:previewing={!!supplyPreview}
	class:short={supplyPreview ? !supplyPreview.affordable : false}
	aria-label="Supply"
>
	<div class="supply-row">
		<div class="supply-edge supply-now">
			<span>SUPPLY</span>
			<strong title={`${supplyBar.supply} / ${supplyBar.cap}`}>
				{formatSupply(supplyBar.supply)}
			</strong>
		</div>
		<div
			class="supply-track"
			role="progressbar"
			aria-label="Supply"
			aria-valuemin={0}
			aria-valuemax={supplyBar.cap}
			aria-valuenow={supplyBar.supply}
			title={supplyPreview
				? `${supplyPreview.label}: ${supplyPreview.cost} supply`
				: `${supplyBar.supply} / ${supplyBar.cap} supply`}
		>
			<div class="supply-fill" style={`width:${supplyBar.fill}%`}></div>
			{#if supplyPreview && supplyBar.costWidth > 0}
				<div
					class="supply-cost-fill"
					style={`left:${supplyBar.costStart}%;width:${supplyBar.costWidth}%`}
				></div>
			{/if}
			<div class="supply-cap" style={`left:${supplyBar.fill}%`}></div>
		</div>
		<div class="supply-edge supply-max">
			<span>MAX</span>
			<strong title={`${supplyBar.supply} / ${supplyBar.cap}`}>
				{formatSupply(supplyBar.cap)}
			</strong>
		</div>
	</div>
	<div class="supply-meta">
		<em>+{snapshot.supplyIncome}/s</em>
		{#if supplyPreview}
			<div class="supply-cost" class:short={!supplyPreview.affordable}>
				<span>{supplyPreview.label}</span>
				<strong>-{formatSupply(supplyPreview.cost)}S</strong>
				{#if !supplyPreview.affordable}<i>NEED</i>{/if}
			</div>
		{/if}
		<div class="supply-actions">
			{#if humanFronts.length > 0}
				<button class="cancel-front" type="button" onclick={onCancelFront}> CANCEL FRONT </button>
			{/if}
			{#if humanArtillery.length > 0}
				<button
					class="fire-artillery"
					class:active={artilleryTargeting}
					class:unaffordable={!artilleryTargeting && snapshot.supply < artilleryVolleyCost}
					type="button"
					onclick={onToggleArtillery}
					disabled={!artilleryTargeting && snapshot.supply < artilleryVolleyCost}
					title={`Fire every ready battery (${readyArtilleryShells} shells, ${artilleryVolleyCost} supply) at a point within range`}
				>
					{artilleryTargeting
						? 'SELECT TARGET'
						: `FIRE ${readyArtillery.length}/${humanArtillery.length} · ${formatSupply(artilleryVolleyCost)}S`}
				</button>
			{/if}
		</div>
	</div>
</div>
