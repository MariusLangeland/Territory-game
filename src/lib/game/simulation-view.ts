import type { StartPoint } from './map';
import type { TerritoryRenderSource } from './render/territory-renderer';
import type { GameSnapshot, MergedDistrictGroup, StepResult } from './simulation';
import type { StructureType } from './structures';

/** Structure fields used by the 2D overlay. */
export interface SimulationStructure {
	id: number;
	type: StructureType;
	ownerId: number;
	x: number;
	y: number;
	stacks: number;
}

/** The shell fields the 2D overlay draws. */
export interface ShellView {
	ownerId: number;
	fromX: number;
	fromY: number;
	targetX: number;
	targetY: number;
	launchedAtTick: number;
	arriveAtTick: number;
}

/** The naval-landing fields the 2D overlay draws. */
export interface NavalLandingView {
	ownerId: number;
	path: readonly number[];
	progress: number;
}

export interface SimulationStructuresView {
	all: readonly SimulationStructure[];
	forOwner(ownerId: number): readonly SimulationStructure[];
}

/**
 * Read-only contract shared by the authoritative local simulation and the
 * worker-owned mirror. Rendering, camera, hover, minimap, and overlays depend on
 * this interface, never on worker-specific classes.
 */
export interface SimulationView extends TerritoryRenderSource {
	map: { starts: StartPoint[] };
	tick: number;
	ended: boolean;
	structures: SimulationStructuresView;
	activeShells: readonly ShellView[];
	activeNavalLandings: readonly NavalLandingView[];

	getSnapshot(): GameSnapshot;
	getOwner(x: number, y: number): number;
	isLand(x: number, y: number): boolean;
	getElevation(x: number, y: number): number;
	getBaseDefense(x: number, y: number): number;
	getAuraDefense(x?: number, y?: number): number;
	getDefense(x: number, y: number): number;
	getMergedDistricts(): readonly MergedDistrictGroup[];

	/** Only present on the authoritative, main-thread simulation. */
	step?(): StepResult;
}
