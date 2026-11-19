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
	it('visits all eight direction buckets before repeating one', () => {
		const context = makeContext({ width: 32, height: 32, anchorX: 16, anchorY: 16 });
		const layer = new SmoothGrowthLayer(context);
		const directions = [
			[28, 16],
			[26, 24],
			[16, 28],
			[6, 24],
			[4, 16],
			[6, 8],
			[16, 4],
			[26, 8]
		] as const;

		for (const [x, y] of directions) layer.push(y * context.width + x);
		const popped: number[] = [];
		for (let i = 0; i < directions.length; i++) {
			const index = layer.pop();
			expect(index).toBeDefined();
			if (index !== undefined) popped.push(index);
		}

		expect(new Set(popped).size).toBe(8);
		expect(layer.size).toBe(0);
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
