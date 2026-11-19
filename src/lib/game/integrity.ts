/**
 * Territory-integrity cleanup.
 *
 * A player's mainland is their largest connected land component. Any smaller
 * component that touches a *mainland* component of another player is annexed
 * by the owner with the largest shared border (lowest id on a tie).
 *
 * Components that only touch unclaimed land, ocean, or another detached
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

export class TerritoryIntegrity {
	private readonly width: number;
	private readonly height: number;
	private readonly playerCount: number;
	private readonly pixelCount: number;
	private readonly componentOf: Uint32Array;
	private readonly cellOrder: Uint32Array;
	private readonly components: ComponentMeta[] = [];
	private readonly mainComponent: Uint32Array;
	private readonly mainArea: Uint32Array;
	private readonly contactCounts: Uint32Array;
	private cellCount = 0;

	constructor(width: number, height: number, playerCount: number) {
		this.width = width;
		this.height = height;
		this.playerCount = playerCount;
		this.pixelCount = width * height;
		this.componentOf = new Uint32Array(this.pixelCount);
		this.cellOrder = new Uint32Array(this.pixelCount);
		this.mainComponent = new Uint32Array(playerCount + 1);
		this.mainArea = new Uint32Array(playerCount + 1);
		this.contactCounts = new Uint32Array(playerCount + 1);
	}

	/**
	 * Plan and apply annexations. `onAnnex` is called for every transferred
	 * cell in deterministic component/cell order.
	 */
	run(
		owners: Uint16Array,
		land: Uint8Array,
		onAnnex: (index: number, newOwner: number) => void
	): IntegrityResult {
		this.componentOf.fill(0);
		this.mainComponent.fill(0);
		this.mainArea.fill(0);
		this.cellCount = 0;
		this.components.length = 0;

		this.labelComponents(owners, land);
		this.findMainlands();

		let annexedComponents = 0;
		let annexedCells = 0;
		for (const component of this.components) {
			if (component.id === this.mainComponent[component.owner]) continue;
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

	private findMainlands(): void {
		for (const component of this.components) {
			if (component.area > this.mainArea[component.owner]) {
				this.mainArea[component.owner] = component.area;
				this.mainComponent[component.owner] = component.id;
			}
		}
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
		if (this.componentOf[neighbour] !== this.mainComponent[owner]) return;
		this.contactCounts[owner]++;
	}
}
