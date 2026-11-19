import { describe, expect, it } from 'vitest';
import { CircularGrowthLayer, OrganicGrowthLayer, SmoothGrowthLayer } from './index';
import type { GrowthContext } from './types';

function makeContext(overrides: Partial<GrowthContext> = {}): GrowthContext {
	const width = overrides.width ?? 64;
	const height = overrides.height ?? 64;
	return {
		width,
		height,
		owners: new Uint16Array(width * height),
		attackerId: 1,
		anchorX: Math.floor(width / 2),
		anchorY: Math.floor(height / 2),
		rngSeed: 123456,
		...overrides
	};
}

describe('circular growth layer', () => {
	it('pops frontier cells in nondecreasing Euclidean distance from the anchor', () => {
		const context = makeContext();
		const layer = new CircularGrowthLayer(context);
		for (let index = 0; index < context.width * context.height; index++) layer.push(index);

		let lastDistance = -1;
		let popped = 0;
		for (;;) {
			const index = layer.pop();
			if (index === undefined) break;
			const x = index % context.width;
			const y = (index - x) / context.width;
			const dx = x - context.anchorX;
			const dy = y - context.anchorY;
			const distance = dx * dx + dy * dy;
			expect(distance).toBeGreaterThanOrEqual(lastDistance);
			lastDistance = distance;
			popped++;
		}

		expect(popped).toBe(context.width * context.height);
		expect(layer.size).toBe(0);
	});
});

describe('smooth growth layer', () => {
	it('prefers the nearest radial band over a far tangent candidate', () => {
		const context = makeContext({ width: 32, height: 32, anchorX: 16, anchorY: 16 });
		const layer = new SmoothGrowthLayer(context);
		const nearNorth = 10 * context.width + 16;
		const farEast = 16 * context.width + 30;

		// This is the shape that produced axis-aligned wings: a horizontal
		// frontier with a far tangent candidate. It must not outrun the nearer
		// radial candidate.
		layer.push(farEast);
		layer.push(nearNorth);

		expect(layer.pop()).toBe(nearNorth);
		expect(layer.pop()).toBe(farEast);
		expect(layer.size).toBe(0);
	});

	it('does not let a vertical tangent outrun the radial front', () => {
		const context = makeContext({ width: 32, height: 32, anchorX: 16, anchorY: 16 });
		const layer = new SmoothGrowthLayer(context);
		const nearEast = 16 * context.width + 22;
		const farSouth = 30 * context.width + 16;

		layer.push(farSouth);
		layer.push(nearEast);

		expect(layer.pop()).toBe(nearEast);
		expect(layer.pop()).toBe(farSouth);
	});

	it('fills a concavity within the nearest band', () => {
		const width = 32;
		const height = 32;
		const owners = new Uint16Array(width * height);
		const connected = 16 * width + 20;
		const bare = 20 * width + 16;
		owners[connected - 1] = 1;
		owners[connected + 1] = 1;
		const context = makeContext({
			width,
			height,
			owners,
			anchorX: 16,
			anchorY: 16
		});
		const layer = new SmoothGrowthLayer(context);
		layer.push(bare);
		layer.push(connected);

		expect(layer.pop()).toBe(connected);
		expect(layer.pop()).toBe(bare);
	});
});

describe('organic growth layer', () => {
	it('is reproducible from the attack seed', () => {
		const context = makeContext();
		const left = new OrganicGrowthLayer(context);
		const right = new OrganicGrowthLayer(context);
		for (let index = 0; index < 100; index++) {
			left.push(index * 7);
			right.push(index * 7);
		}

		const leftOrder: number[] = [];
		const rightOrder: number[] = [];
		for (let i = 0; i < 100; i++) {
			const a = left.pop();
			const b = right.pop();
			expect(a).toBeDefined();
			expect(b).toBeDefined();
			if (a !== undefined) leftOrder.push(a);
			if (b !== undefined) rightOrder.push(b);
		}
		expect(leftOrder).toEqual(rightOrder);
	});
});
