/**
 * Attack-frontier selection. Player matches use locked organic growth.
 *
 * A growth layer only chooses which candidate pixel to process next. The
 * simulation remains responsible for ownership, border connectivity, capture
 * budget, attack lifetime, and all visible outcomes.
 */

export const GROWTH_MODES = ['organic'] as const;

export type GrowthMode = (typeof GROWTH_MODES)[number];

export const DEFAULT_GROWTH_MODE: GrowthMode = 'organic';

export const GROWTH_LABELS: Record<GrowthMode, string> = {
	organic: 'ORGANIC'
};

export const GROWTH_DESCRIPTIONS: Record<GrowthMode, string> = {
	organic: 'Deterministic random frontier selection; irregular, organic lobes.'
};

export function isGrowthMode(value: unknown): value is GrowthMode {
	return value === 'organic';
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

export type GrowthLayerState = { mode: 'organic'; entries: number[]; rngState: number };

export interface GrowthLayer {
	readonly mode: GrowthMode;
	readonly size: number;
	push(index: number): void;
	pop(): number | undefined;
	/** Mix pending frontier state into an on-demand checksum. */
	mixState(mix: MixFn): void;
	/** Serializable pending frontier state. */
	snapshot(): GrowthLayerState;
	restore(state: GrowthLayerState): void;
}
