/**
 * Pluggable attack-frontier selection.
 *
 * A growth layer only chooses which candidate pixel to process next. The
 * simulation remains responsible for ownership, border-connectivity, capture
 * budget, attack lifetime, and all visible outcomes.
 */

export const GROWTH_MODES = ['circular', 'smooth', 'organic'] as const;

export type GrowthMode = (typeof GROWTH_MODES)[number];

export const DEFAULT_GROWTH_MODE: GrowthMode = 'circular';

export const GROWTH_LABELS: Record<GrowthMode, string> = {
	circular: 'CIRCULAR',
	smooth: 'SMOOTH',
	organic: 'ORGANIC'
};

export const GROWTH_DESCRIPTIONS: Record<GrowthMode, string> = {
	circular: 'Euclidean-priority frontier; grows as a digital disc.',
	smooth: 'Radial-band frontier that fills concavities and suppresses spikes.',
	organic: 'Deterministic random frontier selection; irregular, organic lobes.'
};

export function isGrowthMode(value: unknown): value is GrowthMode {
	return typeof value === 'string' && (GROWTH_MODES as readonly string[]).includes(value);
}

export interface GrowthContext {
	width: number;
	height: number;
	owners: Uint16Array;
	attackerId: number;
	/** The click / target cell that gives the front its geometry. */
	anchorX: number;
	anchorY: number;
	/** Deterministic per-attack seed for layers that need randomness. */
	rngSeed: number;
}

export type MixFn = (value: number) => void;

export interface GrowthLayer {
	readonly mode: GrowthMode;
	readonly size: number;
	push(index: number): void;
	pop(): number | undefined;
	/** Mix pending frontier state into an on-demand checksum. */
	mixState(mix: MixFn): void;
}
