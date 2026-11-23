import type { GameCameraBridge } from '#lib/game/render/camera-bridge';
import type { TerritoryRenderer } from '#lib/game/render/territory-renderer';
import type { SimulationView } from '#lib/game/simulation-view';
import type { HoverInfo } from './types';

/** Squared pointer travel (4 px) that turns a press into a camera drag. */
const DRAG_START_DISTANCE_SQUARED = 16;
/** Throttle for HUD hover updates; the renderer highlight itself is not throttled. */
const HOVER_THROTTLE_MS = 85;
/** Wheel delta-to-zoom response. */
const WHEEL_ZOOM_SENSITIVITY = 0.00135;
const MIN_PINCH_RATIO = 0.5;
const MAX_PINCH_RATIO = 2;

/**
 * The component fills these seams. Renderer and simulation are pulled through
 * getters so a world rebuild or late async renderer init is always visible here.
 */
export interface CanvasInputHost {
	getRenderer(): TerritoryRenderer | null;
	getSimulation(): SimulationView;
	getCameraBridge(): GameCameraBridge;
	/** Mirror the drag state into component state so the cursor class can update. */
	onDraggingChange(dragging: boolean): void;
	onHover(hover: HoverInfo | null): void;
	/** A click that was not a drag or pinch: select a spectator owner or attack. */
	onTap(x: number, y: number): void;
}

/**
 * Pointer, touch, and wheel interaction for the map canvas.
 *
 * Pointer capture semantics are deliberate: a captured pointer keeps panning
 * and pinch-zoom events flowing even when it leaves the canvas, and a tap is
 * only emitted when the press did not turn into a drag or a pinch gesture.
 */
export class CanvasPointerInput {
	private readonly activePointers = new Map<number, { x: number; y: number }>();
	private dragging = false;
	private pointerActive = false;
	private pointerStartX = 0;
	private pointerStartY = 0;
	private pointerLastX = 0;
	private pointerLastY = 0;
	private pinchActive = false;
	private pinchDistance = 0;
	private pinchCentreX = 0;
	private pinchCentreY = 0;
	private suppressNextTap = false;
	private lastHoverKey = '';
	private lastHoverAt = 0;

	constructor(
		private readonly canvas: HTMLCanvasElement,
		private readonly host: CanvasInputHost
	) {}

	attach(): void {
		// A non-passive wheel listener is required to prevent page scroll.
		this.canvas.addEventListener('pointerdown', this.handlePointerDown);
		this.canvas.addEventListener('pointermove', this.handlePointerMove);
		this.canvas.addEventListener('pointerup', this.handlePointerUp);
		this.canvas.addEventListener('pointercancel', this.handlePointerUp);
		this.canvas.addEventListener('pointerleave', this.handlePointerLeave);
		this.canvas.addEventListener('wheel', this.handleWheel, { passive: false });
	}

	detach(): void {
		this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
		this.canvas.removeEventListener('pointermove', this.handlePointerMove);
		this.canvas.removeEventListener('pointerup', this.handlePointerUp);
		this.canvas.removeEventListener('pointercancel', this.handlePointerUp);
		this.canvas.removeEventListener('pointerleave', this.handlePointerLeave);
		this.canvas.removeEventListener('wheel', this.handleWheel);
	}

	private setDragging(next: boolean): void {
		if (this.dragging === next) return;
		this.dragging = next;
		this.host.onDraggingChange(next);
	}

