import { effectsForType } from './definitions';
import type { Structure, StructureType } from './types';

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
