<script lang="ts">
	interface Props {
		x: number;
		y: number;
	}
	let { x, y }: Props = $props();
</script>

<!--
	Pure pointer-transparent feedback for the naval snap. The position is the
	resolved shoreline cell centre in screen space, so a click there lands on the
	shore the worker would pick. It never intercepts pointer input.
-->
<div
	class="naval-target-preview"
	style={`transform: translate3d(${x}px, ${y}px, 0)`}
	aria-hidden="true"
>
	<span class="naval-ring"></span>
	<span class="naval-ring inner"></span>
	<span class="naval-cross horizontal"></span>
	<span class="naval-cross vertical"></span>
	<span class="naval-dot"></span>
</div>

<style>
	.naval-target-preview {
		position: fixed;
		top: 0;
		left: 0;
		z-index: 19;
		width: 0;
		height: 0;
		pointer-events: none;
		will-change: transform;
	}

	.naval-ring {
		position: absolute;
		top: 0;
		left: 0;
		width: 30px;
		height: 30px;
		margin: -15px 0 0 -15px;
		border: 2px dashed var(--accent-cyan);
		border-radius: 50%;
		box-shadow: 0 0 12px rgba(88, 199, 232, 0.45);
		animation: naval-ring-pulse 1.1s ease-in-out infinite;
	}

	.naval-ring.inner {
		width: 18px;
		height: 18px;
		margin: -9px 0 0 -9px;
		border: 1px solid rgba(88, 199, 232, 0.75);
		border-style: solid;
		box-shadow: none;
		animation: none;
	}

	.naval-cross {
		position: absolute;
		background: rgba(88, 199, 232, 0.85);
		box-shadow: 0 0 6px rgba(88, 199, 232, 0.5);
	}

	.naval-cross.horizontal {
		top: -1px;
		left: -19px;
		width: 38px;
		height: 2px;
	}

	.naval-cross.vertical {
		top: -19px;
		left: -1px;
		width: 2px;
		height: 38px;
	}

	.naval-dot {
		position: absolute;
		top: -2.5px;
		left: -2.5px;
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: #eaf9ff;
		box-shadow: 0 0 8px rgba(88, 199, 232, 0.9);
	}

	@keyframes naval-ring-pulse {
		0%,
		100% {
			transform: scale(1);
			opacity: 0.85;
		}
		50% {
			transform: scale(1.12);
			opacity: 1;
		}
	}
</style>
