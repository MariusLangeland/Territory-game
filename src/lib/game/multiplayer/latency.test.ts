import { describe, expect, it } from 'vitest';
import {
	DEFAULT_SIMULATED_LATENCY,
	latencyLabel,
	LATENCY_OPTIONS,
	nextSimulatedLatency,
	normalizeSimulatedLatency
} from './latency';

describe('simulated network latency', () => {
	it('normalizes unsupported values to the default', () => {
		expect(normalizeSimulatedLatency(10)).toBe(DEFAULT_SIMULATED_LATENCY);
		expect(normalizeSimulatedLatency(120)).toBe(120);
	});

	it('cycles through the preset round trips', () => {
		const seen = new Set<number>();
		let current: number = LATENCY_OPTIONS[0];
		for (let index = 0; index < LATENCY_OPTIONS.length; index++) {
			seen.add(current);
			current = nextSimulatedLatency(current);
		}
		expect(seen.size).toBe(LATENCY_OPTIONS.length);
		expect(current).toBe(LATENCY_OPTIONS[0]);
	});

	it('labels off and millisecond values', () => {
		expect(latencyLabel(0)).toBe('OFF');
		expect(latencyLabel(120)).toBe('120 MS');
	});
});
