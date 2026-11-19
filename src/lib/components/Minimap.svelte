<script lang="ts">
	import { onMount } from 'svelte';
	import { PALETTE } from '#lib/game/constants';
	import type { CameraView } from '#lib/game/render/camera-bridge';
	import type { GameSnapshot, TerritorySimulation } from '#lib/game/simulation';

	interface Props {
		simulation: TerritorySimulation;
		snapshot: GameSnapshot;
		cameraView: CameraView | null;
		onNavigate: (x: number, y: number) => void;
	}

	let { simulation, snapshot, cameraView, onNavigate }: Props = $props();

	const MAP_PIXELS = PALETTE.map((entry) => entry.rgb);

	let canvas: HTMLCanvasElement;
	let width = 260;
	let height = 130;
	let lastBaseTick = -100;
	let lastBaseAt = 0;
	let baseImage: ImageData | null = null;

	onMount(() => {
		const context = canvas.getContext('2d');
		if (!context) return;
		width = canvas.width;
		height = canvas.height;
		baseImage = context.createImageData(width, height);
	});

	$effect(() => {
		// Depend on the tick and view so the component repaints as the match runs
		// and when the camera moves, while the expensive owner sampling is throttled.
		const tick = snapshot.tick;
		const view = cameraView;
		if (!canvas) return;

		const context = canvas.getContext('2d');
		if (!context) return;
		const now = performance.now();

		if (!baseImage || tick - lastBaseTick >= 3 || now - lastBaseAt > 650) {
			const image = context.createImageData(width, height);
			const data = image.data;
			const sx = simulation.width / width;
			const sy = simulation.height / height;

			for (let py = 0; py < height; py++) {
				const mapY = Math.min(simulation.height - 1, Math.floor(py * sy));
				for (let px = 0; px < width; px++) {
					const mapX = Math.min(simulation.width - 1, Math.floor(px * sx));
					const index = mapY * simulation.width + mapX;
					const offset = (py * width + px) * 4;
					const owner = simulation.owners[index];
					const land = simulation.terrain[index];

					if (!land) {
						data[offset] = 9;
						data[offset + 1] = 29;
						data[offset + 2] = 42;
						data[offset + 3] = 255;
					} else {
						const color = MAP_PIXELS[owner] ?? MAP_PIXELS[0];
						const shade = 0.76 + (simulation.terrainShade[index] / 255) * 0.28;
						data[offset] = Math.min(255, Math.round(color[0] * shade));
						data[offset + 1] = Math.min(255, Math.round(color[1] * shade));
						data[offset + 2] = Math.min(255, Math.round(color[2] * shade));
						data[offset + 3] = 255;
					}
				}
			}

			baseImage = image;
			lastBaseTick = tick;
			lastBaseAt = now;
		}

		if (!baseImage) return;
		context.putImageData(baseImage, 0, 0);

		// Territory starts and active human attacks.
		for (const start of simulation.map.starts) {
			const owner = simulation.owners[start.index];
			const color = MAP_PIXELS[owner] ?? [220, 230, 220];
			context.fillStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, 0.95)`;
			context.fillRect(
				(start.x / simulation.width) * width - 1,
				(start.y / simulation.height) * height - 1,
				2,
				2
			);
		}

		for (const attack of snapshot.attacks) {
			if (attack.attackerId !== snapshot.humanId) continue;
			const x = (attack.targetX / simulation.width) * width;
			const y = (attack.targetY / simulation.height) * height;
			context.strokeStyle = 'rgba(255, 240, 189, 0.9)';
			context.lineWidth = 1;
			context.beginPath();
			context.moveTo(x - 3, y);
			context.lineTo(x + 3, y);
			context.moveTo(x, y - 3);
			context.lineTo(x, y + 3);
			context.stroke();
		}

		if (view) {
			const halfW = view.viewportWidth / (2 * Math.max(0.0001, view.scale));
			const halfH = view.viewportHeight / (2 * Math.max(0.0001, view.scale));
			const left = ((view.centerX - halfW) / view.mapWidth) * width;
			const top = ((view.centerY - halfH) / view.mapHeight) * height;
			const rectW = ((halfW * 2) / view.mapWidth) * width;
			const rectH = ((halfH * 2) / view.mapHeight) * height;

			context.strokeStyle = 'rgba(247, 238, 208, 0.78)';
			context.lineWidth = 1;
			context.strokeRect(
				Math.max(0.5, left),
				Math.max(0.5, top),
				Math.min(width - 1 - Math.max(0.5, left), rectW),
				Math.min(height - 1 - Math.max(0.5, top), rectH)
			);
		}
	});

	function handleClick(event: MouseEvent): void {
		const rect = canvas.getBoundingClientRect();
		const x = ((event.clientX - rect.left) / rect.width) * simulation.width;
		const y = ((event.clientY - rect.top) / rect.height) * simulation.height;
		onNavigate(
			Math.max(0, Math.min(simulation.width - 1, x)),
			Math.max(0, Math.min(simulation.height - 1, y))
		);
	}
</script>

<button
	class="minimap-frame"
	type="button"
	onclick={handleClick}
	aria-label="Navigate using the minimap"
>
	<span class="minimap-label"><span>WORLD</span><span>CLICK TO JUMP</span></span>
	<canvas bind:this={canvas} width={260} height={130}></canvas>
</button>

<style>
	.minimap-frame {
		position: relative;
		display: block;
		padding: 0;
		border: 1px solid rgba(186, 211, 193, 0.24);
		border-radius: 3px;
		background: #040b12;
		overflow: hidden;
		cursor: crosshair;
		box-shadow:
			0 18px 48px rgba(0, 0, 0, 0.42),
			inset 0 0 0 1px rgba(255, 255, 255, 0.035);
	}

	.minimap-frame:hover,
	.minimap-frame:focus-visible {
		border-color: rgba(247, 238, 208, 0.52);
		outline: none;
	}

	canvas {
		display: block;
		width: 100%;
		height: auto;
		image-rendering: pixelated;
		opacity: 0.94;
	}

	.minimap-label {
		position: absolute;
		z-index: 2;
		inset: 0 0 auto;
		display: flex;
		justify-content: space-between;
		padding: 6px 8px;
		font-family: var(--font-mono);
		font-size: 8px;
		letter-spacing: 0.16em;
		color: rgba(224, 236, 219, 0.66);
		pointer-events: none;
		background: linear-gradient(to bottom, rgba(2, 8, 13, 0.76), transparent);
	}
</style>
