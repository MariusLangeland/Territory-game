<script lang="ts">
	import GameCanvas from './GameCanvas.svelte';
	import ReplayTimeline from './ReplayTimeline.svelte';
	import LedgerViewer from './LedgerViewer.svelte';
	import type { GameSnapshot, SimEvent } from '#lib/game/simulation';
	import type { SimulationView } from '#lib/game/simulation-view';
	import type { StructureType } from '#lib/game/structures';
	import type { GameCameraBridge } from '#lib/game/render/camera-bridge';
	import type { RendererFrameStats } from '#lib/game/render/territory-renderer';
	import type { HoverInfo, RemoteVisual } from '#lib/game/canvas';
	import type { LedgerBlock } from '#lib/game/ledger/agent';

	export interface ReplayPanelOptions {
		tick: number;
		maxTick: number;
		playing: boolean;
		speed: number;
		complete: boolean;
		blocks: LedgerBlock[];
		currentTick: number;
		onSeek: (tick: number) => void;
		onToggle: () => void;
		onStep: (delta: number) => void;
		onSpeed: (speed: number) => void;
	}

	export interface PlaybackOptions {
		playing: boolean;
		speed: number;
		options: readonly { label: string; value: number }[];
		onToggle: () => void;
		onSpeed: (speed: number) => void;
	}

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
		replay?: ReplayPanelOptions | null;
		playback?: PlaybackOptions | null;
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
		onPerf,
		replay = null,
		playback = null
	}: Props = $props();
</script>

<div class="replay-viewer">
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

	{#if replay}
		<div class="viewer-panel">
			<ReplayTimeline
				tick={replay.tick}
				maxTick={replay.maxTick}
				playing={replay.playing}
				speed={replay.speed}
				complete={replay.complete}
				onSeek={replay.onSeek}
				onToggle={replay.onToggle}
				onStep={replay.onStep}
				onSpeed={replay.onSpeed}
			/>
			<LedgerViewer
				blocks={replay.blocks}
				currentTick={replay.currentTick}
				onSeek={replay.onSeek}
			/>
		</div>
	{:else if playback}
		<div class="viewer-controls">
			<button type="button" onclick={playback.onToggle}>
				{playback.playing ? 'PAUSE' : 'PLAY'}
			</button>
			{#each playback.options as option (option.value)}
				<button
					type="button"
					class:active={playback.speed === option.value}
					onclick={() => playback.onSpeed(option.value)}
				>
					{option.label}
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.replay-viewer {
		position: relative;
		width: 100%;
		height: 100%;
	}

	.viewer-panel {
		position: absolute;
		z-index: 30;
		bottom: 18px;
		left: 50%;
		display: flex;
		flex-direction: column;
		gap: 4px;
		width: min(760px, calc(100vw - 28px));
		padding: 8px 10px;
		transform: translateX(-50%);
		border: 1px solid rgba(120, 224, 232, 0.32);
		background: rgba(4, 12, 15, 0.9);
		backdrop-filter: blur(12px);
	}

	.viewer-controls {
		position: absolute;
		z-index: 30;
		bottom: 12px;
		left: 50%;
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		padding: 4px 7px;
		transform: translateX(-50%);
		border: 1px solid var(--line-soft);
		background: rgba(4, 12, 15, 0.86);
		font-family: var(--font-mono);
		font-size: var(--text-7);
		color: var(--ink-dim);
	}

	.viewer-controls button {
		padding: 2px 6px;
		border: 1px solid var(--line-soft);
		background: var(--bg-raised);
		color: inherit;
		font: inherit;
		cursor: pointer;
	}

	.viewer-controls button.active {
		border-color: var(--signal-55);
		color: var(--signal-strong);
	}

	@media (max-width: 620px) {
		.viewer-panel {
			bottom: 8px;
			width: calc(100vw - 16px);
			padding: 6px;
		}
	}
</style>
