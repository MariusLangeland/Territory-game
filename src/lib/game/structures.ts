/**
 * Structures are persistent map objects that anchor or modify territory.
 *
 * State structures anchor protected mainland and project a large defensive
 * aura. Buildable structures are bought as cards and dropped onto controlled
 * territory. Any structure whose cell is captured is razed.
 */

import { COMMAND_POST_ORDER_TICKS } from './constants';

export const STRUCTURE_TYPES = [
	'state',
	'mine',
	'barracks',
	'defense-post',
	'command-post',
	'war-academy'
] as const;

export type StructureType = (typeof STRUCTURE_TYPES)[number];

export type BuildableStructureType = Exclude<StructureType, 'state'>;

export const BUILDABLE_STRUCTURE_TYPES = [
	'mine',
	'barracks',
	'defense-post',
	'command-post',
	'war-academy'
] as const;

/** State capitals project a defensive field over nearby land. */
export const STATE_AURA_RADIUS = 12;
export const STATE_AURA_DEFENSE = 20;

export const MINE_INCOME_PER_INTERVAL = 1;
export const BARRACKS_AURA_RADIUS = 18;
export const BARRACKS_ATTACK_STRENGTH = 1;
export const DEFENSE_POST_AURA_RADIUS = 8;
export const DEFENSE_POST_DEFENSE = 1;

export interface DefenseAuraEffect {
	kind: 'defense-aura';
	/** Radius in map pixels. */
	radius: number;
	/** Flat defense added to every land pixel in range. */
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
	effects: readonly StructureEffect[];
}

export const STRUCTURE_DEFINITIONS: Record<StructureType, StructureDefinition> = {
	state: {
		label: 'STATE',
		description: 'Anchors protected territory; projects a +20 defense aura.',
		cost: 0,
		buildable: false,
		effects: [
			{
				kind: 'defense-aura',
				radius: STATE_AURA_RADIUS,
				defense: STATE_AURA_DEFENSE,
				stacking: 'max'
			}
		]
	},
	mine: {
		label: 'MINE',
		description: '+1 income every 10 seconds.',
		cost: 3,
		buildable: true,
		effects: [{ kind: 'income', goldPerInterval: MINE_INCOME_PER_INTERVAL }]
	},
	barracks: {
		label: 'BARRACKS',
		description: 'Friendly attacks ignore 1 defense in a large radius.',
		cost: 2,
		buildable: true,
		effects: [
			{
				kind: 'attack-aura',
				radius: BARRACKS_AURA_RADIUS,
				strength: BARRACKS_ATTACK_STRENGTH
			}
		]
	},
	'defense-post': {
		label: 'DEFENSE POST',
		description: '+1 pixel defense in a medium radius.',
		cost: 1,
		buildable: true,
		effects: [
			{
				kind: 'defense-aura',
				radius: DEFENSE_POST_AURA_RADIUS,
				defense: DEFENSE_POST_DEFENSE,
				stacking: 'add'
			}
		]
	},
	'command-post': {
		label: 'COMMAND POST',
		description: 'Gain +1 attack order every 60 seconds.',
		cost: 4,
		buildable: true,
		effects: [
			{
				kind: 'order-gain',
				intervalTicks: COMMAND_POST_ORDER_TICKS,
				amount: 1
			}
		]
	},
	'war-academy': {
		label: 'WAR ACADEMY',
		description: 'Increase the attack-order refresh cap by 1.',
		cost: 6,
		buildable: true,
		effects: [{ kind: 'order-cap', amount: 1 }]
	}
};

export function effectsForType(type: StructureType): readonly StructureEffect[] {
	return STRUCTURE_DEFINITIONS[type].effects;
}

export function costForType(type: StructureType): number {
	return STRUCTURE_DEFINITIONS[type].cost;
}

export function definitionForType(type: StructureType): StructureDefinition {
	return STRUCTURE_DEFINITIONS[type];
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

export class StructureRegistry {
	private readonly items: Structure[] = [];
	private readonly byIndex = new Map<number, Structure>();
	private readonly byOwner = new Map<number, Structure[]>();
	private nextId = 1;

	create(type: StructureType, ownerId: number, x: number, y: number, width: number): Structure {
		const index = y * width + x;
		const structure: Structure = {
			id: this.nextId++,
			type,
			ownerId,
			index,
			x,
			y,
			effects: effectsForType(type)
		};
		this.items.push(structure);
		this.byIndex.set(index, structure);

		let ownerStructures = this.byOwner.get(ownerId);
		if (!ownerStructures) {
			ownerStructures = [];
			this.byOwner.set(ownerId, ownerStructures);
		}
		ownerStructures.push(structure);
		return structure;
	}

	at(index: number): Structure | undefined {
		return this.byIndex.get(index);
	}

	forOwner(ownerId: number): readonly Structure[] {
		return this.byOwner.get(ownerId) ?? [];
	}

	destroy(structure: Structure): boolean {
		const position = this.items.indexOf(structure);
		if (position < 0) return false;
		this.items.splice(position, 1);
		this.byIndex.delete(structure.index);

		const ownerStructures = this.byOwner.get(structure.ownerId);
		if (ownerStructures) {
			const ownerPosition = ownerStructures.indexOf(structure);
			if (ownerPosition >= 0) ownerStructures.splice(ownerPosition, 1);
			if (ownerStructures.length === 0) this.byOwner.delete(structure.ownerId);
		}
		return true;
	}

	destroyAt(index: number): Structure | undefined {
		const structure = this.byIndex.get(index);
		if (!structure) return undefined;
		this.destroy(structure);
		return structure;
	}

	get all(): readonly Structure[] {
		return this.items;
	}

	get count(): number {
		return this.items.length;
	}
}
