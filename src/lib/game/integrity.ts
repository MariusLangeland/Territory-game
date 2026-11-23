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

export interface IntegrityAnchor {
	index: number;
	ownerId: number;
}

export interface UnclaimedCleanupResult {
	filledComponents: number;
	filledCells: number;
}

/**
 * Region-cleanup visit stamps share `componentOf` with annexation component
 * ids. Bit 31 marks a stamp, so an annex label (a small positive integer) is
 * never confused with a previous region-cleanup visit. Attempts within one
 * pass are unique; a stamp from a previous attempt always means "this neutral
 * component was already walked and found too large".
 */
const STAMP_BIT = 0x8000_0000;
const STAMP_PASS_SHIFT = 21;
const STAMP_PASS_MASK = 0x3ff;
const STAMP_ATTEMPT_MASK = 0x1f_ffff;

export class TerritoryIntegrity {
	private readonly width: number;
	private readonly height: number;
	private readonly playerCount: number;
	private readonly pixelCount: number;
	private readonly componentOf: Uint32Array;
	private readonly cellOrder: Uint32Array;
	/** Precomputed column per pixel; avoids modulo in every neighbour scan. */
	private readonly columnOf: Uint16Array;
	/**
	 * Component metadata in flat arrays (1-based ids). Allocating a
	 * {id, owner, start, end, area} object per component measured at 13% of the
	 * annex scan's self time, and adjacency is now resolved from component cells
	 * directly instead of a Map graph.
	 */
	private componentOwner = new Uint16Array(1024);
	private componentStart = new Uint32Array(1024);
	private componentEnd = new Uint32Array(1024);
	private componentCount = 0;
	/** Per-component resolution scratch, sized with the component arrays. */
	private targetOwner = new Uint16Array(1025);
	private resolved = new Uint8Array(1024);
	private protectedComponent = new Uint8Array(1024);
	private readonly contactCounts: Uint32Array;
	private cellCount = 0;
	/** Scratch cell list for one region-cleanup flood (maxArea + 1 cells). */
	private regionScratch: Uint32Array = new Uint32Array(0);
	/** Visit-stamp generation and per-run token so stale stamps are ignored. */
	private regionPass = 0;
	private regionAttempt = 0;

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
		this.contactCounts = new Uint32Array(playerCount + 1);
	}

	/** Grow flat component/scratch arrays; component counts stay small. */
	private ensureComponentCapacity(required: number): void {
		if (this.componentOwner.length >= required) return;
		let capacity = this.componentOwner.length;
		while (capacity < required) capacity *= 2;
		const owner = new Uint16Array(capacity);
		owner.set(this.componentOwner);
		this.componentOwner = owner;
		const start = new Uint32Array(capacity);
		start.set(this.componentStart);
		this.componentStart = start;
		const end = new Uint32Array(capacity);
		end.set(this.componentEnd);
		this.componentEnd = end;
		const protectedComponents = new Uint8Array(capacity);
		protectedComponents.set(this.protectedComponent);
		this.protectedComponent = protectedComponents;
		const resolved = new Uint8Array(capacity);
		resolved.set(this.resolved);
		this.resolved = resolved;
		const targetOwner = new Uint16Array(capacity + 1);
		targetOwner.set(this.targetOwner);
		this.targetOwner = targetOwner;
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
		this.labelComponents(owners);
		const componentCount = this.componentCount;
		this.ensureComponentCapacity(componentCount);
		const protectedComponent = this.protectedComponent;
		protectedComponent.fill(0, 0, componentCount);
		for (const anchor of anchors) {
			if (owners[anchor.index] !== anchor.ownerId) continue;
			const component = this.componentOf[anchor.index] as number;
			if (component > 0) protectedComponent[component - 1] = 1;
		}

		let unprotected = 0;
		for (let i = 0; i < componentCount; i++) if (!protectedComponent[i]) unprotected++;
		if (unprotected === 0) {
			return {
				components: componentCount,
				annexedComponents: 0,
				annexedCells: 0,
				abandonedComponents: 0,
				abandonedCells: 0
			};
		}

		const targetOwner = this.targetOwner;
		const resolved = this.resolved;
		targetOwner.fill(0, 0, componentCount + 1);
		resolved.fill(0, 0, componentCount);

		// Protected components are the roots. Every unprotected component that can
		// reach one through any number of adjacent owned components is resolved to
		// that root's owner; the rest are abandoned.
		for (let component = 0; component < componentCount; component++) {
			if (!protectedComponent[component]) continue;
			targetOwner[component + 1] = this.componentOwner[component] as number;
			resolved[component] = 1;
		}

		// The original pass repeated forward scans until a fixpoint; keep that
		// exact order so the chosen owner matches the former Map-adjacency pass.
		let unresolved = unprotected;
		let changed = true;
		while (changed && unresolved > 0) {
			changed = false;
			for (let component = 0; component < componentCount; component++) {
				if (resolved[component]) continue;
				const target = this.chooseResolvedNeighbourTarget(component, owners);
				if (target === 0) continue;
				targetOwner[component + 1] = target;
				resolved[component] = 1;
				unresolved--;
				changed = true;
			}
		}

		let annexedComponents = 0;
		let annexedCells = 0;
		let abandonedComponents = 0;
		let abandonedCells = 0;
		for (let component = 0; component < componentCount; component++) {
			if (protectedComponent[component]) continue;
			const target = targetOwner[component + 1] as number;
			const start = this.componentStart[component] as number;
			const end = this.componentEnd[component] as number;
			if (target === 0) {
				abandonedComponents++;
				for (let i = start; i < end; i++) {
					onAbandon(this.cellOrder[i] as number);
					abandonedCells++;
				}
				continue;
			}

			let changedCells = 0;
			for (let i = start; i < end; i++) {
				const index = this.cellOrder[i] as number;
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
			components: componentCount,
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
			if (
				!land[seed] ||
				owners[seed] !== 0 ||
				this.isComponentLabel(this.componentOf[seed] as number)
			) {
				continue;
			}

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
	 * Fill small neutral pockets created or made eligible by recent ownership
	 * changes, without scanning the whole map. Seeds are the changed cells and
	 * their four neutral neighbours: those are the only neutral components whose
	 * area or owner contact can have changed since the previous pass.
	 *
	 * A flood capped at `maxArea` proves an oversized component cheaply, and
	 * walked cells keep a visit stamp so one large component is not re-flooded
	 * from every seed along the change front. Fills are replayed in the same
	 * order a full pass uses (component minimum cell index, BFS order from that
	 * cell) because claim order feeds border-set insertion order, which some bot
	 * targeting reads. That keeps the owner map and downstream decisions
	 * byte-identical to a full pass even when several pockets are eligible.
	 */
	cleanupUnclaimedPocketsNearChanges(
		owners: Uint16Array,
		land: Uint8Array,
		maxArea: number,
		changes: Uint32Array,
		changeCount: number,
		onClaim: (index: number, newOwner: number) => void
	): UnclaimedCleanupResult {
		const required = maxArea + 1;
		if (this.regionScratch.length < required) this.regionScratch = new Uint32Array(required);
		const scratch = this.regionScratch;
		const componentOf = this.componentOf;
		const width = this.width;
		const height = this.height;
		const counts = this.contactCounts;
		this.beginRegionPass();
		let filledComponents = 0;
		let filledCells = 0;
		/** Eligible components collected this pass, replayed in full-scan order. */
		const pendingCells: number[][] = [];
		const pendingTargets: number[] = [];
		const pendingMinimum: number[] = [];

		const flood = (seed: number): void => {
			if (!land[seed] || owners[seed] !== 0) return;
			if (this.isCurrentPassStamp(componentOf[seed] as number)) return;
			const stamp = this.nextRegionStamp();
			let tail = 0;
			let oversized = false;
			scratch[tail++] = seed;
			componentOf[seed] = stamp;
			let head = 0;
			while (head < tail) {
				const index = scratch[head++] as number;
				const x = index % width;
				const y = (index - x) / width;
				if (x > 0) {
					const next = index - 1;
					if (land[next] && owners[next] === 0) {
						const value = componentOf[next] as number;
						if (value !== stamp) {
							if (this.isCurrentPassStamp(value)) oversized = true;
							else {
								componentOf[next] = stamp;
								scratch[tail++] = next;
								if (tail > maxArea) oversized = true;
							}
						}
					}
				}
				if (!oversized && x + 1 < width) {
					const next = index + 1;
					if (land[next] && owners[next] === 0) {
						const value = componentOf[next] as number;
						if (value !== stamp) {
							if (this.isCurrentPassStamp(value)) oversized = true;
							else {
								componentOf[next] = stamp;
								scratch[tail++] = next;
								if (tail > maxArea) oversized = true;
							}
						}
					}
				}
				if (!oversized && y > 0) {
					const next = index - width;
					if (land[next] && owners[next] === 0) {
						const value = componentOf[next] as number;
						if (value !== stamp) {
							if (this.isCurrentPassStamp(value)) oversized = true;
							else {
								componentOf[next] = stamp;
								scratch[tail++] = next;
								if (tail > maxArea) oversized = true;
							}
						}
					}
				}
				if (!oversized && y + 1 < height) {
					const next = index + width;
					if (land[next] && owners[next] === 0) {
						const value = componentOf[next] as number;
						if (value !== stamp) {
							if (this.isCurrentPassStamp(value)) oversized = true;
							else {
								componentOf[next] = stamp;
								scratch[tail++] = next;
								if (tail > maxArea) oversized = true;
							}
						}
					}
				}
				if (oversized) break;
			}
			if (oversized) return;

			counts.fill(0);
			for (let i = 0; i < tail; i++) {
				const index = scratch[i] as number;
				const x = index % width;
				const y = (index - x) / width;
				if (x > 0 && land[index - 1] && owners[index - 1] > 0) {
					counts[owners[index - 1] as number]++;
				}
				if (x + 1 < width && land[index + 1] && owners[index + 1] > 0) {
					counts[owners[index + 1] as number]++;
				}
				if (y > 0 && land[index - width] && owners[index - width] > 0) {
					counts[owners[index - width] as number]++;
				}
				if (y + 1 < height && land[index + width] && owners[index + width] > 0) {
					counts[owners[index + width] as number]++;
				}
			}
			let target = 0;
			let bestCount = 0;
			for (let owner = 1; owner <= this.playerCount; owner++) {
				const count = counts[owner] as number;
				if (count > bestCount) {
					target = owner;
					bestCount = count;
				}
			}
			if (target === 0) return;
			let minimum = scratch[0] as number;
			for (let i = 1; i < tail; i++) {
				const cell = scratch[i] as number;
				if (cell < minimum) minimum = cell;
			}
			pendingCells.push(Array.from(scratch.subarray(0, tail)));
			pendingTargets.push(target);
			pendingMinimum.push(minimum);
		};

		for (let i = 0; i < changeCount; i++) {
			const index = changes[i] as number;
			flood(index);
			const x = index % width;
			const y = (index - x) / width;
			if (x > 0) flood(index - 1);
			if (x + 1 < width) flood(index + 1);
			if (y > 0) flood(index - width);
			if (y + 1 < height) flood(index + width);
		}

		// Full passes walk components in row-major seed order and fill each one in
		// BFS order from its minimum cell; replay exactly that order.
		const order = pendingMinimum.map((_, index) => index);
		order.sort(
			(left, right) => (pendingMinimum[left] as number) - (pendingMinimum[right] as number)
		);
		for (const candidate of order) {
			const cells = pendingCells[candidate] as number[];
			const target = pendingTargets[candidate] as number;
			const minimum = pendingMinimum[candidate] as number;
			const remaining = new Set<number>(cells);
			remaining.delete(minimum);
			const queue: number[] = [minimum];
			let head = 0;
			while (head < queue.length) {
				const index = queue[head++] as number;
				onClaim(index, target);
				const x = index % width;
				const y = (index - x) / width;
				if (x > 0) {
					const next = index - 1;
					if (remaining.delete(next)) queue.push(next);
				}
				if (x + 1 < width) {
					const next = index + 1;
					if (remaining.delete(next)) queue.push(next);
				}
				if (y > 0) {
					const next = index - width;
					if (remaining.delete(next)) queue.push(next);
				}
				if (y + 1 < height) {
					const next = index + width;
					if (remaining.delete(next)) queue.push(next);
				}
			}
			filledComponents++;
			filledCells += cells.length;
		}
		return { filledComponents, filledCells };
	}

	private isCurrentPassStamp(value: number): boolean {
		return (
			(value & STAMP_BIT) !== 0 &&
			((value >>> STAMP_PASS_SHIFT) & STAMP_PASS_MASK) === this.regionPass
		);
	}

	private beginRegionPass(): void {
		this.regionPass = (this.regionPass + 1) & STAMP_PASS_MASK;
		if (this.regionPass === 0) {
			// Ten-bit generation wrapped (1024 cleanup passes): clear stamps so a
			// previous generation cannot alias the new one.
			this.componentOf.fill(0);
			this.regionPass = 1;
		}
		this.regionAttempt = 0;
	}

	private nextRegionStamp(): number {
		this.regionAttempt++;
		if (this.regionAttempt > STAMP_ATTEMPT_MASK) {
			this.beginRegionPass();
			this.regionAttempt = 1;
		}
		// `|` produces a signed int32; store/compare the unsigned value so the
		// stamp read back from the Uint32Array matches exactly.
		return (STAMP_BIT | (this.regionPass << STAMP_PASS_SHIFT) | this.regionAttempt) >>> 0;
	}

	/** True for an annexation component id; region-cleanup stamps are not labels. */
	private isComponentLabel(value: number): boolean {
		return value !== 0 && (value & STAMP_BIT) === 0;
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
		if (!land[index] || owners[index] !== 0) return;
		if (this.isComponentLabel(this.componentOf[index] as number)) return;
		this.componentOf[index] = id;
		this.cellOrder[this.cellCount++] = index;
	}

	private labelComponents(owners: Uint16Array): void {
		this.componentCount = 0;
		// Seed scan: read two cells per 32-bit word. The map is 8.4M cells while
		// owned land is a small fraction, so halving the seed-scan loop matters.
		if ((owners.byteOffset & 3) === 0 && owners.length > 1) {
			const pairs = new Uint32Array(owners.buffer, owners.byteOffset, owners.length >>> 1);
			for (let pair = 0; pair < pairs.length; pair++) {
				const value = pairs[pair] as number;
				if (value === 0) continue;
				if ((value & 0xffff) !== 0) this.labelComponentFromSeed(owners, pair * 2);
				if (value >>> 16 !== 0) this.labelComponentFromSeed(owners, pair * 2 + 1);
			}
			if ((owners.length & 1) !== 0 && owners[owners.length - 1] !== 0) {
				this.labelComponentFromSeed(owners, owners.length - 1);
			}
			return;
		}
		for (let seed = 0; seed < this.pixelCount; seed++) {
			if (owners[seed] !== 0) this.labelComponentFromSeed(owners, seed);
		}
	}

	/** Flood one same-owner 4-connected component from a seed cell. */
	private labelComponentFromSeed(owners: Uint16Array, seed: number): void {
		const componentOf = this.componentOf;
		if (owners[seed] === 0 || this.isComponentLabel(componentOf[seed] as number)) return;
		if (this.componentCount === this.componentOwner.length) {
			this.ensureComponentCapacity(this.componentCount + 1);
		}
		const cellOrder = this.cellOrder;
		const columnOf = this.columnOf;
		const width = this.width;
		const pixelCount = this.pixelCount;
		const owner = owners[seed] as number;
		const id = this.componentCount + 1;
		const start = this.cellCount;
		cellOrder[this.cellCount++] = seed;
		componentOf[seed] = id;
		let head = start;

		while (head < this.cellCount) {
			const index = cellOrder[head++] as number;
			const x = columnOf[index] as number;

			if (x > 0) {
				const next = index - 1;
				if (owners[next] === owner && !this.isComponentLabel(componentOf[next] as number)) {
					componentOf[next] = id;
					cellOrder[this.cellCount++] = next;
				}
			}
			if (x + 1 < width) {
				const next = index + 1;
				if (owners[next] === owner && !this.isComponentLabel(componentOf[next] as number)) {
					componentOf[next] = id;
					cellOrder[this.cellCount++] = next;
				}
			}
			if (index >= width) {
				const next = index - width;
				if (owners[next] === owner && !this.isComponentLabel(componentOf[next] as number)) {
					componentOf[next] = id;
					cellOrder[this.cellCount++] = next;
				}
			}
			if (index + width < pixelCount) {
				const next = index + width;
				if (owners[next] === owner && !this.isComponentLabel(componentOf[next] as number)) {
					componentOf[next] = id;
					cellOrder[this.cellCount++] = next;
				}
			}
		}

		const end = this.cellCount;
		this.componentOwner[this.componentCount] = owner;
		this.componentStart[this.componentCount] = start;
		this.componentEnd[this.componentCount] = end;
		this.componentCount++;
	}

	/**
	 * Contact-weighted owner of the largest resolved neighbouring component.
	 * Adjacency is read from component boundary cells instead of a Map graph:
	 * that keeps one contact per shared pixel edge, and the unchanged
	 * component-order forward-scan fixpoint in `run` preserves the historic
	 * resolution order for the largest-border / lower-id tie-break.
	 */
	private chooseResolvedNeighbourTarget(componentIndex: number, owners: Uint16Array): number {
		const counts = this.contactCounts;
		counts.fill(0);
		const componentOf = this.componentOf;
		const cellOrder = this.cellOrder;
		const columnOf = this.columnOf;
		const width = this.width;
		const pixelCount = this.pixelCount;
		const resolved = this.resolved;
		const targetOwner = this.targetOwner;
		const start = this.componentStart[componentIndex] as number;
		const end = this.componentEnd[componentIndex] as number;
		const self = componentIndex + 1;

		for (let i = start; i < end; i++) {
			const index = cellOrder[i] as number;
			const x = columnOf[index] as number;
			if (x > 0) {
				const next = index - 1;
				if (owners[next] !== 0) {
					const otherId = componentOf[next] as number;
					if (otherId !== 0 && otherId !== self) {
						const other = otherId - 1;
						if (resolved[other]) {
							const owner = targetOwner[otherId] as number;
							if (owner > 0) counts[owner] = (counts[owner] as number) + 1;
						}
					}
				}
			}
			if (x + 1 < width) {
				const next = index + 1;
				if (owners[next] !== 0) {
					const otherId = componentOf[next] as number;
					if (otherId !== 0 && otherId !== self) {
						const other = otherId - 1;
						if (resolved[other]) {
							const owner = targetOwner[otherId] as number;
							if (owner > 0) counts[owner] = (counts[owner] as number) + 1;
						}
					}
				}
			}
			if (index >= width) {
				const next = index - width;
				if (owners[next] !== 0) {
					const otherId = componentOf[next] as number;
					if (otherId !== 0 && otherId !== self) {
						const other = otherId - 1;
						if (resolved[other]) {
							const owner = targetOwner[otherId] as number;
							if (owner > 0) counts[owner] = (counts[owner] as number) + 1;
						}
					}
				}
			}
			if (index + width < pixelCount) {
				const next = index + width;
				if (owners[next] !== 0) {
					const otherId = componentOf[next] as number;
					if (otherId !== 0 && otherId !== self) {
						const other = otherId - 1;
						if (resolved[other]) {
							const owner = targetOwner[otherId] as number;
							if (owner > 0) counts[owner] = (counts[owner] as number) + 1;
						}
					}
				}
			}
		}

		let bestOwner = 0;
		let bestCount = 0;
		for (let owner = 1; owner <= this.playerCount; owner++) {
			const count = counts[owner] as number;
			if (count === 0) continue;
			if (count > bestCount || (count === bestCount && (bestOwner === 0 || owner < bestOwner))) {
				bestOwner = owner;
				bestCount = count;
			}
		}
		return bestOwner;
	}
}
