/**
 * Territory-integrity cleanup.
 *
 * A live State structure anchors a player's mainland: every land component
 * connected to one of their structures is protected. An unprotected component
 * that can reach protection through a chain of adjacent owned components is
 * annexed by that protected owner; ties use the largest shared border, then the
 * lowest owner id.
 *
 * Unprotected components with no path to any protected component are abandoned
 * to neutral land. This guarantees that owned territory never survives as a
 * detached enclave indefinitely, even when it is an ocean island.
 */

export interface IntegrityResult {
	components: number;
	annexedComponents: number;
	annexedCells: number;
	abandonedComponents: number;
	abandonedCells: number;
}

interface ComponentMeta {
	/** 1-based component id, equal to `components.length + 1`. */
	id: number;
	owner: number;
	start: number;
	end: number;
	area: number;
}

export interface IntegrityAnchor {
	index: number;
	ownerId: number;
}

export interface UnclaimedCleanupResult {
	filledComponents: number;
	filledCells: number;
}

export class TerritoryIntegrity {
	private readonly width: number;
	private readonly height: number;
	private readonly playerCount: number;
	private readonly pixelCount: number;
	private readonly componentOf: Uint32Array;
	private readonly cellOrder: Uint32Array;
	/** Precomputed column per pixel; avoids modulo in every neighbour scan. */
	private readonly columnOf: Uint16Array;
	private readonly components: ComponentMeta[] = [];
	private readonly protectedComponent: Uint8Array;
	private readonly contactCounts: Uint32Array;
	private cellCount = 0;

	constructor(width: number, height: number, playerCount: number) {
		this.width = width;
		this.height = height;
		this.playerCount = playerCount;
		this.pixelCount = width * height;
		this.componentOf = new Uint32Array(this.pixelCount);
		this.cellOrder = new Uint32Array(this.pixelCount);
		this.columnOf = new Uint16Array(this.pixelCount);
		for (let index = 0; index < this.pixelCount; index++) {
			this.columnOf[index] = index % width;
		}
		this.protectedComponent = new Uint8Array(this.pixelCount);
		this.contactCounts = new Uint32Array(playerCount + 1);
	}

	/**
	 * Plan and apply annexations. `onAnnex` is called for every transferred
	 * cell in deterministic component/cell order.
	 */
	run(
		owners: Uint16Array,
		land: Uint8Array,
		anchors: readonly IntegrityAnchor[],
		onAnnex: (index: number, newOwner: number) => void,
		onAbandon: (index: number) => void
	): IntegrityResult {
		this.resetComponentLabels();
		this.components.length = 0;

		this.labelComponents(owners);
		this.protectedComponent.fill(0, 0, this.components.length);
		for (const anchor of anchors) {
			if (owners[anchor.index] !== anchor.ownerId) continue;
			const component = this.componentOf[anchor.index];
			if (component > 0) this.protectedComponent[component - 1] = 1;
		}

		const adjacency = this.buildComponentAdjacency();
		const componentCount = this.components.length;
		const targetOwner = new Uint16Array(componentCount + 1);
		const resolved = new Uint8Array(componentCount + 1);

		// Protected components are the roots. Every unprotected component that can
		// reach one through any number of adjacent owned components is resolved to
		// that root's owner; the rest are abandoned.
		for (const component of this.components) {
			if (!this.protectedComponent[component.id - 1]) continue;
			targetOwner[component.id] = component.owner;
			resolved[component.id] = 1;
		}

		let changed = true;
		while (changed) {
			changed = false;
			for (const component of this.components) {
				if (resolved[component.id]) continue;
				const target = this.chooseResolvedNeighbourTarget(
					component.id,
					adjacency,
					resolved,
					targetOwner
				);
				if (target === 0) continue;
				targetOwner[component.id] = target;
				resolved[component.id] = 1;
				changed = true;
			}
		}

		let annexedComponents = 0;
		let annexedCells = 0;
		let abandonedComponents = 0;
		let abandonedCells = 0;
		for (const component of this.components) {
			if (this.protectedComponent[component.id - 1]) continue;
			const target = targetOwner[component.id];
			if (target === 0) {
				abandonedComponents++;
				for (let i = component.start; i < component.end; i++) {
					onAbandon(this.cellOrder[i]);
					abandonedCells++;
				}
				continue;
			}

			let changedCells = 0;
			for (let i = component.start; i < component.end; i++) {
				const index = this.cellOrder[i];
				if (owners[index] === target) continue;
				onAnnex(index, target);
				changedCells++;
			}
			if (changedCells > 0) {
				annexedComponents++;
				annexedCells += changedCells;
			}
		}

		return {
			components: this.components.length,
			annexedComponents,
			annexedCells,
			abandonedComponents,
			abandonedCells
		};
	}

