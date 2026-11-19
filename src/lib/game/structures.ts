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

export interface Structure {
	id: number;
	type: StructureType;
	ownerId: number;
	/** Packed map index. */
	index: number;
	x: number;
	y: number;
}

/** Immutable structure payload delivered to the HUD, minimap, and protocol. */
export interface PublicStructure {
	id: number;
	type: StructureType;
	ownerId: number;
	x: number;
	y: number;
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
			y
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
