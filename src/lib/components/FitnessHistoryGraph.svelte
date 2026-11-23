<script lang="ts">
	import type { FitnessHistoryPoint } from '#lib/game/ai/fitness-history';

	interface Props {
		points: FitnessHistoryPoint[];
	}

	let { points }: Props = $props();

	const WIDTH = 340;
	const HEIGHT = 170;
	const LEFT = 36;
	const RIGHT = 10;
	const TOP = 12;
	const BOTTOM = 24;
	const PLOT_WIDTH = WIDTH - LEFT - RIGHT;
	const PLOT_HEIGHT = HEIGHT - TOP - BOTTOM;

	function formatFitness(value: number): string {
		if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}k`;
		return value.toFixed(0);
	}

	let layout = $derived.by(() => {
		if (points.length === 0) return null;
		const values = points.flatMap((point) =>
			point.selected === null
				? [point.best, point.average]
				: [point.best, point.average, point.selected]
		);
		const max = Math.max(1, ...values);
		const min = Math.min(0, ...values);
		const span = Math.max(1, max - min);
		const xFor = (index: number): number =>
			points.length === 1
				? LEFT + PLOT_WIDTH / 2
				: LEFT + (index / (points.length - 1)) * PLOT_WIDTH;
		const yFor = (value: number): number =>
			TOP + PLOT_HEIGHT - ((value - min) / span) * PLOT_HEIGHT;
		const line = (read: (point: FitnessHistoryPoint) => number | null): string => {
			let path = '';
			for (let index = 0; index < points.length; index++) {
				const value = read(points[index]);
				if (value === null) continue;
				path += `${path ? 'L' : 'M'}${xFor(index).toFixed(1)} ${yFor(value).toFixed(1)} `;
			}
			return path.trim();
		};
		const selectedSegments: string[] = [];
		let segment = '';
		for (let index = 0; index < points.length; index++) {
			const value = points[index].selected;
			if (value === null) {
				if (segment) selectedSegments.push(segment.trim());
				segment = '';
				continue;
			}
			segment += `${segment ? 'L' : 'M'}${xFor(index).toFixed(1)} ${yFor(value).toFixed(1)} `;
		}
		if (segment) selectedSegments.push(segment.trim());
		const grid = [0, 0.25, 0.5, 0.75, 1].map((fraction) => ({
			y: TOP + PLOT_HEIGHT - fraction * PLOT_HEIGHT,
			value: min + fraction * span
		}));
		return {
			xFor,
			yFor,
			bestPath: line((point) => point.best),
			averagePath: line((point) => point.average),
			selectedSegments,
			grid,
			xLabels: points.map((point, index) => ({
				x: xFor(index),
				label: `${point.generation}`
			}))
		};
	});
</script>

{#if points.length > 0 && layout}
	<div class="history">
		<svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Fitness history by generation">
			{#each layout.grid as line (line.y)}
				<line x1={LEFT} y1={line.y} x2={WIDTH - RIGHT} y2={line.y} class="grid" />
				<text x={LEFT - 5} y={line.y + 3} text-anchor="end" class="axis">
					{formatFitness(line.value)}
				</text>
			{/each}
			{#each layout.xLabels as label, index (index)}
				{#if points.length <= 8 || index === 0 || index === points.length - 1 || index % Math.ceil(points.length / 6) === 0}
					<text x={label.x} y={HEIGHT - 7} text-anchor="middle" class="axis">
						G{label.label}
					</text>
				{/if}
			{/each}
			<path d={layout.bestPath} class="line best" />
			<path d={layout.averagePath} class="line average" />
			{#each layout.selectedSegments as path, index (index)}
				<path d={path} class="line selected" />
			{/each}
			{#each points as point, index (point.generation)}
				<circle cx={layout.xFor(index)} cy={layout.yFor(point.best)} r="2.4" class="best-dot" />
				{#if point.selected !== null}
					<circle
						cx={layout.xFor(index)}
						cy={layout.yFor(point.selected)}
						r="3"
						class="selected-dot"
					/>
				{/if}
			{/each}
		</svg>
		<div class="history-legend">
			<span><i class="best"></i>BEST</span>
			<span><i class="average"></i>AVERAGE</span>
			<span><i class="selected"></i>SELECTED</span>
		</div>
	</div>
{:else}
	<p class="empty">Fitness history appears after the first generation completes.</p>
{/if}

<style>
	.history {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	svg {
		width: 100%;
		height: auto;
		background: var(--bg-deep);
		border: 1px solid var(--line-online-soft);
	}
	.grid {
		stroke: rgba(247, 238, 208, 0.08);
		stroke-width: 1;
	}
	.axis {
		fill: var(--bone-40);
		font:
			7px 'IBM Plex Mono',
			monospace;
	}
	.line {
		fill: none;
		stroke-width: 1.8;
		stroke-linejoin: round;
		stroke-linecap: round;
	}
	.line.best,
	.best-dot {
		stroke: var(--accent-gold);
		fill: var(--accent-gold);
	}
	.line.average {
		stroke: var(--accent-cyan);
	}
	.line.selected,
	.selected-dot {
		stroke: var(--accent-mint);
		fill: var(--accent-mint);
	}
	.best-dot,
	.selected-dot {
		stroke-width: 0;
	}
	.history-legend {
		display: flex;
		gap: 10px;
		font-size: var(--text-8);
		color: var(--bone-55);
	}
	.history-legend span {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.history-legend i {
		width: 10px;
		height: 2px;
		display: inline-block;
	}
	.history-legend i.best {
		background: var(--accent-gold);
	}
	.history-legend i.average {
		background: var(--accent-cyan);
	}
	.history-legend i.selected {
		background: var(--accent-mint);
	}
	.empty {
		margin: 0;
		color: var(--ink-faint);
		font-size: var(--text-9);
	}
</style>
