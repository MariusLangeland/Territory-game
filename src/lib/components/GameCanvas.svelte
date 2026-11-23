<script lang="ts">
	import { onMount } from 'svelte';
	import { HUMAN_PLAYER_ID } from '#lib/game/constants';
	import type { GameSnapshot, SimEvent } from '#lib/game/simulation';
	import type { SimulationView } from '#lib/game/simulation-view';
	import type { StructureType } from '#lib/game/structures';
	import type { GameCameraBridge } from '#lib/game/render/camera-bridge';
	import type { RendererFrameStats } from '#lib/game/render/territory-renderer';
	import { CanvasFrameLoop, CanvasPointerInput } from '#lib/game/canvas';
	import type { HoverInfo, RemoteVisual } from '#lib/game/canvas';

	interface Props {
		simulation: SimulationView;
		paused: boolean;
		/** When false, the simulation is advanced by a worker instead of this frame loop. */
		simulate?: boolean;
		remoteVisuals?: RemoteVisual[];
		onRemoteVisualsApplied?: (revision: number) => void;
		targeting?: boolean;
		/** The pointer is over an allied state; suppress the attack cursor. */
		allyTarget?: boolean;
		/** Seat controlled by this client; defaults to the local human seat. */
		humanPlayerId?: number;
		mergeDistricts?: boolean;
		highlightType?: StructureType | null;
		cameraBridge: GameCameraBridge;
		/** Spectator fast-forward; normal gameplay keeps 1× and the 4-step clamp. */
		speedMultiplier?: number;
		maxStepsPerFrame?: number;
		/** Evolution spectators start with the whole map visible. */
		cameraFocus?: 'human' | 'map';
		onTick?: (snapshot: GameSnapshot, events: SimEvent[]) => void;
		onHover?: (hover: HoverInfo | null) => void;
		onAttack?: (x: number, y: number) => void;
		/** Spectator genome selection: click an occupied cell to select its owner. */
		selectedOwnerId?: number | null;
		onSelectOwner?: (ownerId: number | null) => void;
		onError?: (error: Error) => void;
		onReady?: () => void;
		onPerf?: (stats: RendererFrameStats) => void;
	}

	let {
		simulation,
		paused,
		simulate = true,
		remoteVisuals = [],
		onRemoteVisualsApplied,
		targeting = false,
		allyTarget = false,
		humanPlayerId = HUMAN_PLAYER_ID,
		mergeDistricts = true,
		highlightType = null,
		cameraBridge,
		speedMultiplier = 1,
		maxStepsPerFrame = 4,
		cameraFocus = 'human',
		onTick,
		onHover,
		onAttack,
		selectedOwnerId = null,
		onSelectOwner,
		onError,
		onReady,
		onPerf
	}: Props = $props();

	let canvas: HTMLCanvasElement;
	let structureCanvas: HTMLCanvasElement;
	let dragging = $state(false);

	onMount(() => {
		// The controllers only hold callbacks and getters; the Svelte component
		// keeps props, canvases, and the reactive drag cursor class.
		const frameLoop = new CanvasFrameLoop(canvas, structureCanvas, {
			getSimulation: () => simulation,
			getCameraBridge: () => cameraBridge,
			isPaused: () => paused,
			isLocallySimulated: () => simulate,
			getSpeedMultiplier: () => speedMultiplier,
			getMaxStepsPerFrame: () => maxStepsPerFrame,
			isMergingDistricts: () => mergeDistricts,
			getHighlightType: () => highlightType,
			getHumanPlayerId: () => humanPlayerId,
			getCameraFocus: () => cameraFocus,
			isTargeting: () => targeting,
			getSelectedOwnerId: () => selectedOwnerId,
			getRemoteVisuals: () => remoteVisuals,
			acknowledgeRemoteVisuals: (revision) => onRemoteVisualsApplied?.(revision),
			emitTick: (snapshot, events) => onTick?.(snapshot, events),
			emitPerf: (stats) => onPerf?.(stats),
			emitReady: () => onReady?.(),
			emitError: (error) => onError?.(error)
		});

		const input = new CanvasPointerInput(canvas, {
			getRenderer: () => frameLoop.getRenderer(),
			getSimulation: () => simulation,
			getCameraBridge: () => cameraBridge,
			onDraggingChange: (value) => {
				dragging = value;
			},
			onHover: (hover) => onHover?.(hover),
			onTap: (x, y) => {
				if (onSelectOwner) {
					const owner =
						x >= 0 && y >= 0 && x < simulation.width && y < simulation.height
							? (simulation.owners[y * simulation.width + x] ?? 0)
							: 0;
					onSelectOwner(owner > 0 ? owner : null);
				} else {
					onAttack?.(x, y);
				}
			}
		});

		input.attach();
		frameLoop.start();

		return () => {
			input.detach();
			frameLoop.destroy();
		};
	});
</script>

<canvas
	bind:this={canvas}
	class:grabbing={dragging}
	class="territory-canvas"
	class:targeting
	class:ally-target={allyTarget && !targeting}
	aria-label={targeting
		? 'Artillery targeting. Click a hostile structure near the aim point to fire.'
		: 'Territory map. Drag to pan, scroll to zoom, click to attack.'}
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

	.territory-canvas.targeting {
		cursor: cell;
	}

	.territory-canvas.ally-target {
		cursor: not-allowed;
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
