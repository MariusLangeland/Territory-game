import type { GrowthContext, GrowthLayer, GrowthMode, MixFn } from './types';

const DIRECTION_BUCKETS = 8;
const SMOOTH_SCAN_LIMIT = 12;

/**
 * Direction-fair growth with concavity filling.
 *
 * Candidates are bucketed into eight angular sectors around the attack anchor.
 * Sectors are visited round-robin. Within a sector, the layer prefers frontier
 * cells with more attacker-owned neighbours, which suppresses one-pixel spikes
 * and fills shallow pockets.
 */
export class SmoothGrowthLayer implements GrowthLayer {
	readonly mode: GrowthMode = 'smooth';

	private readonly buckets: number[][] = Array.from({ length: DIRECTION_BUCKETS }, () => []);
	private cursor = 0;
	private count = 0;
	private readonly width: number;
	private readonly height: number;
	private readonly owners: Uint16Array;
	private readonly attackerId: number;
	private readonly anchorX: number;
	private readonly anchorY: number;

	constructor(context: GrowthContext) {
		this.width = context.width;
		this.height = context.height;
		this.owners = context.owners;
		this.attackerId = context.attackerId;
		this.anchorX = context.anchorX;
		this.anchorY = context.anchorY;
	}

	get size(): number {
		return this.count;
	}

	push(index: number): void {
		const x = index % this.width;
		const y = (index - x) / this.width;
		const direction = this.sectorOf(x - this.anchorX, y - this.anchorY);
		this.buckets[direction].push(index);
		this.count++;
	}

	pop(): number | undefined {
		for (let attempt = 0; attempt < DIRECTION_BUCKETS; attempt++) {
			const bucket = this.buckets[this.cursor];
			this.cursor = (this.cursor + 1) % DIRECTION_BUCKETS;
			if (bucket.length === 0) continue;

			const scan = Math.min(bucket.length, SMOOTH_SCAN_LIMIT);
			let bestPosition = 0;
			let bestNeighbours = -1;
			let bestDistance = Number.POSITIVE_INFINITY;
			let bestIndex = Number.POSITIVE_INFINITY;

			for (let i = 0; i < scan; i++) {
				const index = bucket[i];
				const neighbours = this.attackerNeighbourCount(index);
				const x = index % this.width;
				const y = (index - x) / this.width;
				const dx = x - this.anchorX;
				const dy = y - this.anchorY;
				const distance = dx * dx + dy * dy;

				if (
					neighbours > bestNeighbours ||
					(neighbours === bestNeighbours &&
						(distance < bestDistance || (distance === bestDistance && index < bestIndex)))
				) {
					bestPosition = i;
					bestNeighbours = neighbours;
					bestDistance = distance;
					bestIndex = index;
				}
			}

			const chosen = bucket[bestPosition];
			const last = bucket.pop();
			if (last !== undefined && bestPosition < bucket.length) {
				bucket[bestPosition] = last;
			}
			this.count--;
			return chosen;
		}
		return undefined;
	}

	mixState(mix: MixFn): void {
		mix(this.count);
		mix(this.cursor);
		for (const bucket of this.buckets) {
			mix(bucket.length);
			for (const index of bucket) mix(index);
		}
	}

	private attackerNeighbourCount(index: number): number {
		const width = this.width;
		const height = this.height;
		const x = index % width;
		const y = (index - x) / width;
		let count = 0;

		if (x > 0 && this.owners[index - 1] === this.attackerId) count++;
		if (x + 1 < width && this.owners[index + 1] === this.attackerId) count++;
		if (y > 0 && this.owners[index - width] === this.attackerId) count++;
		if (y + 1 < height && this.owners[index + width] === this.attackerId) count++;
		return count;
	}

	/**
	 * Eight deterministic sectors using integer thresholds for the 22.5° and
	 * 67.5° boundaries. Screen coordinates are used; the names of the sectors do
	 * not matter, only their even distribution.
	 */
	private sectorOf(dx: number, dy: number): number {
		const ax = Math.abs(dx);
		const ay = Math.abs(dy);
		if (ax === 0 && ay === 0) return 0;

		if (ay * 1000 < ax * 414) return dx >= 0 ? 0 : 4;
		if (ax * 1000 < ay * 414) return dy >= 0 ? 2 : 6;
		if (dx >= 0) return dy >= 0 ? 1 : 7;
		return dy >= 0 ? 3 : 5;
	}
}
