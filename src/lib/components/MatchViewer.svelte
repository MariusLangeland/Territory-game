<script lang="ts">
	import GameCanvas from './GameCanvas.svelte';
	import type { GameSnapshot, SimEvent } from '#lib/game/simulation';
	import type { SimulationView } from '#lib/game/simulation-view';
	import type { StructureType } from '#lib/game/structures';
	import type { GameCameraBridge } from '#lib/game/render/camera-bridge';
	import type { RendererFrameStats } from '#lib/game/render/territory-renderer';
	import type { HoverInfo, RemoteVisual } from '#lib/game/canvas';

	interface Props {
		simulation: SimulationView;
		paused: boolean;
		simulate?: boolean;
		remoteVisuals?: RemoteVisual[];
		onRemoteVisualsApplied?: (revision: number) => void;
		targeting?: boolean;
		allyTarget?: boolean;
		humanPlayerId?: number;
		mergeDistricts?: boolean;
		highlightType?: StructureType | null;
		cameraBridge: GameCameraBridge;
		speedMultiplier?: number;
		maxStepsPerFrame?: number;
		cameraFocus?: 'human' | 'map';
		onTick?: (snapshot: GameSnapshot, events: SimEvent[]) => void;
		onHover?: (hover: HoverInfo | null) => void;
		onAttack?: (x: number, y: number) => void;
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
		humanPlayerId,
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
</script>

<div class="match-viewer">
	<GameCanvas
		{simulation}
		{paused}
		{simulate}
		{remoteVisuals}
		{onRemoteVisualsApplied}
		{targeting}
		{allyTarget}
		{humanPlayerId}
		{mergeDistricts}
		{highlightType}
		{cameraBridge}
		{speedMultiplier}
		{maxStepsPerFrame}
		{cameraFocus}
		{onTick}
		{onHover}
		{onAttack}
		{selectedOwnerId}
		{onSelectOwner}
		{onError}
		{onReady}
		{onPerf}
	/>
</div>

<style>
	.match-viewer {
		position: relative;
		width: 100%;
		height: 100%;
	}
</style>
