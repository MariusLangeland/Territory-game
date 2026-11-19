import type { GrowthContext, GrowthLayer, GrowthMode, MixFn } from './types';

/**
 * Euclidean-priority frontier.
 *
 * Candidates are stored in a binary min-heap keyed by
 * `distanceSq * pixelCount + index`. Processing the closest available frontier
 * cell first makes the captured set approximate a digital disc rather than a
 * Manhattan-distance diamond.
 */
export class CircularGrowthLayer implements GrowthLayer {
	readonly mode: GrowthMode = 'circular';

	private readonly heap: number[] = [];
	private readonly width: number;
	private readonly anchorX: number;
	private readonly anchorY: number;
	private readonly keyBase: number;

	constructor(context: GrowthContext) {
		this.width = context.width;
		this.anchorX = context.anchorX;
		this.anchorY = context.anchorY;
		this.keyBase = context.width * context.height;
	}

	get size(): number {
		return this.heap.length;
	}

	push(index: number): void {
		const x = index % this.width;
		const y = (index - x) / this.width;
		const dx = x - this.anchorX;
		const dy = y - this.anchorY;
		const packed = (dx * dx + dy * dy) * this.keyBase + index;

		this.heap.push(packed);
		let child = this.heap.length - 1;
		while (child > 0) {
			const parent = (child - 1) >> 1;
			if (this.heap[parent] <= packed) break;
			this.heap[child] = this.heap[parent];
			child = parent;
		}
		this.heap[child] = packed;
	}

	pop(): number | undefined {
		if (this.heap.length === 0) return undefined;
		const root = this.heap[0];
		const last = this.heap.pop();
		if (last === undefined || this.heap.length === 0) return root % this.keyBase;

		let parent = 0;
		const length = this.heap.length;
		while (true) {
			const left = parent * 2 + 1;
			if (left >= length) break;
			const right = left + 1;
			const child = right < length && this.heap[right] < this.heap[left] ? right : left;
			if (this.heap[child] >= last) break;
			this.heap[parent] = this.heap[child];
			parent = child;
		}
		this.heap[parent] = last;
		return root % this.keyBase;
	}

	mixState(mix: MixFn): void {
		mix(this.heap.length);
		for (const packed of this.heap) {
			mix(packed % 0x1_0000_0000);
			mix(Math.floor(packed / 0x1_0000_0000));
		}
	}
}
