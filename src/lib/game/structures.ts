/**
 * Structures are persistent map objects that anchor or modify territory.
 *
 * The first type is the State structure. It is the seed of a player's protected
 * mainland: every land component connected to a live State structure is exempt
 * from annexation. Capturing the structure destroys it and removes that
 * protection for the rest of the state's territory.
 */

export const STRUCTURE_TYPES = ['state'] as const;

export type StructureType = (typeof STRUCTURE_TYPES)[number];

/** State capitals project a defensive field over nearby land. */
export const STATE_AURA_RADIUS = 12;
export const STATE_AURA_DEFENSE = 20;

export interface DefenseAuraEffect {
	kind: 'defense-aura';
	/** Radius in map pixels. */
	radius: number;
	/** Flat defense added to every land pixel in range; overlapping auras do not stack. */
	defense: number;
}

export type StructureEffect = DefenseAuraEffect;

const STATE_EFFECTS: readonly StructureEffect[] = Object.freeze([
	{
		kind: 'defense-aura',
		radius: STATE_AURA_RADIUS,
		defense: STATE_AURA_DEFENSE
	}
]);

export function effectsForType(type: StructureType): readonly StructureEffect[] {
	switch (type) {
		case 'state':
			return STATE_EFFECTS;
	}
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
		return structure;
	}

	at(index: number): Structure | undefined {
		return this.byIndex.get(index);
	}

	destroy(structure: Structure): boolean {
		const position = this.items.indexOf(structure);
		if (position < 0) return false;
		this.items.splice(position, 1);
		this.byIndex.delete(structure.index);
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
