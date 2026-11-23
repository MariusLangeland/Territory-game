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

<style>
	.drag-overlay {
		position: fixed;
		inset: 0;
		z-index: 80;
		width: 100%;
		height: 100%;
		overflow: visible;
		pointer-events: none;
	}

	.drag-arrow-path {
		fill: none;
		stroke: var(--drag-accent);
		stroke-width: 2.6;
		stroke-linecap: round;
		filter: drop-shadow(0 0 6px color-mix(in srgb, var(--drag-accent) 55%, transparent));
	}

	.drag-arrow-head {
		fill: var(--drag-accent);
		filter: drop-shadow(0 0 5px color-mix(in srgb, var(--drag-accent) 55%, transparent));
	}

	.drag-arrow-origin {
		fill: var(--drag-accent);
		stroke: rgba(6, 14, 18, 0.9);
		stroke-width: 2;
	}

	.drag-landing-field {
		fill: rgba(255, 95, 87, 0.17);
		stroke: none;
	}

	.drag-landing-ring {
		fill: none;
		stroke: var(--danger);
		stroke-width: 2.8;
		stroke-dasharray: 6 5;
		filter: drop-shadow(0 0 9px rgba(255, 95, 87, 0.65));
	}

	.drag-landing-dot {
		fill: var(--danger);
		stroke: rgba(6, 14, 18, 0.9);
		stroke-width: 1.4;
	}

	.drag-overlay .valid .drag-landing-field {
		fill: rgba(131, 226, 124, 0.15);
	}

	.drag-overlay .valid .drag-landing-ring {
		stroke: var(--success);
		filter: drop-shadow(0 0 9px rgba(131, 226, 124, 0.65));
	}

	.drag-overlay .valid .drag-landing-dot {
		fill: var(--success);
	}
</style>
