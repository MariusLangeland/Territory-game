<script lang="ts">
	interface Props {
		mapWidth: number;
		mapHeight: number;
		stateCount: number;
	}
	let { mapWidth, mapHeight, stateCount }: Props = $props();
</script>

<div class="overlay loading-overlay" role="status" aria-live="polite">
	<div class="loader-mark" aria-hidden="true"><span></span><span></span><span></span></div>
	<p class="overlay-kicker">CARTOGRAPHY IN PROGRESS</p>
	<h2>SURVEYING THE<br />FRONTIER.</h2>
	<p class="loading-copy">
		Generating {mapWidth.toLocaleString('en-US')} × {mapHeight.toLocaleString('en-US')} terrain cells
		and deploying {stateCount} states.
	</p>
</div>
