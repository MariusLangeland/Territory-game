import { effectsForType } from './definitions';
import type { Structure, StructureType } from './types';

const SPATIAL_BUCKET_SIZE = 32;

function bucketKey(bucketX: number, bucketY: number): number {
	return bucketX * 65_536 + bucketY;
}

export interface StructureRegistrySnapshot {
	items: Structure[];
	nextId: number;
	mutationVersion: number;
	layoutVersion: number;
}

export class StructureRegistry {
	private readonly items: Structure[] = [];
	private readonly byIndex = new Map<number, Structure>();
	private readonly byStructureId = new Map<number, Structure>();
	private readonly byOwner = new Map<number, Structure[]>();
	/** Coarse spatial buckets for structure-spacing queries. */
	private readonly byBucket = new Map<number, Structure[]>();
	private nextId = 1;
	/** Increments on every create/reinforce/destroy so derived caches can refresh lazily. */
	private mutationVersion = 0;
	/** Increments only when structures appear or disappear, not when stacks change. */
	private structureLayoutVersion = 0;

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
		this.structureLayoutVersion++;
		this.items.push(structure);
		this.byIndex.set(index, structure);
		this.byStructureId.set(structure.id, structure);
		this.addToBucket(structure);

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
		const minBucketX = Math.floor((x - radius) / SPATIAL_BUCKET_SIZE);
		const maxBucketX = Math.floor((x + radius) / SPATIAL_BUCKET_SIZE);
		const minBucketY = Math.floor((y - radius) / SPATIAL_BUCKET_SIZE);
		const maxBucketY = Math.floor((y + radius) / SPATIAL_BUCKET_SIZE);
		for (let bucketX = minBucketX; bucketX <= maxBucketX; bucketX++) {
			for (let bucketY = minBucketY; bucketY <= maxBucketY; bucketY++) {
				const bucket = this.byBucket.get(bucketKey(bucketX, bucketY));
				if (!bucket) continue;
				for (const structure of bucket) {
					const dx = structure.x - x;
					const dy = structure.y - y;
					if (dx * dx + dy * dy < radiusSq) return true;
				}
			}
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
		this.structureLayoutVersion++;
		this.items.splice(position, 1);
		this.byIndex.delete(structure.index);
		this.byStructureId.delete(structure.id);
		this.removeFromBucket(structure);

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

	private addToBucket(structure: Structure): void {
		const key = bucketKey(
			Math.floor(structure.x / SPATIAL_BUCKET_SIZE),
			Math.floor(structure.y / SPATIAL_BUCKET_SIZE)
		);
		let bucket = this.byBucket.get(key);
		if (!bucket) {
			bucket = [];
			this.byBucket.set(key, bucket);
		}
		bucket.push(structure);
	}

	private removeFromBucket(structure: Structure): void {
		const key = bucketKey(
			Math.floor(structure.x / SPATIAL_BUCKET_SIZE),
			Math.floor(structure.y / SPATIAL_BUCKET_SIZE)
		);
		const bucket = this.byBucket.get(key);
		if (!bucket) return;
		const position = bucket.indexOf(structure);
		if (position >= 0) bucket.splice(position, 1);
		if (bucket.length === 0) this.byBucket.delete(key);
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

	get layoutVersion(): number {
		return this.structureLayoutVersion;
	}

	snapshot(): StructureRegistrySnapshot {
		return {
			items: this.items.map((structure) => ({ ...structure, effects: [...structure.effects] })),
			nextId: this.nextId,
			mutationVersion: this.mutationVersion,
			layoutVersion: this.structureLayoutVersion
		};
	}

	restore(snapshot: StructureRegistrySnapshot): void {
		this.items.length = 0;
		this.byIndex.clear();
		this.byStructureId.clear();
		this.byOwner.clear();
		this.byBucket.clear();
		for (const original of snapshot.items) {
			const structure: Structure = {
				...original,
				effects: [...original.effects]
			};
			this.items.push(structure);
			this.byIndex.set(structure.index, structure);
			this.byStructureId.set(structure.id, structure);
			this.addToBucket(structure);
			let list = this.byOwner.get(structure.ownerId);
			if (!list) {
				list = [];
				this.byOwner.set(structure.ownerId, list);
			}
			list.push(structure);
		}
		this.nextId = snapshot.nextId;
		this.mutationVersion = snapshot.mutationVersion;
		this.structureLayoutVersion = snapshot.layoutVersion;
	}
}
