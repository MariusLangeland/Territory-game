/**
 * Types shared by the canvas scene helpers and by GameCanvas's public props.
 *
 * These are part of the component contract: routes pass `remoteVisuals` entries
 * and receive `onHover` payloads with exactly these shapes.
 */

import type { GameSnapshot } from '#lib/game/simulation';

/** Pointer hover payload consumed by the HUD defense/territory readout. */
export interface HoverInfo {
	x: number;
	y: number;
	owner: number;
	land: boolean;
	elevation: number;
	baseDefense: number;
	auraDefense: number;
	defense: number;
}

/** One worker-produced visual delta waiting to be applied to the renderer. */
export interface RemoteVisual {
	revision: number;
	tick: number;
	snapshot: GameSnapshot;
	changes: Uint32Array;
	changeCount: number;
	overflow: boolean;
	districtTiles: number[];
}
