/**
 * Deterministic, serialisable PRNG.
 *
 * This is mulberry32: integer-only state updates, no Math.random, no time
 * dependency, and identical output in every conforming ECMAScript runtime.
 * A simulation owns exactly one instance; draw order is part of the protocol.
 */
export class DeterministicRng {
	private state: number;

	constructor(seed: number) {
		// Zero is a legal seed for mulberry32, but avoid it here so a debugger
		// can tell "unseeded" from "seeded with zero".
		this.state = seed >>> 0 || 0x9e3779b9;
	}

	/** Raw 32-bit output. */
	nextUint32(): number {
		this.state = (this.state + 0x6d2b79f5) | 0;
		let t = this.state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return (t ^ (t >>> 14)) >>> 0;
	}

	/** Uniform integer in [0, maxExclusive), using rejection to avoid modulo bias. */
	nextInt(maxExclusive: number): number {
		if (maxExclusive <= 0) return 0;
		if (maxExclusive === 1) return 0;

		const limit = 0x1_0000_0000 - (0x1_0000_0000 % maxExclusive);
		let value = this.nextUint32();
		while (value >= limit) value = this.nextUint32();
		return value % maxExclusive;
	}

	/** Returns true with `percent` probability, in integer percent. */
	chance(percent: number): boolean {
		return this.nextInt(100) < percent;
	}

	pick<T>(items: readonly T[]): T {
		return items[this.nextInt(items.length)];
	}

	getState(): number {
		return this.state >>> 0;
	}

	setState(state: number): void {
		this.state = state | 0;
	}
}