	/**
	 * Fill small neutral pockets. A pocket is eligible when it is no larger
	 * than `maxArea` and borders at least one owner. The owner with the largest
	 * shared border wins (lowest id on ties). Ocean contact is allowed: organic
	 * fronts often leave thin coastal gaps that read as distracting holes.
	 * Large neutral regions and ownerless islands are left alone so expansion
	 * still has open land to move into.
	 */
	cleanupUnclaimedPockets(
		owners: Uint16Array,
		land: Uint8Array,
		maxArea: number,
		onClaim: (index: number, newOwner: number) => void
	): UnclaimedCleanupResult {
		this.resetComponentLabels();
		let filledComponents = 0;
		let filledCells = 0;
		const width = this.width;
		const height = this.height;
		const counts = this.contactCounts;
		let nextId = 1;

		for (let seed = 0; seed < this.pixelCount; seed++) {
			if (this.componentOf[seed] !== 0 || !land[seed] || owners[seed] !== 0) continue;

			const id = nextId++;
			const start = this.cellCount;
			this.componentOf[seed] = id;
			this.cellOrder[this.cellCount++] = seed;
			let head = start;

			while (head < this.cellCount) {
				const index = this.cellOrder[head++];
				const x = index % width;
				const y = (index - x) / width;
				if (x > 0) this.visitUnclaimed(index - 1, id, owners, land);
				if (x + 1 < width) this.visitUnclaimed(index + 1, id, owners, land);
				if (y > 0) this.visitUnclaimed(index - width, id, owners, land);
				if (y + 1 < height) this.visitUnclaimed(index + width, id, owners, land);
			}

			const end = this.cellCount;
			const area = end - start;
			if (area > maxArea) continue;

			counts.fill(0);
			for (let i = start; i < end; i++) {
				const index = this.cellOrder[i];
				const x = index % width;
				const y = (index - x) / width;
				if (x > 0 && land[index - 1] && owners[index - 1] > 0) {
					counts[owners[index - 1]]++;
				}
				if (x + 1 < width && land[index + 1] && owners[index + 1] > 0) {
					counts[owners[index + 1]]++;
				}
				if (y > 0 && land[index - width] && owners[index - width] > 0) {
					counts[owners[index - width]]++;
				}
				if (y + 1 < height && land[index + width] && owners[index + width] > 0) {
					counts[owners[index + width]]++;
				}
			}

			let target = 0;
			let bestCount = 0;
			for (let owner = 1; owner <= this.playerCount; owner++) {
				const count = counts[owner];
				if (count > bestCount) {
					target = owner;
					bestCount = count;
				}
			}
			if (target === 0) continue;

			for (let i = start; i < end; i++) onClaim(this.cellOrder[i], target);
			filledComponents++;
			filledCells += area;
		}

		return { filledComponents, filledCells };
	}

	/**
	 * Clear only labels written by the previous pass. A full-map fill costs a
	 * fixed multi-megabyte write even though owned cells are a small fraction.
	 */
	private resetComponentLabels(): void {
		for (let i = 0; i < this.cellCount; i++) this.componentOf[this.cellOrder[i]] = 0;
		this.cellCount = 0;
	}

	private visitUnclaimed(index: number, id: number, owners: Uint16Array, land: Uint8Array): void {
		if (this.componentOf[index] !== 0) return;
		if (!land[index] || owners[index] !== 0) return;
		this.componentOf[index] = id;
		this.cellOrder[this.cellCount++] = index;
	}

