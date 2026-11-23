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

<style>
	.loading-overlay {
		z-index: 90;
		align-content: center;
		background: var(--bg-deep);
		text-align: center;
	}

	.loader-mark {
		position: relative;
		width: 54px;
		height: 54px;
		margin: 0 auto 24px;
		border: 1px solid rgba(220, 233, 149, 0.26);
		transform: rotate(45deg);
	}

	.loader-mark span {
		position: absolute;
		background: var(--signal);
		animation: loader-pulse 1.6s ease-in-out infinite;
	}

	.loader-mark span:nth-child(1) {
		inset: 8px 8px auto auto;
		width: 8px;
		height: 8px;
	}

	.loader-mark span:nth-child(2) {
		inset: auto auto 8px 8px;
		width: 8px;
		height: 8px;
		animation-delay: 180ms;
	}

	.loader-mark span:nth-child(3) {
		top: 50%;
		left: 50%;
		width: 18px;
		height: 1px;
		transform: translate(-50%, -50%) rotate(-45deg);
		opacity: 0.45;
	}

	.loading-overlay .overlay-kicker {
		color: var(--signal);
	}

	.loading-overlay h2 {
		margin: 9px 0 10px;
		font-family: var(--font-display);
		font-size: var(--display-2xs);
		font-weight: 700;
		line-height: 0.84;
		letter-spacing: 0.02em;
	}

	.loading-copy {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-9);
		letter-spacing: 0.04em;
		color: var(--ink-faint);
	}
</style>
