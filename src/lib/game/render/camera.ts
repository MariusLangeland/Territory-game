/**
 * 2D map camera. All public screen coordinates are CSS pixels; the renderer
 * multiplies by devicePixelRatio when writing shader uniforms.
 */
export class MapCamera {
	width = 1;
	height = 1;
	centerX: number;
	centerY: number;
	zoom = 1;

	readonly minZoom = 0.82;
	readonly maxZoom = 18;

	constructor(
		readonly mapWidth: number,
		readonly mapHeight: number
	) {
		this.centerX = mapWidth / 2;
		this.centerY = mapHeight / 2;
	}

	/** CSS pixels per map pixel at the current zoom. */
	get scale(): number {
		return this.fitScale * this.zoom;
	}

	get fitScale(): number {
		return Math.min(this.width / this.mapWidth, this.height / this.mapHeight);
	}

	setViewport(width: number, height: number): void {
		this.width = Math.max(1, width);
		this.height = Math.max(1, height);
	}

	centerOn(x: number, y: number): void {
		this.centerX = x;
		this.centerY = y;
	}

	focusOn(x: number, y: number, zoom: number): void {
		this.zoom = clamp(zoom, this.minZoom, this.maxZoom);
		this.centerOn(x, y);
	}

	panBy(dx: number, dy: number): void {
		const scale = Math.max(0.00001, this.scale);
		this.centerX -= dx / scale;
		this.centerY -= dy / scale;
	}

	zoomAt(screenX: number, screenY: number, factor: number): void {
		const before = this.screenToMap(screenX, screenY);
		const nextZoom = clamp(this.zoom * factor, this.minZoom, this.maxZoom);
		if (nextZoom === this.zoom) return;

		this.zoom = nextZoom;
		const dx = screenX - this.width / 2;
		const dy = screenY - this.height / 2;
		this.centerX = before.x - dx / this.scale;
		this.centerY = before.y - dy / this.scale;
	}

	setZoom(zoom: number): void {
		const before = this.screenToMap(this.width / 2, this.height / 2);
		this.zoom = clamp(zoom, this.minZoom, this.maxZoom);
		this.centerX = before.x;
		this.centerY = before.y;
	}

	screenToMap(screenX: number, screenY: number): { x: number; y: number } {
		const scale = Math.max(0.00001, this.scale);
		return {
			x: this.centerX + (screenX - this.width / 2) / scale,
			y: this.centerY + (screenY - this.height / 2) / scale
		};
	}

	mapToScreen(x: number, y: number): { x: number; y: number } {
		const scale = Math.max(0.00001, this.scale);
		return {
			x: this.width / 2 + (x - this.centerX) * scale,
			y: this.height / 2 + (y - this.centerY) * scale
		};
	}
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
