<script lang="ts">
	import { onMount } from 'svelte';
	import { HUMAN_PLAYER_ID, TICK_MS, colorForPlayer } from '#lib/game/constants';
	import type { GameSnapshot, SimEvent, TerritorySimulation } from '#lib/game/simulation';
	import { GameCameraBridge } from '#lib/game/render/camera-bridge';
	import { TerritoryRenderer, type RendererFrameStats } from '#lib/game/render/territory-renderer';

	interface HoverInfo {
		x: number;
		y: number;
		owner: number;
		land: boolean;
		elevation: number;
		baseDefense: number;
		defense: number;
	}

	interface Props {
		simulation: TerritorySimulation;
		paused: boolean;
		cameraBridge: GameCameraBridge;
		onTick?: (snapshot: GameSnapshot, events: SimEvent[]) => void;
		onHover?: (hover: HoverInfo | null) => void;
		onAttack?: (x: number, y: number) => void;
		onError?: (error: Error) => void;
		onReady?: () => void;
		onPerf?: (stats: RendererFrameStats) => void;
	}

	let {
		simulation,
		paused,
		cameraBridge,
		onTick,
		onHover,
		onAttack,
		onError,
		onReady,
		onPerf
	}: Props = $props();

	let canvas: HTMLCanvasElement;
	let structureCanvas: HTMLCanvasElement;
	let renderer: TerritoryRenderer | null = null;
	let dragging = $state(false);
	let pointerActive = false;
	let pointerStartX = 0;
	let pointerStartY = 0;
	let pointerLastX = 0;
	let pointerLastY = 0;

	onMount(() => {
		let disposed = false;
		let frameId = 0;
		let lastTime = performance.now();
		let accumulator = 0;
		let lastViewReport = 0;
		let lastPerfReport = 0;
		let lastHoverKey = '';
		let lastHoverAt = 0;
		let lastUiUpdate = 0;
		let structureContext: CanvasRenderingContext2D | null = null;

		function drawStructures(): void {
			if (!renderer || !structureCanvas) return;
			const camera = renderer.camera;
			const dpr = Math.min(window.devicePixelRatio || 1, 2);
			const width = Math.max(1, Math.round(camera.width));
			const height = Math.max(1, Math.round(camera.height));
			if (
				structureCanvas.width !== Math.round(width * dpr) ||
				structureCanvas.height !== Math.round(height * dpr)
			) {
				structureCanvas.width = Math.round(width * dpr);
				structureCanvas.height = Math.round(height * dpr);
				structureContext = null;
			}
			structureContext ??= structureCanvas.getContext('2d');
			const context = structureContext;
			if (!context) return;

			context.setTransform(1, 0, 0, 1, 0, 0);
			context.clearRect(0, 0, structureCanvas.width, structureCanvas.height);
			context.setTransform(dpr, 0, 0, dpr, 0, 0);

			for (const structure of simulation.structures.all) {
				const point = camera.mapToScreen(structure.x + 0.5, structure.y + 0.5);
				if (point.x < -12 || point.y < -12 || point.x > width + 12 || point.y > height + 12) {
					continue;
				}

				const human = structure.ownerId === HUMAN_PLAYER_ID;
				const radius = human ? 5 : 3.4;
				context.beginPath();
				context.moveTo(point.x, point.y - radius);
				context.lineTo(point.x + radius, point.y);
				context.lineTo(point.x, point.y + radius);
				context.lineTo(point.x - radius, point.y);
				context.closePath();
				context.globalAlpha = 0.94;
				context.fillStyle = colorForPlayer(structure.ownerId).hex;
				context.fill();
				context.globalAlpha = 1;
				context.lineWidth = human ? 1.5 : 1;
				context.strokeStyle = 'rgba(252, 246, 225, 0.94)';
				context.stroke();

				context.beginPath();
				context.arc(point.x, point.y, human ? 1.7 : 1.1, 0, Math.PI * 2);
				context.fillStyle = 'rgba(5, 14, 18, 0.92)';
				context.fill();
			}
		}

		function frame(now: number): void {
			if (disposed || !renderer) return;
			const delta = Math.min(250, Math.max(0, now - lastTime));
			lastTime = now;

			if (paused || simulation.ended) {
				accumulator = 0;
			} else {
				accumulator += delta;
				let steps = 0;
				let latestSnapshot: GameSnapshot | null = null;
				const pendingEvents: SimEvent[] = [];

				while (accumulator >= TICK_MS && steps < 4 && !simulation.ended) {
					const result = simulation.step();
					renderer.applyChanges(result.changes, result.changeCount, result.changesOverflow);
					latestSnapshot = result.snapshot;
					pendingEvents.push(...result.events);
					accumulator -= TICK_MS;
					steps++;
				}
				if (steps >= 4) accumulator = 0;

				// Territory rendering updates every tick, but rebuilding 108 HUD
				// rows at 10 Hz creates avoidable main-thread spikes. Snapshots go
				// to Svelte at 5 Hz, or immediately on elimination/victory events.
				if (
					latestSnapshot &&
					(now - lastUiUpdate >= 200 || pendingEvents.length > 0 || latestSnapshot.ended)
				) {
					lastUiUpdate = now;
					onTick?.(latestSnapshot, pendingEvents);
				}
			}

			renderer.render(now);
			drawStructures();

			if (now - lastViewReport > 140) {
				cameraBridge.report();
				lastViewReport = now;
			}
			if (now - lastPerfReport > 1000) {
				onPerf?.({ ...renderer.stats });
				lastPerfReport = now;
			}

			frameId = requestAnimationFrame(frame);
		}

		async function initialize(): Promise<void> {
			try {
				renderer = await TerritoryRenderer.create(canvas, simulation);
				if (disposed) {
					renderer.destroy();
					renderer = null;
					return;
				}

				const camera = renderer.camera;
				const humanStart = simulation.map.starts[HUMAN_PLAYER_ID - 1];
				camera.focusOn(humanStart.x, humanStart.y, 3.8);

				renderer.onDeviceLost = (message) => {
					onError?.(new Error(message));
				};

				cameraBridge.attach({
					zoomIn: () => camera.zoomAt(camera.width / 2, camera.height / 2, 1.32),
					zoomOut: () => camera.zoomAt(camera.width / 2, camera.height / 2, 1 / 1.32),
					fitMap: () => camera.focusOn(simulation.width / 2, simulation.height / 2, 1),
					focusHuman: () => camera.focusOn(humanStart.x, humanStart.y, 3.8),
					centerOn: (x, y, zoom) => {
						if (zoom === undefined) camera.centerOn(x, y);
						else camera.focusOn(x, y, zoom);
					},
					getView: () => ({
						centerX: camera.centerX,
						centerY: camera.centerY,
						zoom: camera.zoom,
						scale: camera.scale,
						viewportWidth: camera.width,
						viewportHeight: camera.height,
						mapWidth: simulation.width,
						mapHeight: simulation.height
					})
				});

				onReady?.();
				onTick?.(simulation.getSnapshot(), []);
				lastTime = performance.now();
				frameId = requestAnimationFrame(frame);
			} catch (error) {
				const reason = error instanceof Error ? error : new Error(String(error));
				onError?.(reason);
			}
		}

		function localHover(clientX: number, clientY: number): void {
			if (!renderer) return;
			const rect = canvas.getBoundingClientRect();
			const screenX = clientX - rect.left;
			const screenY = clientY - rect.top;
			const point = renderer.camera.screenToMap(screenX, screenY);
			const x = Math.floor(point.x);
			const y = Math.floor(point.y);
			if (x < 0 || y < 0 || x >= simulation.width || y >= simulation.height) {
				renderer.hover = null;
				if (lastHoverKey !== 'none') {
					lastHoverKey = 'none';
					onHover?.(null);
				}
				return;
			}

			renderer.hover = { x, y };
			const now = performance.now();
			const owner = simulation.getOwner(x, y);
			const land = simulation.isLand(x, y);
			const elevation = simulation.getElevation(x, y);
			const baseDefense = simulation.getBaseDefense(x, y);
			const defense = simulation.getDefense(x, y);
			const key = `${x}:${y}:${owner}:${land}:${defense}`;
			if (now - lastHoverAt > 85 && key !== lastHoverKey) {
				lastHoverAt = now;
				lastHoverKey = key;
				onHover?.({ x, y, owner, land, elevation, baseDefense, defense });
			}
		}

		function handlePointerDown(event: PointerEvent): void {
			if (event.button !== 0 || !renderer) return;
			pointerActive = true;
			dragging = false;
			pointerStartX = event.clientX;
			pointerStartY = event.clientY;
			pointerLastX = event.clientX;
			pointerLastY = event.clientY;
			canvas.setPointerCapture(event.pointerId);
			localHover(event.clientX, event.clientY);
		}

		function handlePointerMove(event: PointerEvent): void {
			if (!renderer) return;
			localHover(event.clientX, event.clientY);
			if (!pointerActive) return;

			const dx = event.clientX - pointerLastX;
			const dy = event.clientY - pointerLastY;
			pointerLastX = event.clientX;
			pointerLastY = event.clientY;

			if (!dragging) {
				const totalX = event.clientX - pointerStartX;
				const totalY = event.clientY - pointerStartY;
				if (totalX * totalX + totalY * totalY > 16) dragging = true;
			}

			if (dragging) renderer.camera.panBy(dx, dy);
		}

		function handlePointerUp(event: PointerEvent): void {
			if (!renderer) return;
			if (pointerActive && !dragging) {
				const rect = canvas.getBoundingClientRect();
				const point = renderer.camera.screenToMap(
					event.clientX - rect.left,
					event.clientY - rect.top
				);
				onAttack?.(Math.floor(point.x), Math.floor(point.y));
			}
			pointerActive = false;
			dragging = false;
			if (canvas.hasPointerCapture(event.pointerId)) {
				canvas.releasePointerCapture(event.pointerId);
			}
			localHover(event.clientX, event.clientY);
		}

		function handlePointerLeave(): void {
			if (!renderer || pointerActive) return;
			renderer.hover = null;
			if (lastHoverKey !== 'none') {
				lastHoverKey = 'none';
				onHover?.(null);
			}
		}

		function handleWheel(event: WheelEvent): void {
			if (!renderer) return;
			event.preventDefault();
			const rect = canvas.getBoundingClientRect();
			const factor = Math.exp(-event.deltaY * 0.00135);
			renderer.camera.zoomAt(event.clientX - rect.left, event.clientY - rect.top, factor);
			cameraBridge.report();
			localHover(event.clientX, event.clientY);
		}

		// Pointer capture needs a listener with an explicit non-passive wheel.
		canvas.addEventListener('pointerdown', handlePointerDown);
		canvas.addEventListener('pointermove', handlePointerMove);
		canvas.addEventListener('pointerup', handlePointerUp);
		canvas.addEventListener('pointercancel', handlePointerUp);
		canvas.addEventListener('pointerleave', handlePointerLeave);
		canvas.addEventListener('wheel', handleWheel, { passive: false });

		void initialize();

		return () => {
			disposed = true;
			cancelAnimationFrame(frameId);
			cameraBridge.detach();
			renderer?.destroy();
			renderer = null;
			canvas.removeEventListener('pointerdown', handlePointerDown);
			canvas.removeEventListener('pointermove', handlePointerMove);
			canvas.removeEventListener('pointerup', handlePointerUp);
			canvas.removeEventListener('pointercancel', handlePointerUp);
			canvas.removeEventListener('pointerleave', handlePointerLeave);
			canvas.removeEventListener('wheel', handleWheel);
		};
	});
</script>

<canvas
	bind:this={canvas}
	class:grabbing={dragging}
	class="territory-canvas"
	aria-label="Territory map. Drag to pan, scroll to zoom, click to attack."
></canvas>

<canvas bind:this={structureCanvas} class="structure-canvas" aria-hidden="true"></canvas>

<style>
	.territory-canvas {
		position: absolute;
		inset: 0;
		display: block;
		width: 100%;
		height: 100%;
		touch-action: none;
		cursor: crosshair;
		outline: none;
	}

	.territory-canvas.grabbing {
		cursor: grabbing;
	}

	.structure-canvas {
		position: absolute;
		inset: 0;
		display: block;
		width: 100%;
		height: 100%;
		pointer-events: none;
	}
</style>
