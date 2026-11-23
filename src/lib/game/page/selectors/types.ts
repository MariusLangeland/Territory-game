import type { GameSnapshot } from '#lib/game/simulation';

export interface HoverState {
	x: number;
	y: number;
	owner: number;
	land: boolean;
	elevation: number;
	baseDefense: number;
	auraDefense: number;
	defense: number;
}

export interface WorkerVisualEntry {
	revision: number;
	tick: number;
	snapshot: GameSnapshot;
	changes: Uint32Array;
	changeCount: number;
	overflow: boolean;
	districtTiles: number[];
}

export type OnboardingStep = 1 | 2 | 3;
