/**
 * Structure and card types shared by the registry, simulation, protocol, and UI.
 *
 * Concrete structure definitions live in one file per type in this folder.
 */

export type StructureType =
	| 'state'
	| 'artillery'
	| 'barracks'
	| 'fortification'
	| 'command-post'
	| 'war-academy'
	| 'jammer'
	| 'port';

export type BuildableStructureType = Exclude<StructureType, 'state'>;

export interface DefenseAuraEffect {
	kind: 'defense-aura';
	/** Radius in map pixels. */
	radius: number;
	/** Flat defense added to land in range owned by the structure owner. */
	defense: number;
	/** State auras use max; stacked buildings add. */
	stacking: 'max' | 'add';
}

export interface BarracksPowerEffect {
	kind: 'barracks-power';
	/** Attack-strength levels added per structure stack. */
	amount: number;
}

export interface SupplyIncomeEffect {
	kind: 'supply-income';
	/** Supply generated per second. */
	perSecond: number;
}

export interface SupplyCapEffect {
	kind: 'supply-cap';
	amount: number;
}

/** Declarative active-ability data for UI and deterministic simulation validation. */
export interface ArtilleryEffect {
	kind: 'artillery';
	range: number;
	cooldownTicks: number;
	shellsPerLevel: number;
	supplyCostPerLevel: number;
	cooldownSeconds: number;
}

/** Global suppression of enemy Barracks scaling; no pixel defense is added. */
export interface BarracksSuppressionEffect {
	kind: 'barracks-suppression';
	amount: number;
}

/** Marks a shore structure that enables naval landings and sea protection. */
export interface PortEffect {
	kind: 'port';
}

export type StructureEffect =
	| DefenseAuraEffect
	| BarracksPowerEffect
	| SupplyIncomeEffect
	| SupplyCapEffect
	| ArtilleryEffect
	| BarracksSuppressionEffect
	| PortEffect;

export interface StructureDefinition {
	label: string;
	description: string;
	cost: number;
	buildable: boolean;
	/** UI and map-marker accent used by cards, icons, and selection states. */
	accent: string;
	/** Maximum Euclidean claim radius for this structure's district. */
	districtRange: number;
	effects: readonly StructureEffect[];
}

export interface Card {
	id: number;
	type: BuildableStructureType;
}

export interface PublicCard {
	id: number;
	type: BuildableStructureType;
}

export interface Structure {
	id: number;
	type: StructureType;
	ownerId: number;
	/** Packed map index. */
	index: number;
	x: number;
	y: number;
	stacks: number;
	effects: readonly StructureEffect[];
}

/** Immutable structure payload delivered to the HUD, minimap, and protocol. */
export interface PublicStructure {
	id: number;
	type: StructureType;
	ownerId: number;
	x: number;
	y: number;
	stacks: number;
	effects: readonly StructureEffect[];
	/** Tick at which this structure's active ability is ready; 0 for passive types. */
	readyAtTick: number;
}
