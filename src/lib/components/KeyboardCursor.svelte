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
