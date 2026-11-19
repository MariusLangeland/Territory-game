/**
 * Structure and card types shared by the registry, simulation, protocol, and UI.
 *
 * Concrete structure definitions live in one file per type in this folder.
 */

export type StructureType =
	'state' | 'mine' | 'barracks' | 'defense-post' | 'command-post' | 'war-academy';

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

export interface AttackAuraEffect {
	kind: 'attack-aura';
	/** Radius in map pixels. */
	radius: number;
	/** Defense points ignored by the owner's attacks inside the aura. */
	strength: number;
}

export interface IncomeEffect {
	kind: 'income';
	goldPerInterval: number;
}

export interface OrderGainEffect {
	kind: 'order-gain';
	intervalTicks: number;
	amount: number;
}

export interface OrderCapEffect {
	kind: 'order-cap';
	amount: number;
}

export type StructureEffect =
	DefenseAuraEffect | AttackAuraEffect | IncomeEffect | OrderGainEffect | OrderCapEffect;

export interface StructureDefinition {
	label: string;
	description: string;
	cost: number;
	buildable: boolean;
	/** UI and map-marker accent used by cards, icons, and selection states. */
	accent: string;
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
	effects: readonly StructureEffect[];
}

/** Immutable structure payload delivered to the HUD, minimap, and protocol. */
export interface PublicStructure {
	id: number;
	type: StructureType;
	ownerId: number;
	x: number;
	y: number;
	effects: readonly StructureEffect[];
}
