<script lang="ts">
	import type { RendererFrameStats } from '#lib/game/render/territory-renderer';
	import { formatCompact } from '#lib/format';

	interface Props {
		perf: RendererFrameStats;
		onZoomIn: () => void;
		onZoomOut: () => void;
		onFit: () => void;
		onFocus: () => void;
	}
	let { perf, onZoomIn, onZoomOut, onFit, onFocus }: Props = $props();
</script>

<div class="map-tools hud" aria-label="Map controls">
	<div class="tool-stack">
		<button type="button" onclick={onZoomIn} aria-label="Zoom in">+</button>
		<button type="button" onclick={onZoomOut} aria-label="Zoom out">−</button>
	</div>
	<button class="tool-wide" type="button" onclick={onFit} aria-label="Fit entire map">FIT</button>
	<button class="tool-wide" type="button" onclick={onFocus} aria-label="Center on your territory">
		FOCUS
	</button>
	<div class="perf-readout">
		<span>{perf.fps} FPS</span>
		<span>{formatCompact(perf.uploadedPixels)} PX/S</span>
		<span>{perf.uploadCalls} CALLS/S</span>
	</div>
</div>

<style>
	@media (max-width: 900px) {
		.map-tools {
			right: 14px;
			bottom: 202px;
		}
		.perf-readout {
			display: none;
		}
		.map-tools .tool-wide {
			width: 36px;
		}
	}
	@media (max-width: 620px) {
		.map-tools {
			gap: 4px;
		}
	}
	.map-tools {
		right: 22px;
		bottom: 22px;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 5px;
		animation: hud-in 600ms 260ms ease-out both;
	}
	.tool-stack {
		display: flex;
		gap: 5px;
	}
	.map-tools button {
		display: grid;
		place-items: center;
		width: 36px;
		height: 34px;
		padding: 0;
		border: 1px solid var(--line-strong);
		background: rgba(5, 13, 18, 0.82);
		font-family: var(--font-mono);
		font-size: 13px;
		color: var(--ink-dim);
		backdrop-filter: blur(12px);
		cursor: pointer;
		transition:
			color 150ms ease,
			border-color 150ms ease;
	}
	.map-tools button:hover {
		color: var(--signal);
		border-color: rgba(220, 233, 149, 0.55);
	}
	.map-tools .tool-wide {
		width: 77px;
		height: 26px;
		font-size: 7px;
		letter-spacing: 0.12em;
	}
	.perf-readout {
		display: flex;
		gap: 9px;
		margin-top: 3px;
		font-family: var(--font-mono);
		font-size: 6.5px;
		letter-spacing: 0.05em;
		color: var(--ink-faint);
	}
</style>
