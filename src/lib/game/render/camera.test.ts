import { describe, expect, it } from 'vitest';
import { MapCamera } from './camera';

describe('MapCamera', () => {
	it('centers edge states without snapping to the map edge', () => {
		const camera = new MapCamera(2048, 1024);
		camera.setViewport(1000, 600);
		camera.focusOn(32, 24, 3);
		expect(camera.centerX).toBe(32);
		expect(camera.centerY).toBe(24);
	});

	it('allows panning beyond the map so occluded edge states can be centered', () => {
		const camera = new MapCamera(2048, 1024);
		camera.setViewport(1000, 600);
		camera.focusOn(0, 0, 2);
		camera.panBy(4000, 3000);
		expect(camera.centerX).toBeLessThan(0);
		expect(camera.centerY).toBeLessThan(0);
	});
});