	/** Map a client-space point to the cell under the pointer and report hover. */
	private localHover(clientX: number, clientY: number): void {
		const renderer = this.host.getRenderer();
		if (!renderer) return;
		const simulation = this.host.getSimulation();
		const rect = this.canvas.getBoundingClientRect();
		const screenX = clientX - rect.left;
		const screenY = clientY - rect.top;
		const point = renderer.camera.screenToMap(screenX, screenY);
		const x = Math.floor(point.x);
		const y = Math.floor(point.y);
		if (x < 0 || y < 0 || x >= simulation.width || y >= simulation.height) {
			renderer.hover = null;
			if (this.lastHoverKey !== 'none') {
				this.lastHoverKey = 'none';
				this.host.onHover(null);
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
		if (now - this.lastHoverAt > HOVER_THROTTLE_MS && key !== this.lastHoverKey) {
			this.lastHoverAt = now;
			this.lastHoverKey = key;
			this.host.onHover({ x, y, owner, land, elevation, baseDefense, auraDefense, defense });
		}
	}

	private pinchGeometry(): { distance: number; x: number; y: number } | null {
		const points = [...this.activePointers.values()];
		if (points.length < 2) return null;
		const [a, b] = points;
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		return {
			distance: Math.hypot(dx, dy),
			x: (a.x + b.x) / 2,
			y: (a.y + b.y) / 2
		};
	}

	private readonly handlePointerDown = (event: PointerEvent): void => {
		if ((event.pointerType === 'mouse' && event.button !== 0) || !this.host.getRenderer()) return;
		this.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
		this.canvas.setPointerCapture(event.pointerId);

		if (this.activePointers.size === 2) {
			const geometry = this.pinchGeometry();
			if (geometry) {
				this.pinchActive = true;
				this.suppressNextTap = true;
				this.pointerActive = false;
				this.setDragging(false);
				this.pinchDistance = geometry.distance;
				this.pinchCentreX = geometry.x;
				this.pinchCentreY = geometry.y;
			}
			return;
		}
		if (this.activePointers.size > 2) return;

		this.pointerActive = true;
		this.setDragging(false);
		this.pointerStartX = event.clientX;
		this.pointerStartY = event.clientY;
		this.pointerLastX = event.clientX;
		this.pointerLastY = event.clientY;
		this.localHover(event.clientX, event.clientY);
	};

	private readonly handlePointerMove = (event: PointerEvent): void => {
		const renderer = this.host.getRenderer();
		if (!renderer) return;
		if (this.activePointers.has(event.pointerId)) {
			this.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
		}

		if (this.pinchActive) {
			const geometry = this.pinchGeometry();
			if (geometry && this.pinchDistance > 0) {
				const rect = this.canvas.getBoundingClientRect();
				const ratio = Math.max(
					MIN_PINCH_RATIO,
					Math.min(MAX_PINCH_RATIO, geometry.distance / this.pinchDistance)
				);
				renderer.camera.zoomAt(geometry.x - rect.left, geometry.y - rect.top, ratio);
				renderer.camera.panBy(geometry.x - this.pinchCentreX, geometry.y - this.pinchCentreY);
				this.pinchDistance = geometry.distance;
				this.pinchCentreX = geometry.x;
				this.pinchCentreY = geometry.y;
				this.host.getCameraBridge().report();
			}
			return;
		}

		this.localHover(event.clientX, event.clientY);
		if (!this.pointerActive) return;

		const dx = event.clientX - this.pointerLastX;
		const dy = event.clientY - this.pointerLastY;
		this.pointerLastX = event.clientX;
		this.pointerLastY = event.clientY;

		if (!this.dragging) {
			const totalX = event.clientX - this.pointerStartX;
			const totalY = event.clientY - this.pointerStartY;
			if (totalX * totalX + totalY * totalY > DRAG_START_DISTANCE_SQUARED) this.setDragging(true);
		}

		if (this.dragging) renderer.camera.panBy(dx, dy);
	};

	private readonly handlePointerUp = (event: PointerEvent): void => {
		const renderer = this.host.getRenderer();
		if (!renderer) return;
		const wasPinching = this.pinchActive;
		this.activePointers.delete(event.pointerId);

		if (wasPinching) {
			this.pinchActive = false;
			this.pointerActive = false;
			this.setDragging(false);
			const remaining = this.pinchGeometry();
			if (remaining) {
				this.pinchDistance = remaining.distance;
				this.pinchCentreX = remaining.x;
				this.pinchCentreY = remaining.y;
				this.pinchActive = true;
			}
		} else if (this.pointerActive && !this.dragging && !this.suppressNextTap) {
			const rect = this.canvas.getBoundingClientRect();
			const point = renderer.camera.screenToMap(
				event.clientX - rect.left,
				event.clientY - rect.top
			);
			this.host.onTap(Math.floor(point.x), Math.floor(point.y));
		}

		if (this.activePointers.size === 0) this.suppressNextTap = false;
		this.pointerActive = false;
		this.setDragging(false);
		if (this.canvas.hasPointerCapture(event.pointerId)) {
			this.canvas.releasePointerCapture(event.pointerId);
		}
		this.localHover(event.clientX, event.clientY);
	};

	private readonly handlePointerLeave = (): void => {
		const renderer = this.host.getRenderer();
		if (!renderer || this.pointerActive) return;
		renderer.hover = null;
		if (this.lastHoverKey !== 'none') {
			this.lastHoverKey = 'none';
			this.host.onHover(null);
		}
	};

	private readonly handleWheel = (event: WheelEvent): void => {
		const renderer = this.host.getRenderer();
		if (!renderer) return;
		event.preventDefault();
		const rect = this.canvas.getBoundingClientRect();
		const factor = Math.exp(-event.deltaY * WHEEL_ZOOM_SENSITIVITY);
		renderer.camera.zoomAt(event.clientX - rect.left, event.clientY - rect.top, factor);
		this.host.getCameraBridge().report();
		this.localHover(event.clientX, event.clientY);
	};
}
