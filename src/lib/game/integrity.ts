/**
 * Territory-integrity cleanup.
 *
 * A live State structure anchors a player's mainland: every land component
 * connected to one of their structures is protected. Unprotected components that
 * touch a foreign protected component are annexed by the owner with the largest
 * shared border (lowest id on a tie).
 *
 * Components that only touch unclaimed land, ocean, or another unprotected
 * component are left alone. This avoids deleting legitimate islands and avoids
 * chains of detached components swapping owners every pass.
 */

export interface IntegrityResult {
	components: number;
	annexedComponents: number;
	annexedCells: number;
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
		onAnnex: (index: number, newOwner: number) => void
	): IntegrityResult {
		this.resetComponentLabels();
		this.components.length = 0;

		this.labelComponents(owners, land);
		this.protectedComponent.fill(0, 0, this.components.length);
		for (const anchor of anchors) {
			if (owners[anchor.index] !== anchor.ownerId) continue;
			const component = this.componentOf[anchor.index];
			if (component > 0) this.protectedComponent[component - 1] = 1;
		}

		let annexedComponents = 0;
		let annexedCells = 0;
		for (const component of this.components) {
			if (this.protectedComponent[component.id - 1]) continue;
			const target = this.chooseAnnexingOwner(component, owners, land);
			if (target === 0) continue;

			annexedComponents++;
			for (let i = component.start; i < component.end; i++) {
				onAnnex(this.cellOrder[i], target);
				annexedCells++;
			}
		}

		return {
			components: this.components.length,
			annexedComponents,
			annexedCells
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

	private labelComponents(owners: Uint16Array, land: Uint8Array): void {
		const componentOf = this.componentOf;
		const cellOrder = this.cellOrder;
		const width = this.width;
		const height = this.height;

		for (let seed = 0; seed < this.pixelCount; seed++) {
			if (componentOf[seed] !== 0 || !land[seed] || owners[seed] === 0) continue;

			const owner = owners[seed];
			const id = this.components.length + 1;
			const start = this.cellCount;
			cellOrder[this.cellCount++] = seed;
			componentOf[seed] = id;
			let head = start;

			while (head < this.cellCount) {
				const index = cellOrder[head++];
				const x = index % width;
				const y = (index - x) / width;

				if (x > 0) this.visit(index - 1, owner, id, owners, land);
				if (x + 1 < width) this.visit(index + 1, owner, id, owners, land);
				if (y > 0) this.visit(index - width, owner, id, owners, land);
				if (y + 1 < height) this.visit(index + width, owner, id, owners, land);
			}

			const end = this.cellCount;
			this.components.push({ id, owner, start, end, area: end - start });
		}
	}

	private visit(
		index: number,
		owner: number,
		id: number,
		owners: Uint16Array,
		land: Uint8Array
	): void {
		if (this.componentOf[index] !== 0) return;
		if (!land[index] || owners[index] !== owner) return;
		this.componentOf[index] = id;
		this.cellOrder[this.cellCount++] = index;
	}

	private chooseAnnexingOwner(
		component: ComponentMeta,
		owners: Uint16Array,
		land: Uint8Array
	): number {
		const width = this.width;
		const height = this.height;
		const counts = this.contactCounts;
		counts.fill(0);
		let bestOwner = 0;
		let bestCount = 0;

		for (let i = component.start; i < component.end; i++) {
			const index = this.cellOrder[i];
			const x = index % width;
			const y = (index - x) / width;

			this.countContact(index - 1, x > 0, component.owner, owners, land);
			this.countContact(index + 1, x + 1 < width, component.owner, owners, land);
			this.countContact(index - width, y > 0, component.owner, owners, land);
			this.countContact(index + width, y + 1 < height, component.owner, owners, land);
		}

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

	private countContact(
		neighbour: number,
		inBounds: boolean,
		componentOwner: number,
		owners: Uint16Array,
		land: Uint8Array
	): void {
		if (!inBounds || !land[neighbour]) return;
		const owner = owners[neighbour];
		if (owner === 0 || owner === componentOwner) return;
		const neighbourComponent = this.componentOf[neighbour];
		if (neighbourComponent === 0) return;
		if (!this.protectedComponent[neighbourComponent - 1]) return;
		this.contactCounts[owner]++;
	}
}