	private labelComponents(owners: Uint16Array): void {
		const componentOf = this.componentOf;
		const cellOrder = this.cellOrder;
		const columnOf = this.columnOf;
		const width = this.width;

		for (let seed = 0; seed < this.pixelCount; seed++) {
			if (componentOf[seed] !== 0 || owners[seed] === 0) continue;

			const owner = owners[seed];
			const id = this.components.length + 1;
			const start = this.cellCount;
			cellOrder[this.cellCount++] = seed;
			componentOf[seed] = id;
			let head = start;

			while (head < this.cellCount) {
				const index = cellOrder[head++];
				const x = columnOf[index];

				if (x > 0) {
					const next = index - 1;
					if (componentOf[next] === 0 && owners[next] === owner) {
						componentOf[next] = id;
						cellOrder[this.cellCount++] = next;
					}
				}
				if (x + 1 < width) {
					const next = index + 1;
					if (componentOf[next] === 0 && owners[next] === owner) {
						componentOf[next] = id;
						cellOrder[this.cellCount++] = next;
					}
				}
				if (index >= width) {
					const next = index - width;
					if (componentOf[next] === 0 && owners[next] === owner) {
						componentOf[next] = id;
						cellOrder[this.cellCount++] = next;
					}
				}
				if (index + width < this.pixelCount) {
					const next = index + width;
					if (componentOf[next] === 0 && owners[next] === owner) {
						componentOf[next] = id;
						cellOrder[this.cellCount++] = next;
					}
				}
			}

			const end = this.cellCount;
			this.components.push({ id, owner, start, end, area: end - start });
		}
	}

	/**
	 * Undirected component adjacency, weighted by shared pixel edges. Built once
	 * per run so the protection graph can be traversed transitively.
	 */
	private buildComponentAdjacency(): Array<Map<number, number>> {
		const adjacency = Array.from(
			{ length: this.components.length + 1 },
			() => new Map<number, number>()
		);
		const width = this.width;
		const height = this.height;

		for (let index = 0; index < this.pixelCount; index++) {
			const component = this.componentOf[index];
			if (component === 0) continue;

			const x = index % width;
			const y = (index - x) / width;
			this.addComponentEdge(adjacency, component, index - 1, x > 0);
			this.addComponentEdge(adjacency, component, index + 1, x + 1 < width);
			this.addComponentEdge(adjacency, component, index - width, y > 0);
			this.addComponentEdge(adjacency, component, index + width, y + 1 < height);
		}

		return adjacency;
	}

	private addComponentEdge(
		adjacency: Array<Map<number, number>>,
		component: number,
		neighbour: number,
		inBounds: boolean
	): void {
		if (!inBounds) return;
		const other = this.componentOf[neighbour];
		if (other === 0 || other === component) return;
		const forwards = adjacency[component] as Map<number, number>;
		forwards.set(other, (forwards.get(other) ?? 0) + 1);
		const backwards = adjacency[other] as Map<number, number>;
		backwards.set(component, (backwards.get(component) ?? 0) + 1);
	}

	private chooseResolvedNeighbourTarget(
		componentId: number,
		adjacency: Array<Map<number, number>>,
		resolved: Uint8Array,
		targetOwner: Uint16Array
	): number {
		const counts = this.contactCounts;
		counts.fill(0);
		const neighbours = adjacency[componentId] as Map<number, number>;
		for (const [neighbourId, contact] of neighbours) {
			if (!resolved[neighbourId]) continue;
			const owner = targetOwner[neighbourId];
			if (owner === 0) continue;
			counts[owner] += contact;
		}

		let bestOwner = 0;
		let bestCount = 0;
		for (let owner = 1; owner <= this.playerCount; owner++) {
			const count = counts[owner];
			if (count === 0) continue;
			if (count > bestCount || (count === bestCount && (bestOwner === 0 || owner < bestOwner))) {
				bestOwner = owner;
				bestCount = count;
			}
		}
		return bestOwner;
	}
}
