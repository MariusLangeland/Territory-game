import { CHANGE_INDEX_BITS, CHANGE_INDEX_MASK } from '../constants';
import type { PublicStructure, StructureType } from '../Structures';
import type { GameSnapshot, MergedDistrictGroup } from '../simulation';
import type { StartPoint } from '../map';
import type { WorkerMatchInit, WorkerVisual } from './evolution-worker-protocol';

const DISTRICT_TILE_SIZE = 32;

interface ViewStructures {
	all: PublicStructure[];
	forOwner(ownerId: number): PublicStructure[];
	forOwnerType(ownerId: number, type: StructureType): PublicStructure | undefined;
	at(x: number, y: number): PublicStructure | undefined;
}

/**
 * Read-only main-thread mirror of the worker's current match. The worker owns
 * the real TerritorySimulation; this object only carries the data the WebGPU
 * renderer, camera, hover readout and selection overlay need.
 */
export class RemoteEvolutionSimulation {
	readonly width: number;
	readonly height: number;
	readonly map: { starts: StartPoint[] };
	readonly terrain: Uint8Array;
	readonly terrainShade: Uint8Array;
	readonly terrainElevation: Uint8Array;
	owners: Uint16Array;
	districtColorCodes: Uint8Array;
	readonly structures: ViewStructures;
	tick = 0;
	ended = false;
	snapshot: GameSnapshot;

	constructor(init: WorkerMatchInit) {
		this.width = init.width;
		this.height = init.height;
		this.map = { starts: init.starts };
		this.terrain = init.terrain;
		this.terrainShade = init.terrainShade;
		this.terrainElevation = init.terrainElevation;
		this.owners = init.owners;
		this.districtColorCodes = init.districtColorCodes;
		this.snapshot = init.snapshot;
		this.tick = init.snapshot.tick;
		this.ended = init.snapshot.ended;
		this.structures = this.buildStructures();
	}

	get activeShells() {
		return this.snapshot.shells;
	}

	get activeNavalLandings() {
		return this.snapshot.navalLandings;
	}

	getSnapshot(): GameSnapshot {
		return this.snapshot;
	}

	getMergedDistricts(): readonly MergedDistrictGroup[] {
		// District seam merging is a live-game cosmetic; the worker mirror keeps
		// the raw per-structure districts to avoid serializing merged groups.
		return [];
	}

	getOwner(x: number, y: number): number {
		if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
		return this.owners[y * this.width + x] ?? 0;
	}

	isLand(x: number, y: number): boolean {
		if (x < 0 || y < 0 || x >= this.width || y >= this.height) return false;
		return (this.terrain[y * this.width + x] ?? 0) !== 0;
	}

	getElevation(x: number, y: number): number {
		if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
		return this.terrainElevation[y * this.width + x] ?? 0;
	}

	getBaseDefense(x: number, y: number): number {
		return this.isLand(x, y) ? 1 + this.getElevation(x, y) : 0;
	}

	getAuraDefense(_x?: number, _y?: number): number {
		return 0;
	}

	getDefense(x: number, y: number): number {
		return this.getBaseDefense(x, y);
	}

	applyVisual(visual: WorkerVisual): void {
		this.tick = visual.tick;
		this.ended = visual.snapshot.ended;
		this.snapshot = visual.snapshot;
		this.structures.all = visual.snapshot.structures;
		if (visual.overflow) {
			if (visual.owners) this.owners = visual.owners;
			if (visual.districtColorCodes) this.districtColorCodes = visual.districtColorCodes;
		} else {
			for (let index = 0; index < visual.changeCount; index++) {
				const packed = visual.changes[index] ?? 0;
				const cell = packed & CHANGE_INDEX_MASK;
				const owner = packed >>> CHANGE_INDEX_BITS;
				if (cell < this.owners.length) this.owners[cell] = owner;
			}
			if (visual.changeDistrictColors) {
				for (let index = 0; index < visual.changeCount; index++) {
					const cell = (visual.changes[index] ?? 0) & CHANGE_INDEX_MASK;
					if (cell < this.districtColorCodes.length) {
						this.districtColorCodes[cell] = visual.changeDistrictColors[index] ?? 0;
					}
				}
			}
			if (visual.districtTileColors && visual.districtTiles.length > 0) {
				this.applyDistrictTiles(visual.districtTiles, visual.districtTileColors);
			}
		}
	}

	private applyDistrictTiles(tiles: readonly number[], colors: Uint8Array): void {
		const tilesX = Math.ceil(this.width / DISTRICT_TILE_SIZE);
		for (let block = 0; block < tiles.length; block++) {
			const tile = tiles[block] ?? 0;
			const x0 = (tile % tilesX) * DISTRICT_TILE_SIZE;
			const y0 = Math.floor(tile / tilesX) * DISTRICT_TILE_SIZE;
			const offset = block * DISTRICT_TILE_SIZE * DISTRICT_TILE_SIZE;
			for (let y = 0; y < DISTRICT_TILE_SIZE; y++) {
				const worldY = y0 + y;
				if (worldY >= this.height) break;
				for (let x = 0; x < DISTRICT_TILE_SIZE; x++) {
					const worldX = x0 + x;
					if (worldX >= this.width) break;
					this.districtColorCodes[worldY * this.width + worldX] =
						colors[offset + y * DISTRICT_TILE_SIZE + x] ?? 0;
				}
			}
		}
	}

	private buildStructures(): ViewStructures {
		return {
			all: this.snapshot.structures,
			forOwner: (ownerId) =>
				this.snapshot.structures.filter((structure) => structure.ownerId === ownerId),
			forOwnerType: (ownerId, type) =>
				this.snapshot.structures.find(
					(structure) => structure.ownerId === ownerId && structure.type === type
				),
			at: (x, y) =>
				this.snapshot.structures.find((structure) => structure.x === x && structure.y === y)
		};
	}
}
