import type { StartPoint } from '../map';
import type { GameSnapshot } from '../simulation';

/** Initial match payload posted by any worker-owned simulation. */
export interface WorkerMatchInit {
	width: number;
	height: number;
	starts: StartPoint[];
	terrain: Uint8Array;
	terrainShade: Uint8Array;
	terrainElevation: Uint8Array;
	owners: Uint16Array;
	districtColorCodes: Uint8Array;
	snapshot: GameSnapshot;
}

/** Render delta posted by any worker-owned simulation. */
export interface WorkerVisual {
	matchId: number;
	tick: number;
	snapshot: GameSnapshot;
	/** Packed `(owner << CHANGE_INDEX_BITS) | pixelIndex` changes since the previous visual. */
	changes: Uint32Array;
	changeCount: number;
	/** District palette codes parallel to `changes`, when supplied. */
	changeDistrictColors?: Uint8Array | null;
	/** Full owners/district arrays replace the change stream. */
	overflow: boolean;
	owners: Uint16Array | null;
	districtColorCodes: Uint8Array | null;
	districtTiles: number[];
	/** Packed 32×32 district palette tiles, one 1024-byte block per tile. */
	districtTileColors: Uint8Array | null;
	markovStates: (number | null)[];
}
