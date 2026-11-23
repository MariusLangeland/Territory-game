import { TICK_MS } from '#lib/game/constants';
import { STRUCTURE_TYPE_CODES, type StructureType } from '#lib/game/structures';
import type { GameCameraBridge } from '#lib/game/render/camera-bridge';
import { TerritoryRenderer, type RendererFrameStats } from '#lib/game/render/territory-renderer';
import type { GameSnapshot, SimEvent, StepResult } from '#lib/game/simulation';
import type { SimulationView } from '#lib/game/simulation-view';
import { StructureOverlay } from './structure-overlay';
import type { RemoteVisual } from './types';

/** Cap on a single frame's delta so tab-switch stalls do not fire a step burst. */
const MAX_FRAME_DELTA_MS = 250;
/** Territory updates every tick, but snapshots only cross into Svelte at 5 Hz. */
const UI_SNAPSHOT_INTERVAL_MS = 200;
const CAMERA_REPORT_INTERVAL_MS = 140;
const PERF_REPORT_INTERVAL_MS = 1000;

/**
 * The component fills these seams with closures over its props, so the loop
 * observes live prop values without being recreated on every prop change.
 */
export interface CanvasFrameLoopHost {
	getSimulation(): SimulationView;
	getCameraBridge(): GameCameraBridge;
	isPaused(): boolean;
	isLocallySimulated(): boolean;
	getSpeedMultiplier(): number;
	getMaxStepsPerFrame(): number;
	isMergingDistricts(): boolean;
	getHighlightType(): StructureType | null;
	getHumanPlayerId(): number;
	getCameraFocus(): 'human' | 'map';
	isTargeting(): boolean;
	getSelectedOwnerId(): number | null;
	getRemoteVisuals(): readonly RemoteVisual[];
	acknowledgeRemoteVisuals(revision: number): void;
	emitTick(snapshot: GameSnapshot, events: SimEvent[]): void;
	emitPerf(stats: RendererFrameStats): void;
	emitReady(): void;
	emitError(error: Error): void;
}

/**
 * Owns the renderer and the single requestAnimationFrame loop for the map.
 *
 * The loop applies worker visual deltas in order (the worker waits for the
 * acknowledgement before sending the next delta), steps the local simulation
 * only when this component owns stepping, and drives both the WebGPU map and
 * the transparent 2D structure overlay from the same camera.
 */
export class CanvasFrameLoop {
	private readonly overlay: StructureOverlay;
	private renderer: TerritoryRenderer | null = null;
	private disposed = false;
	private frameId = 0;
	private lastTime = performance.now();
	private accumulator = 0;
	private lastViewReport = 0;
	private lastPerfReport = 0;
	private lastUiUpdate = 0;
	/** Latest throttled snapshot, used by the 2D supply banners and alliance rings. */
	private lastSnapshot: GameSnapshot | null = null;
	private lastRemoteRevision = -1;

	constructor(
		private readonly canvas: HTMLCanvasElement,
		structureCanvas: HTMLCanvasElement,
		private readonly host: CanvasFrameLoopHost
	) {
		this.overlay = new StructureOverlay(structureCanvas);
	}

	getRenderer(): TerritoryRenderer | null {
		return this.renderer;
	}

	start(): void {
		void this.initialize();
	}

	destroy(): void {
		if (this.disposed) return;
		this.disposed = true;
		cancelAnimationFrame(this.frameId);
		this.host.getCameraBridge().detach();
		this.renderer?.destroy();
		this.renderer = null;
	}

	private stepSimulation(): StepResult {
		const simulation = this.host.getSimulation();
		const step = simulation.step;
		if (!step) throw new Error('This simulation view is worker-owned and cannot be stepped here.');
		return step.call(simulation);
	}

	private applyRemoteVisual(visual: RemoteVisual): void {
		if (!this.renderer || visual.revision <= this.lastRemoteRevision) return;
		this.lastRemoteRevision = visual.revision;
		if (visual.overflow) {
			this.renderer.syncFromSimulation();
		} else {
			this.renderer.applyChanges(
				visual.changes,
				visual.changeCount,
				false,
				visual.districtTiles.length > 0,
				visual.districtTiles
			);
		}
		this.lastSnapshot = visual.snapshot;
	}

	private applyRemoteVisualQueue(): void {
		const remoteVisuals = this.host.getRemoteVisuals();
		if (this.host.isLocallySimulated() || !this.renderer || remoteVisuals.length === 0) return;
		let applied = false;
		for (const visual of remoteVisuals) {
			if (visual.revision <= this.lastRemoteRevision) continue;
			this.applyRemoteVisual(visual);
			applied = true;
		}
		if (applied) this.host.acknowledgeRemoteVisuals(this.lastRemoteRevision);
	}

