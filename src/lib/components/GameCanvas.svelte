<script lang="ts">
	import { onMount } from 'svelte';
	import { HUMAN_PLAYER_ID, TICK_MS, colorForPlayer } from '#lib/game/constants';
	import type { GameSnapshot, SimEvent, TerritorySimulation } from '#lib/game/simulation';
	import { STRUCTURE_ACCENTS } from '#lib/game/Structures';
	import { GameCameraBridge } from '#lib/game/render/camera-bridge';
	import { TerritoryRenderer, type RendererFrameStats } from '#lib/game/render/territory-renderer';

	// Marker radii are screen pixels, deliberately independent of camera scale:
	// structures stay the same size on screen as the player zooms.
	const STATE_HUMAN_MARKER_RADIUS = 15;
	const STATE_BOT_MARKER_RADIUS = 11;
	const BUILDABLE_MARKER_RADIUS = 10;

	interface HoverInfo {
		x: number;
		y: number;
		owner: number;
		land: boolean;
		elevation: number;
		baseDefense: number;
		auraDefense: number;
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

		function drawStar(
			context: CanvasRenderingContext2D,
			x: number,
			y: number,
			outer: number,
			inner: number
		): void {
			context.beginPath();
			for (let i = 0; i < 10; i++) {
				const radius = i % 2 === 0 ? outer : inner;
				const angle = -Math.PI / 2 + (i * Math.PI) / 5;
				const px = x + Math.cos(angle) * radius;
				const py = y + Math.sin(angle) * radius;
				if (i === 0) context.moveTo(px, py);
				else context.lineTo(px, py);
			}
			context.closePath();
		}

		function drawPickaxe(
			context: CanvasRenderingContext2D,
			x: number,
			y: number,
			radius: number
		): void {
			context.beginPath();
			context.moveTo(x - radius * 0.5, y + radius * 0.55);
			context.lineTo(x + radius * 0.35, y - radius * 0.45);
			context.stroke();
			context.beginPath();
			context.arc(x + radius * 0.2, y - radius * 0.3, radius * 0.5, -Math.PI * 0.8, Math.PI * 0.1);
			context.stroke();
		}

		function drawCrossedSwords(
			context: CanvasRenderingContext2D,
			x: number,
			y: number,
			radius: number
		): void {
			context.beginPath();
			context.moveTo(x - radius * 0.55, y + radius * 0.55);
			context.lineTo(x + radius * 0.55, y - radius * 0.55);
			context.moveTo(x - radius * 0.55, y - radius * 0.55);
			context.lineTo(x + radius * 0.55, y + radius * 0.55);
			context.stroke();
		}

		function drawShield(
			context: CanvasRenderingContext2D,
			x: number,
			y: number,
			radius: number
		): void {
			context.beginPath();
			context.moveTo(x, y - radius * 0.72);
			context.lineTo(x + radius * 0.58, y - radius * 0.32);
			context.lineTo(x + radius * 0.42, y + radius * 0.36);
			context.quadraticCurveTo(x, y + radius * 0.78, x - radius * 0.42, y + radius * 0.36);
			context.lineTo(x - radius * 0.58, y - radius * 0.32);
			context.closePath();
			context.stroke();
		}

		function drawCommandPost(
			context: CanvasRenderingContext2D,
			x: number,
			y: number,
			radius: number
		): void {
			context.beginPath();
			context.moveTo(x, y + radius * 0.65);
			context.lineTo(x, y - radius * 0.55);
			context.moveTo(x - radius * 0.45, y + radius * 0.65);
			context.lineTo(x + radius * 0.45, y + radius * 0.65);
			context.stroke();
			context.beginPath();
			context.arc(x, y - radius * 0.1, radius * 0.42, -Math.PI * 0.8, -Math.PI * 0.2);
			context.stroke();
		}

		function drawWarAcademy(
			context: CanvasRenderingContext2D,
			x: number,
			y: number,
			radius: number
		): void {
			context.beginPath();
			context.moveTo(x, y - radius * 0.7);
			context.lineTo(x + radius * 0.65, y - radius * 0.3);
			context.lineTo(x, y + radius * 0.1);
			context.lineTo(x - radius * 0.65, y - radius * 0.3);
			context.closePath();
			context.moveTo(x - radius * 0.55, y + radius * 0.18);
			context.lineTo(x, y + radius * 0.48);
			context.lineTo(x + radius * 0.55, y + radius * 0.18);
			context.stroke();
		}

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

			// Auras render beneath every capital so markers stay crisp. At atlas
			// zoom the aura is smaller than the marker and is intentionally hidden.
			for (const structure of simulation.structures.all) {
				const point = camera.mapToScreen(structure.x + 0.5, structure.y + 0.5);
				for (const effect of structure.effects) {
					if (effect.kind !== 'defense-aura' && effect.kind !== 'attack-aura') continue;
					const auraRadius = effect.radius * camera.scale;
					if (auraRadius < 16) continue;
					if (
						point.x < -auraRadius ||
						point.y < -auraRadius ||
						point.x > width + auraRadius ||
						point.y > height + auraRadius
					) {
						continue;
					}

					const human = structure.ownerId === HUMAN_PLAYER_ID;
					const attackAura = effect.kind === 'attack-aura';
					const color = attackAura
						? ([255, 184, 94] as const)
						: colorForPlayer(structure.ownerId).rgb;
					context.beginPath();
					context.arc(point.x, point.y, auraRadius, 0, Math.PI * 2);
					context.fillStyle = attackAura
						? 'rgba(255, 184, 94, 0.045)'
						: `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${human ? 0.16 : 0.085})`;
					context.fill();
					context.setLineDash(attackAura ? [2, 7] : [5, 5]);
					context.lineWidth = human ? 1.6 : 1.2;
					context.strokeStyle = attackAura
						? 'rgba(255, 184, 94, 0.42)'
						: `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${human ? 0.68 : 0.45})`;
					context.stroke();
					context.setLineDash([]);
				}
			}

			for (const structure of simulation.structures.all) {
				const point = camera.mapToScreen(structure.x + 0.5, structure.y + 0.5);
				if (point.x < -18 || point.y < -18 || point.x > width + 18 || point.y > height + 18) {
					continue;
				}

				const human = structure.ownerId === HUMAN_PLAYER_ID;
				const isState = structure.type === 'state';
				const radius = isState
					? human
						? STATE_HUMAN_MARKER_RADIUS
						: STATE_BOT_MARKER_RADIUS
					: BUILDABLE_MARKER_RADIUS;
				const ownerColor = colorForPlayer(structure.ownerId);
				const accent = STRUCTURE_ACCENTS[structure.type];
				const x = point.x;
				const y = point.y;

				// A dark halo keeps every structure readable over bright terrain
				// and territory colors. State keeps the owner-colored disc; buildables
				// use a dark badge with an owner ring so their type icon stays legible.
				context.beginPath();
				context.arc(x, y, radius + 4, 0, Math.PI * 2);
				context.fillStyle = 'rgba(2, 8, 12, 0.42)';
				context.fill();
				context.beginPath();
				context.arc(x, y, radius + 2, 0, Math.PI * 2);
				context.fillStyle = 'rgba(4, 12, 16, 0.92)';
				context.fill();

				context.beginPath();
				context.arc(x, y, radius, 0, Math.PI * 2);
				context.fillStyle = isState ? ownerColor.hex : 'rgba(5, 15, 20, 0.96)';
				context.fill();
				context.lineWidth = isState ? (human ? 2.4 : 2) : 2.6;
				context.strokeStyle = isState ? 'rgba(252, 246, 225, 0.96)' : ownerColor.hex;
				context.stroke();

				if (human && isState) {
					context.beginPath();
					context.arc(x, y, radius + 5.5, 0, Math.PI * 2);
					context.lineWidth = 1.4;
					context.strokeStyle = 'rgba(252, 246, 225, 0.34)';
					context.stroke();
				}

				context.strokeStyle = isState ? 'rgba(255, 248, 225, 0.98)' : accent;
				context.lineWidth = isState ? 1.8 : 2.1;
				context.lineCap = 'round';
				context.lineJoin = 'round';
				if (structure.type === 'state') {
					drawStar(context, x, y, radius * 0.58, radius * 0.24);
					context.fillStyle = 'rgba(255, 248, 225, 0.98)';
					context.fill();
					context.lineWidth = 1;
					context.strokeStyle = 'rgba(5, 14, 18, 0.88)';
					context.stroke();
				} else if (structure.type === 'mine') {
					drawPickaxe(context, x, y, radius);
				} else if (structure.type === 'barracks') {
					drawCrossedSwords(context, x, y, radius);
				} else if (structure.type === 'defense-post') {
					drawShield(context, x, y, radius);
				} else if (structure.type === 'command-post') {
					drawCommandPost(context, x, y, radius);
				} else {
					drawWarAcademy(context, x, y, radius);
				}
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
			const auraDefense = simulation.getAuraDefense(x, y);
			const defense = simulation.getDefense(x, y);
			const key = `${x}:${y}:${owner}:${land}:${auraDefense}:${defense}`;
			if (now - lastHoverAt > 85 && key !== lastHoverKey) {
				lastHoverAt = now;
				lastHoverKey = key;
				onHover?.({ x, y, owner, land, elevation, baseDefense, auraDefense, defense });
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
