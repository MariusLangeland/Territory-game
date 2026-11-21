/**
 * Static sea connectivity and deterministic A* routing for naval landings.
 *
 * The map's land mask never changes, so sea components are labelled once at
 * world creation. Route searches are only run when a landing is requested.
 */

export interface SeaGraph {
	readonly width: number;
	readonly height: number;
	readonly land: Uint8Array;
	/** 0 for land, otherwise a 1-based sea component id. */
	readonly components: Uint32Array;
}

export function isShoreIndex(
	land: Uint8Array,
	width: number,
	height: number,
	index: number
): boolean {
	if (!land[index]) return false;
	const x = index % width;
	const y = (index - x) / width;
	if (x > 0 && !land[index - 1]) return true;
	if (x + 1 < width && !land[index + 1]) return true;
	if (y > 0 && !land[index - width]) return true;
	if (y + 1 < height && !land[index + width]) return true;
	return false;
}

export function adjacentWater(
	land: Uint8Array,
	width: number,
	height: number,
	index: number,
	out: number[] = []
): number[] {
	out.length = 0;
	const x = index % width;
	const y = (index - x) / width;
	if (x > 0 && !land[index - 1]) out.push(index - 1);
	if (x + 1 < width && !land[index + 1]) out.push(index + 1);
	if (y > 0 && !land[index - width]) out.push(index - width);
	if (y + 1 < height && !land[index + width]) out.push(index + width);
	return out;
}

/** Label 4-connected ocean components. */
export function computeSeaComponents(land: Uint8Array, width: number, height: number): Uint32Array {
	const components = new Uint32Array(land.length);
	const queue = new Uint32Array(land.length);
	let nextComponent = 1;

	for (let seed = 0; seed < land.length; seed++) {
		if (land[seed] || components[seed] !== 0) continue;
		const component = nextComponent++;
		let head = 0;
		let tail = 0;
		components[seed] = component;
		queue[tail++] = seed;

		while (head < tail) {
			const index = queue[head++];
			const x = index % width;
			const y = (index - x) / width;
			if (x > 0 && !land[index - 1] && components[index - 1] === 0) {
				components[index - 1] = component;
				queue[tail++] = index - 1;
			}
			if (x + 1 < width && !land[index + 1] && components[index + 1] === 0) {
				components[index + 1] = component;
				queue[tail++] = index + 1;
			}
			if (y > 0 && !land[index - width] && components[index - width] === 0) {
				components[index - width] = component;
				queue[tail++] = index - width;
			}
			if (y + 1 < height && !land[index + width] && components[index + width] === 0) {
				components[index + width] = component;
				queue[tail++] = index + width;
			}
		}
	}

	return components;
}

/**
 * Deterministic 4-neighbour A*. Ties break by map index so the same request
 * always produces the same boat route.
 */
export class SeaRouter {
	private readonly gScore: Int32Array;
	private readonly parent: Int32Array;
	private readonly closed: Uint8Array;
	private readonly heapIndex: number[] = [];
	private readonly heapPriority: number[] = [];
	private readonly touched: number[] = [];

	constructor(
		private readonly land: Uint8Array,
		private readonly width: number,
		private readonly height: number
	) {
		this.gScore = new Int32Array(land.length).fill(-1);
		this.parent = new Int32Array(land.length).fill(-1);
		this.closed = new Uint8Array(land.length);
	}

	findPath(start: number, target: number): Uint32Array | null {
		if (start === target) return new Uint32Array([start]);
		if (this.land[start] || this.land[target]) return null;
		this.resetTouched();
		const touched = this.touched;
		this.gScore[start] = 0;
		touched.push(start);
		this.heapPush(start, this.heuristic(start, target));

		while (this.heapIndex.length > 0) {
			const current = this.heapPop();
			if (current < 0 || this.closed[current]) continue;
			if (current === target) return this.reconstruct(current);
			this.closed[current] = 1;
			const currentG = this.gScore[current] ?? 0;

			const x = current % this.width;
			const y = (current - x) / this.width;
			const neighbours = [
				x > 0 ? current - 1 : -1,
				x + 1 < this.width ? current + 1 : -1,
				y > 0 ? current - this.width : -1,
				y + 1 < this.height ? current + this.width : -1
			];
			for (const next of neighbours) {
				if (next < 0 || this.land[next] || this.closed[next]) continue;
				const tentative = currentG + 1;
				let known = this.gScore[next] ?? -1;
				if (known === -1) {
					known = Number.POSITIVE_INFINITY;
					touched.push(next);
				}
				if (tentative >= known) continue;
				this.gScore[next] = tentative;
				this.parent[next] = current;
				this.heapPush(next, tentative + this.heuristic(next, target));
			}
		}

		this.resetTouched();
		return null;
	}

	private heuristic(index: number, target: number): number {
		const x = index % this.width;
		const y = (index - x) / this.width;
		const tx = target % this.width;
		const ty = (target - tx) / this.width;
		return Math.abs(x - tx) + Math.abs(y - ty);
	}

	private reconstruct(target: number): Uint32Array {
		const path: number[] = [];
		let current = target;
		while (current !== -1) {
			path.push(current);
			current = this.parent[current] ?? -1;
		}
		path.reverse();
		return Uint32Array.from(path);
	}

	private resetTouched(): void {
		for (const index of this.touched) {
			this.gScore[index] = -1;
			this.parent[index] = -1;
			this.closed[index] = 0;
		}
		this.touched.length = 0;
		this.heapIndex.length = 0;
		this.heapPriority.length = 0;
	}

	private heapPush(index: number, priority: number): void {
		this.heapIndex.push(index);
		this.heapPriority.push(priority);
		let child = this.heapIndex.length - 1;
		while (child > 0) {
			const parent = (child - 1) >> 1;
			if ((this.heapPriority[parent] ?? 0) <= priority) break;
			this.heapIndex[child] = this.heapIndex[parent] ?? 0;
			this.heapPriority[child] = this.heapPriority[parent] ?? 0;
			child = parent;
		}
		this.heapIndex[child] = index;
		this.heapPriority[child] = priority;
	}

	private heapPop(): number {
		const first = this.heapIndex[0] ?? -1;
		const lastIndex = this.heapIndex.pop();
		const lastPriority = this.heapPriority.pop();
		if (lastIndex === undefined || lastPriority === undefined) return first;
		if (this.heapIndex.length === 0) return first;
		let parent = 0;
		while (true) {
			const left = parent * 2 + 1;
			if (left >= this.heapIndex.length) break;
			const right = left + 1;
			const child =
				right < this.heapIndex.length &&
				(this.heapPriority[right] ?? 0) < (this.heapPriority[left] ?? 0)
					? right
					: left;
			if ((this.heapPriority[child] ?? 0) >= lastPriority) break;
			this.heapIndex[parent] = this.heapIndex[child] ?? 0;
			this.heapPriority[parent] = this.heapPriority[child] ?? 0;
			parent = child;
		}
		this.heapIndex[parent] = lastIndex;
		this.heapPriority[parent] = lastPriority;
		return first;
	}
}
