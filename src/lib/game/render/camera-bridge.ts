export interface CameraView {
	centerX: number;
	centerY: number;
	zoom: number;
	scale: number;
	viewportWidth: number;
	viewportHeight: number;
	mapWidth: number;
	mapHeight: number;
}

export interface CameraActions {
	zoomIn(): void;
	zoomOut(): void;
	fitMap(): void;
	focusHuman(): void;
	centerOn(x: number, y: number, zoom?: number): void;
	getView(): CameraView;
}

/**
 * A tiny imperative bridge between Svelte controls and the renderer owned by
 * GameCanvas. Keeping this out of component exports avoids tying UI controls to
 * Svelte's component-instance API.
 */
export class GameCameraBridge {
	onView?: (view: CameraView) => void;
	private actions: CameraActions | null = null;

	attach(actions: CameraActions): void {
		this.actions = actions;
		this.report();
	}

	detach(): void {
		this.actions = null;
	}

	zoomIn(): void {
		this.actions?.zoomIn();
		this.report();
	}

	zoomOut(): void {
		this.actions?.zoomOut();
		this.report();
	}

	fitMap(): void {
		this.actions?.fitMap();
		this.report();
	}

	focusHuman(): void {
		this.actions?.focusHuman();
		this.report();
	}

	centerOn(x: number, y: number, zoom?: number): void {
		this.actions?.centerOn(x, y, zoom);
		this.report();
	}

	getView(): CameraView | null {
		return this.actions?.getView() ?? null;
	}

	report(): void {
		if (!this.actions || !this.onView) return;
		this.onView(this.actions.getView());
	}
}
