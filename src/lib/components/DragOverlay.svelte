<script lang="ts">
	interface Landing {
		x: number;
		y: number;
		radius: number;
		ok: boolean;
	}
	interface Point {
		x: number;
		y: number;
	}
	interface Props {
		origin: Point;
		landing: Landing | null;
		arrow: { path: string; head: string };
		accent: string;
	}
	let { origin, landing, arrow, accent }: Props = $props();
</script>

<svg class="drag-overlay" aria-hidden="true">
	{#if landing}
		<g class:blocked={!landing.ok} class:valid={landing.ok}>
			<circle cx={landing.x} cy={landing.y} r={landing.radius} class="drag-landing-field" />
			<circle cx={landing.x} cy={landing.y} r={landing.radius} class="drag-landing-ring" />
			<circle cx={landing.x} cy={landing.y} r="3.5" class="drag-landing-dot" />
		</g>
	{/if}
	<path d={arrow.path} class="drag-arrow-path" style={`--drag-accent:${accent}`} />
	<path d={arrow.head} class="drag-arrow-head" style={`--drag-accent:${accent}`} />
	<circle
		cx={origin.x}
		cy={origin.y}
		r="4"
		class="drag-arrow-origin"
		style={`--drag-accent:${accent}`}
	/>
</svg>
