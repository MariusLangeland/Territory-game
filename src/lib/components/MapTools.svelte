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
