import { DeterministicRng } from '../rng';
import type { GrowthContext, GrowthLayer, GrowthLayerState, GrowthMode, MixFn } from './types';

/**
 * Organic growth: pick a uniformly random frontier candidate each capture.
 *
 * The per-attack PRNG is seeded from the attack id and world seed, so the shape
 * is irregular but fully reproducible. Connectivity and ownership are still
 * enforced by the simulation.
 */
export class OrganicGrowthLayer implements GrowthLayer {
	readonly mode: GrowthMode = 'organic';

	private readonly rng: DeterministicRng;
	private readonly entries: number[] = [];

	constructor(context: GrowthContext) {
		this.rng = new DeterministicRng(context.rngSeed);
	}

	get size(): number {
		return this.entries.length;
	}

	push(index: number): void {
		this.entries.push(index);
	}

	pop(): number | undefined {
		if (this.entries.length === 0) return undefined;
		const position = this.rng.nextInt(this.entries.length);
		const chosen = this.entries[position];
		const last = this.entries.pop();
		if (last !== undefined && position < this.entries.length) {
			this.entries[position] = last;
		}
		return chosen;
	}

	mixState(mix: MixFn): void {
		mix(this.rng.getState());
		mix(this.entries.length);
		for (const index of this.entries) mix(index);
	}

	snapshot(): GrowthLayerState {
		return { mode: 'organic', entries: [...this.entries], rngState: this.rng.getState() };
	}

	restore(state: GrowthLayerState): void {
		if (state.mode !== 'organic') return;
		this.entries.length = 0;
		this.entries.push(...state.entries);
		this.rng.setState(state.rngState);
	}
}
