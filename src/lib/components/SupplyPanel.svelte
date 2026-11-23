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

<style>
	@media (max-width: 1180px) {
		.supply-dock {
			bottom: 52px;
		}
	}
	@media (max-width: 900px) {
		.supply-dock {
			bottom: 50px;
			padding: 6px 8px 8px;
		}
	}
	@media (max-width: 620px) {
		.supply-dock {
			bottom: 48px;
			width: calc(100vw - 16px);
			padding: 6px 7px 8px;
		}
		.supply-edge {
			min-width: 52px;
		}
		.supply-edge strong {
			font-size: var(--text-18);
		}
		.supply-meta em {
			display: none;
		}
	}
	@media (max-width: 480px) {
		.supply-dock {
			bottom: 48px;
			padding: 5px 6px 7px;
		}
		.supply-edge {
			min-width: 44px;
		}
		.supply-edge span {
			font-size: var(--text-5);
		}
		.supply-edge strong {
			font-size: var(--text-17);
		}
		.supply-cost {
			padding: 2px 5px;
		}
		.supply-cost span {
			display: none;
		}
		.supply-cost strong {
			font-size: var(--text-9);
		}
		.supply-actions button {
			font-size: var(--text-5);
			padding: 3px 4px;
		}
	}
	.supply-dock {
		position: fixed;
		z-index: 18;
		left: 50%;
		bottom: 52px;
		width: min(720px, calc(100vw - 32px));
		transform: translateX(-50%);
		display: flex;
		flex-direction: column;
		gap: 5px;
		padding: 7px 10px 9px;
		border: 1px solid rgba(255, 214, 144, 0.28);
		background:
			linear-gradient(150deg, rgba(255, 214, 144, 0.08), transparent 58%), rgba(6, 15, 20, 0.88);
		box-shadow:
			0 14px 34px rgba(0, 0, 0, 0.38),
			inset 0 0 0 1px var(--alpha-white-035);
		clip-path: polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px);
		backdrop-filter: blur(14px);
		pointer-events: auto;
	}
	.supply-row {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.supply-edge {
		display: flex;
		flex-direction: column;
		justify-content: center;
		flex: none;
		min-width: 66px;
		line-height: 0.9;
	}
	.supply-edge span {
		font-family: var(--font-mono);
		font-size: var(--text-3xs);
		letter-spacing: 0.13em;
		color: var(--ink-faint);
	}
	.supply-edge strong {
		font-family: var(--font-display);
		font-size: var(--text-22);
		line-height: 0.95;
		color: var(--warning);
		text-shadow: 0 0 18px rgba(255, 214, 144, 0.26);
	}
	.supply-max {
		align-items: flex-end;
		text-align: right;
	}
	.supply-max strong {
		color: var(--ink-dim);
		text-shadow: none;
	}
	.supply-meta {
		position: relative;
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 22px;
	}
	.supply-meta em {
		font-family: var(--font-mono);
		font-style: normal;
		font-size: var(--text-11);
		font-weight: 600;
		line-height: 1;
		letter-spacing: 0.04em;
		color: var(--signal);
		text-shadow: 0 0 10px rgba(220, 233, 149, 0.22);
	}
	.supply-cost {
		position: absolute;
		top: 50%;
		left: 0;
		z-index: 2;
		display: flex;
		align-items: baseline;
		gap: 6px;
		padding: 3px 7px;
		border: 1px solid rgba(255, 214, 144, 0.36);
		background: rgba(6, 15, 20, 0.97);
		box-shadow: 0 0 0 3px rgba(6, 15, 20, 0.9);
		font-family: var(--font-mono);
		white-space: nowrap;
		pointer-events: none;
		transform: translateY(-50%);
		animation: supply-cost-in 160ms ease-out both;
	}
	.supply-cost span {
		font-size: var(--text-3xs);
		letter-spacing: 0.1em;
		color: var(--ink-faint);
	}
	.supply-cost strong {
		font-size: var(--text-10);
		font-weight: 500;
		color: var(--warning);
	}
	.supply-cost i {
		font-style: normal;
		font-size: var(--text-3xs);
		letter-spacing: 0.1em;
		color: var(--danger);
	}
	.supply-cost.short {
		border-color: var(--danger-50);
		background: rgba(28, 10, 12, 0.97);
		box-shadow: 0 0 0 3px rgba(28, 10, 12, 0.9);
	}
	.supply-cost.short strong {
		color: var(--danger);
	}
	.supply-actions {
		display: flex;
		align-items: center;
		gap: 5px;
		flex: none;
		margin-left: auto;
	}
	.supply-actions .cancel-front {
		margin-top: 0;
	}
	.supply-actions .fire-artillery {
		margin-top: 0;
	}
	.supply-track {
		position: relative;
		flex: 1;
		height: 14px;
		overflow: hidden;
		border: 1px solid rgba(255, 214, 144, 0.25);
		background:
			repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.055) 0 1px, transparent 1px 9px),
			var(--alpha-black-42);
	}
	.supply-fill {
		position: absolute;
		inset: 0 auto 0 0;
		background: linear-gradient(90deg, rgba(255, 214, 144, 0.72), var(--warning));
		box-shadow: 0 0 14px rgba(255, 214, 144, 0.34);
		transition: width 120ms linear;
	}
	.supply-cost-fill {
		position: absolute;
		top: 0;
		bottom: 0;
		background:
			repeating-linear-gradient(
				135deg,
				rgba(255, 120, 103, 0.75) 0 3px,
				rgba(255, 120, 103, 0.38) 3px 6px
			),
			rgba(160, 30, 24, 0.5);
		box-shadow: inset 0 0 0 1px rgba(255, 170, 145, 0.45);
		transition:
			left 120ms linear,
			width 120ms linear;
	}
	.supply-cap {
		position: absolute;
		top: -2px;
		bottom: -2px;
		width: 1px;
		background: rgba(255, 248, 220, 0.7);
		box-shadow: 0 0 6px rgba(255, 248, 220, 0.4);
	}
	.supply-dock.previewing {
		border-color: rgba(255, 155, 90, 0.45);
	}
	.supply-dock.short .supply-track {
		border-color: rgba(255, 120, 103, 0.55);
	}
	.cancel-front {
		margin-top: 4px;
		padding: 4px 5px;
		border: 1px solid var(--danger-45);
		background: rgba(255, 120, 103, 0.08);
		color: var(--danger);
		font-family: var(--font-mono);
		font-size: var(--text-3xs);
		letter-spacing: 0.1em;
		cursor: pointer;
	}
	.cancel-front:hover {
		background: rgba(255, 120, 103, 0.16);
	}
	.fire-artillery {
		margin-top: 4px;
		padding: 4px 5px;
		border: 1px solid rgba(255, 155, 90, 0.45);
		background: rgba(255, 155, 90, 0.08);
		color: var(--warning);
		font-family: var(--font-mono);
		font-size: var(--text-3xs);
		letter-spacing: 0.1em;
		cursor: pointer;
	}
	.fire-artillery:hover {
		background: rgba(255, 155, 90, 0.2);
	}
	.fire-artillery.active {
		background: rgba(255, 155, 90, 0.2);
	}
	.fire-artillery.active {
		box-shadow: 0 0 0 1px rgba(255, 155, 90, 0.25);
	}
	.fire-artillery.unaffordable {
		border-color: rgba(255, 120, 103, 0.28);
		color: rgba(255, 196, 138, 0.4);
		cursor: not-allowed;
	}
</style>
