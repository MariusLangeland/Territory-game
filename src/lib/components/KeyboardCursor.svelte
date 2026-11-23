<script lang="ts">
	interface Point {
		x: number;
		y: number;
	}
	interface Props {
		position: Point;
		allied: boolean;
		status: string;
	}
	let { position, allied, status }: Props = $props();
</script>

<div
	class="keyboard-cursor"
	class:allied
	style:left={`${position.x}px`}
	style:top={`${position.y}px`}
	aria-hidden="true"
>
	<span></span>
</div>
<p class="visually-hidden" aria-live="polite">{status}</p>

<style>
	.keyboard-cursor {
		position: absolute;
		z-index: 18;
		width: 34px;
		height: 34px;
		transform: translate(-50%, -50%);
		border: 2px solid rgba(61, 219, 217, 0.96);
		border-radius: 50%;
		background: radial-gradient(circle, rgba(61, 219, 217, 0.2), transparent 68%);
		box-shadow:
			0 0 0 2px rgba(3, 8, 13, 0.88),
			0 0 24px rgba(61, 219, 217, 0.62);
		pointer-events: none;
	}

	.keyboard-cursor::before,
	.keyboard-cursor::after {
		content: '';
		position: absolute;
		background: rgba(61, 219, 217, 0.94);
	}

	.keyboard-cursor::before {
		left: 50%;
		top: -9px;
		width: 1px;
		height: 50px;
		transform: translateX(-50%);
	}

	.keyboard-cursor::after {
		top: 50%;
		left: -9px;
		height: 1px;
		width: 50px;
		transform: translateY(-50%);
	}

	.keyboard-cursor.allied {
		opacity: 0.48;
		border-color: rgba(255, 208, 120, 0.86);
		background: radial-gradient(circle, rgba(255, 208, 120, 0.14), transparent 68%);
		box-shadow:
			0 0 0 2px rgba(3, 8, 13, 0.88),
			0 0 18px rgba(255, 208, 120, 0.34);
	}

	.keyboard-cursor.allied::before,
	.keyboard-cursor.allied::after {
		background: rgba(255, 208, 120, 0.72);
	}

	.keyboard-cursor.allied span {
		background: rgba(255, 236, 196, 0.8);
	}

	.keyboard-cursor span {
		position: absolute;
		inset: 13px;
		border-radius: 50%;
		background: var(--accent-cyan);
	}
</style>