	private readonly frame = (now: number): void => {
		const renderer = this.renderer;
		if (this.disposed || !renderer) return;
		// Apply every queued worker delta in order. The worker only sends one
		// visual at a time and waits for the acknowledgement below, so a frame
		// cannot silently skip a delta and leave the control texture stale.
		this.applyRemoteVisualQueue();
		const delta = Math.min(MAX_FRAME_DELTA_MS, Math.max(0, now - this.lastTime));
		this.lastTime = now;
		const simulation = this.host.getSimulation();

		// At 1000× the fast-forward loop can execute a thousand ticks between
		// useful visual updates. Applying every tick's renderer delta dominates
		// the frame; instead resync the whole control texture once per 1000
		// ticks and let the renderer upload it in chunks.
		if (!this.host.isLocallySimulated()) {
			this.accumulator = 0;
		} else if (this.host.isPaused() || simulation.ended) {
			this.accumulator = 0;
		} else {
			this.accumulator += delta * this.host.getSpeedMultiplier();
			let steps = 0;
			let latestSnapshot: GameSnapshot | null = null;
			const pendingEvents: SimEvent[] = [];
			const maxStepsPerFrame = this.host.getMaxStepsPerFrame();

			while (this.accumulator >= TICK_MS && steps < maxStepsPerFrame && !simulation.ended) {
				const result = this.stepSimulation();
				renderer.applyChanges(
					result.changes,
					result.changeCount,
					result.changesOverflow,
					result.districtsChanged,
					result.districtTiles
				);
				latestSnapshot = result.snapshot;
				pendingEvents.push(...result.events);
				this.accumulator -= TICK_MS;
				steps++;
			}
			if (steps >= maxStepsPerFrame) this.accumulator = 0;

			// Territory rendering updates every tick, but rebuilding 51 HUD
			// rows at 10 Hz creates avoidable main-thread spikes. Snapshots go
			// to Svelte at 5 Hz, or immediately on elimination/victory events.
			if (
				latestSnapshot &&
				(now - this.lastUiUpdate >= UI_SNAPSHOT_INTERVAL_MS ||
					pendingEvents.length > 0 ||
					latestSnapshot.ended)
			) {
				this.lastUiUpdate = now;
				this.lastSnapshot = latestSnapshot;
				this.host.emitTick(latestSnapshot, pendingEvents);
			}
		}

		renderer.mergeDistrictSeams = this.host.isMergingDistricts();
		const highlightType = this.host.getHighlightType();
		renderer.highlightDistrictCode = highlightType
			? STRUCTURE_TYPE_CODES[highlightType] * 4 - 3
			: 0;
		renderer.highlightDistrictOwner = highlightType ? this.host.getHumanPlayerId() : 0;
		renderer.render(now);
		this.overlay.draw({
			camera: renderer.camera,
			simulation,
			snapshot: this.lastSnapshot,
			targeting: this.host.isTargeting(),
			humanPlayerId: this.host.getHumanPlayerId(),
			mergeDistricts: this.host.isMergingDistricts(),
			selectedOwnerId: this.host.getSelectedOwnerId()
		});

		if (now - this.lastViewReport > CAMERA_REPORT_INTERVAL_MS) {
			this.host.getCameraBridge().report();
			this.lastViewReport = now;
		}
		if (now - this.lastPerfReport > PERF_REPORT_INTERVAL_MS) {
			this.host.emitPerf({ ...renderer.stats });
			this.lastPerfReport = now;
		}

		this.frameId = requestAnimationFrame(this.frame);
	};

	private async initialize(): Promise<void> {
		try {
			this.renderer = await TerritoryRenderer.create(this.canvas, this.host.getSimulation());
			if (this.disposed) {
				this.renderer.destroy();
				this.renderer = null;
				return;
			}

			this.applyRemoteVisualQueue();

			const simulation = this.host.getSimulation();
			const camera = this.renderer.camera;
			const humanStart = simulation.map.starts[this.host.getHumanPlayerId() - 1];
			if (this.host.getCameraFocus() === 'map') {
				camera.focusOn(simulation.width / 2, simulation.height / 2, 1);
			} else {
				camera.focusOn(humanStart.x, humanStart.y, 3.8);
			}

			this.renderer.onDeviceLost = (message) => {
				this.host.emitError(new Error(message));
			};

			this.host.getCameraBridge().attach({
				zoomIn: () => camera.zoomAt(camera.width / 2, camera.height / 2, 1.32),
				zoomOut: () => camera.zoomAt(camera.width / 2, camera.height / 2, 1 / 1.32),
				fitMap: () => camera.focusOn(simulation.width / 2, simulation.height / 2, 1),
				focusHuman: () => camera.focusOn(humanStart.x, humanStart.y, 3.8),
				centerOn: (x, y, zoom) => {
					if (zoom === undefined) camera.centerOn(x, y);
					else camera.focusOn(x, y, zoom);
				},
				getView: () => {
					const current = this.host.getSimulation();
					return {
						centerX: camera.centerX,
						centerY: camera.centerY,
						zoom: camera.zoom,
						scale: camera.scale,
						viewportWidth: camera.width,
						viewportHeight: camera.height,
						mapWidth: current.width,
						mapHeight: current.height
					};
				}
			});

			this.host.emitReady();
			this.lastSnapshot = simulation.getSnapshot();
			this.host.emitTick(this.lastSnapshot, []);
			this.lastTime = performance.now();
			this.frameId = requestAnimationFrame(this.frame);
		} catch (error) {
			const reason = error instanceof Error ? error : new Error(String(error));
			this.host.emitError(reason);
		}
	}
}
