import type { GrowthContext, GrowthLayer, GrowthMode, MixFn } from './types';

/** Squared-distance resolution: 16 px² is about 4 px of radius at r = 20. */
const BAND_SHIFT = 4;
const SMOOTH_SCAN_LIMIT = 16;

/**
 * Radial smoothing.
 *
 * Candidates are grouped into thin squared-distance bands around the attack
 * anchor. The nearest non-empty band is always served first, so a horizontal
 * frontier cannot send a wing far along the tangent while the main radial front
 * is closer. Within a band, the layer prefers cells with more attacker-owned
 * neighbours, which fills concavities and suppresses one-pixel spikes.
 *
 * The previous implementation rotated through eight angular sectors. On a long
 * straight border all initial seeds fell into two opposite sectors, and the
 * round-robin could grow those tangent sectors far ahead of the radial front,
 * producing long axis-aligned bars/wings. Bands bound that drift by radius.
 */
export class SmoothGrowthLayer implements GrowthLayer {
	readonly mode: GrowthMode = 'smooth';

	private readonly bands = new Map<number, number[]>();
	private minBand = Number.POSITIVE_INFINITY;
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
		const band = this.bandOf(index);
		let bucket = this.bands.get(band);
		if (!bucket) {
			bucket = [];
			this.bands.set(band, bucket);
		}
		bucket.push(index);
		if (band < this.minBand) this.minBand = band;
		this.count++;
	}

	pop(): number | undefined {
		while (this.count > 0) {
			while (!this.bands.has(this.minBand)) {
				if (this.bands.size === 0) return undefined;
				this.minBand++;
			}

			const bucket = this.bands.get(this.minBand);
			if (!bucket) return undefined;

			const scan = Math.min(bucket.length, SMOOTH_SCAN_LIMIT);
			let bestPosition = 0;
			let bestNeighbours = -1;
			let bestDistance = Number.POSITIVE_INFINITY;
			let bestIndex = Number.POSITIVE_INFINITY;

			for (let i = 0; i < scan; i++) {
				const index = bucket[i];
				const neighbours = this.attackerNeighbourCount(index);
				const distance = this.distanceSq(index);

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
			if (bucket.length === 0) this.bands.delete(this.minBand);
			return chosen;
		}
		return undefined;
	}

	mixState(mix: MixFn): void {
		mix(this.count);
		mix(this.minBand === Number.POSITIVE_INFINITY ? -1 : this.minBand);
		const bands = Array.from(this.bands.keys()).sort((a, b) => a - b);
		for (const band of bands) {
			mix(band);
			const bucket = this.bands.get(band) ?? [];
			mix(bucket.length);
			for (const index of bucket) mix(index);
		}
	}

	private distanceSq(index: number): number {
		const x = index % this.width;
		const y = (index - x) / this.width;
		const dx = x - this.anchorX;
		const dy = y - this.anchorY;
		return dx * dx + dy * dy;
	}

	private bandOf(index: number): number {
		return this.distanceSq(index) >> BAND_SHIFT;
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
}
