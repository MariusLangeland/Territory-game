import { effectsForType } from './definitions';
import type { Structure, StructureType } from './types';

export class StructureRegistry {
	private readonly items: Structure[] = [];
	private readonly byIndex = new Map<number, Structure>();
	private readonly byStructureId = new Map<number, Structure>();
	private readonly byOwner = new Map<number, Structure[]>();
	private nextId = 1;
	/** Increments on every create/reinforce/destroy so derived caches can refresh lazily. */
	private mutationVersion = 0;

	create(type: StructureType, ownerId: number, x: number, y: number, width: number): Structure {
		const index = y * width + x;
		const structure: Structure = {
			id: this.nextId++,
			type,
			ownerId,
			index,
			x,
			y,
			stacks: 1,
			effects: effectsForType(type)
		};
		this.mutationVersion++;
		this.items.push(structure);
		this.byIndex.set(index, structure);
		this.byStructureId.set(structure.id, structure);

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

	byId(structureId: number): Structure | undefined {
		return this.byStructureId.get(structureId);
	}

	/** True when a structure centre lies inside the forbidden build radius. */
	hasWithinRadius(x: number, y: number, radius: number): boolean {
		const radiusSq = radius * radius;
		for (const structure of this.items) {
			const dx = structure.x - x;
			const dy = structure.y - y;
			if (dx * dx + dy * dy < radiusSq) return true;
		}
		return false;
	}

	forOwner(ownerId: number): readonly Structure[] {
		return this.byOwner.get(ownerId) ?? [];
	}

	forOwnerType(ownerId: number, type: StructureType): Structure | undefined {
		return this.byOwner.get(ownerId)?.find((structure) => structure.type === type);
	}

	reinforce(structure: Structure): number {
		structure.stacks++;
		this.mutationVersion++;
		return structure.stacks;
	}

	/** Test/setup helper; real progression must use `reinforce`. */
	setStacks(structure: Structure, stacks: number): number {
		if (stacks < 1) throw new Error('structure stacks must be positive');
		structure.stacks = stacks;
		this.mutationVersion++;
		return structure.stacks;
	}

	destroy(structure: Structure): boolean {
		const position = this.items.indexOf(structure);
		if (position < 0) return false;
		this.mutationVersion++;
		this.items.splice(position, 1);
		this.byIndex.delete(structure.index);
		this.byStructureId.delete(structure.id);

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

	get version(): number {
		return this.mutationVersion;
	}
}
