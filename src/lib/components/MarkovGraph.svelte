<script lang="ts">
	import type { MarkovController } from '#lib/game/ai';

	interface Props {
		controller: MarkovController | null;
		currentState?: number | null;
	}

	let { controller, currentState = null }: Props = $props();

	let layout = $derived.by(() => {
		if (!controller) return null;
		const count = controller.states.length;
		const centre = 130;
		const radius = 82;
		const points = controller.states.map((_, index) => {
			const angle = -Math.PI / 2 + (index / count) * Math.PI * 2;
			return {
				x: centre + Math.cos(angle) * radius,
				y: centre + Math.sin(angle) * radius
			};
		});
		const edges = controller.transitions.map((transition, index) => {
			const from = points[transition.from];
			const to = points[transition.to];
			return {
				...transition,
				index,
				x1: from.x,
				y1: from.y,
				x2: to.x,
				y2: to.y
			};
		});
		return { points, edges };
	});
</script>

{#if controller && layout}
	<div class="markov">
		<svg viewBox="0 0 260 260" role="img" aria-label="Selected genome Markov state graph">
			<defs>
				<marker
					id="markov-arrow"
					viewBox="0 0 10 10"
					refX="8"
					refY="5"
					markerWidth="4"
					markerHeight="4"
					orient="auto-start-reverse"
				>
					<path d="M 0 0 L 10 5 L 0 10 z" fill="#58c7e8" />
				</marker>
			</defs>
			{#each layout.edges as edge (edge.index)}
				<line
					x1={edge.x1}
					y1={edge.y1}
					x2={edge.x2}
					y2={edge.y2}
					stroke="#58c7e8"
					stroke-opacity="0.35"
					stroke-width="1"
					marker-end="url(#markov-arrow)"
				/>
			{/each}
			{#each layout.points as point, index (index)}
				<g class:current={currentState === index}>
					<circle cx={point.x} cy={point.y} r="23" />
					<text x={point.x} y={point.y - 2} text-anchor="middle" class="state-index">
						{index}
					</text>
					<text x={point.x} y={point.y + 9} text-anchor="middle" class="state-option">
						{controller.states[index].option.replace(/-.*$/, '')}
					</text>
				</g>
			{/each}
		</svg>
		<div class="legend">
			{#each controller.transitions as transition, index (index)}
				<span>
					<strong>{transition.from}→{transition.to}</strong>
					{transition.when} · {transition.chance}%
				</span>
			{/each}
		</div>
	</div>
{:else}
	<p class="empty">No Markov controller for this genome.</p>
{/if}

<style>
	.markov {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	svg {
		width: 100%;
		height: auto;
		background: var(--bg-deep);
		border: 1px solid var(--line-online-soft);
	}

	circle {
		fill: var(--bg-raised);
		stroke: var(--accent-cyan);
		stroke-width: 1.5;
	}

	.current circle {
		fill: rgba(243, 183, 77, 0.16);
		stroke: var(--accent-gold);
		stroke-width: 2.5;
	}

	.state-index {
		fill: var(--accent-gold);
		font:
			10px 'IBM Plex Mono',
			monospace;
	}

	.state-option {
		fill: var(--ink-dim);
		font:
			7px 'IBM Plex Mono',
			monospace;
	}

	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 3px 8px;
		color: var(--ink-faint);
		font-size: var(--text-8);
		line-height: 1.4;
		max-height: 74px;
		overflow-y: auto;
	}

	.legend strong {
		color: var(--ink-dim);
		font-weight: 400;
	}

	.empty {
		margin: 0;
		color: var(--ink-faint);
		font-size: var(--text-9);
	}
</style>
