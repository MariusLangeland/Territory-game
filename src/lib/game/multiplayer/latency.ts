export const LATENCY_OPTIONS = [0, 60, 120, 220] as const;

export type SimulatedLatency = (typeof LATENCY_OPTIONS)[number];

export const DEFAULT_SIMULATED_LATENCY: SimulatedLatency = 120;

export function normalizeSimulatedLatency(value: number): SimulatedLatency {
	return LATENCY_OPTIONS.includes(value as SimulatedLatency)
		? (value as SimulatedLatency)
		: DEFAULT_SIMULATED_LATENCY;
}

export function nextSimulatedLatency(value: number): SimulatedLatency {
	const current = normalizeSimulatedLatency(value);
	const index = LATENCY_OPTIONS.indexOf(current);
	return LATENCY_OPTIONS[(index + 1) % LATENCY_OPTIONS.length];
}

export function latencyLabel(value: number): string {
	const latency = normalizeSimulatedLatency(value);
	return latency === 0 ? 'OFF' : `${latency} MS`;
}
