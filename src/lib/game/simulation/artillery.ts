/**
 * Artillery shell mechanics: ready batteries, deterministic scatter, impact
 * target selection, and travel partitioning.
 *
 * Supply spending, cooldowns, events, and structure damage stay in the
 * simulation; these helpers take explicit state so the shell math is pure.
 */

import {
	ARTILLERY_BLAST_RADIUS,
	ARTILLERY_RANGE,
	ARTILLERY_SHELL_SPREAD,
	ARTILLERY_SHELL_TRAVEL_TICKS,
	ARTILLERY_TARGET_SNAP_RADIUS
} from '../constants';
import { hash32 } from '../map';
import type { Structure } from '../structures';
import type { ArtilleryShell } from './types';

export function artilleryReadyAt(
	structure: Structure,
	cooldownUntil: ReadonlyMap<number, number>
): number {
	return cooldownUntil.get(structure.id) ?? 0;
}

/** Ready batteries in range of a target, sorted by structure id. */
export function readyArtilleryBatteries(
	structures: readonly Structure[],
	cooldownUntil: ReadonlyMap<number, number>,
	tick: number,
	targetX: number,
	targetY: number
): Structure[] {
	const rangeSq = ARTILLERY_RANGE * ARTILLERY_RANGE;
	const batteries: Structure[] = [];
	for (const structure of structures) {
		if (structure.type !== 'artillery') continue;
		if (artilleryReadyAt(structure, cooldownUntil) > tick) continue;
		const dx = structure.x - targetX;
		const dy = structure.y - targetY;
		if (dx * dx + dy * dy > rangeSq) continue;
		batteries.push(structure);
	}
	batteries.sort((a, b) => a.id - b.id);
	return batteries;
}

/** Snap a click to a nearby hostile structure so artillery targeting stays usable. */
export function findArtillerySnapTarget(
	structures: readonly Structure[],
	playerId: number,
	areAllied: (a: number, b: number) => boolean,
	x: number,
	y: number
): { x: number; y: number } {
	if (ARTILLERY_TARGET_SNAP_RADIUS <= 0) return { x, y };
	const radiusSq = ARTILLERY_TARGET_SNAP_RADIUS * ARTILLERY_TARGET_SNAP_RADIUS;
	let best: Structure | null = null;
	let bestDistance = radiusSq + 1;
	for (const structure of structures) {
		if (structure.ownerId === playerId || areAllied(playerId, structure.ownerId)) {
			continue;
		}
		const dx = structure.x - x;
		const dy = structure.y - y;
		const distance = dx * dx + dy * dy;
		if (distance > radiusSq) continue;
		if (distance < bestDistance || (distance === bestDistance && structure.id < (best?.id ?? 0))) {
			best = structure;
			bestDistance = distance;
		}
	}
	return best ? { x: best.x, y: best.y } : { x, y };
}

export interface ArtilleryVolleyInput {
	seed: number;
	width: number;
	height: number;
	tick: number;
	ownerId: number;
	targetX: number;
	targetY: number;
	batteries: readonly Structure[];
	nextShellId: number;
}

export interface ArtilleryVolleyResult {
	shells: ArtilleryShell[];
	nextShellId: number;
}

/**
 * Expand a battery volley into individual shells. Scatter is deterministic per
 * `(seed, battery id, shell index)` and clamped to the map; there is no target
 * snapping beyond the already-resolved target.
 */
export function createArtilleryShells(input: ArtilleryVolleyInput): ArtilleryVolleyResult {
	const spread = ARTILLERY_SHELL_SPREAD * 2 + 1;
	const shells: ArtilleryShell[] = [];
	let nextShellId = input.nextShellId;
	for (const battery of input.batteries) {
		for (let shell = 0; shell < battery.stacks; shell++) {
			const hashX = hash32(input.seed ^ 0x9e3779b9, battery.id, shell);
			const hashY = hash32(input.seed ^ 0x85ebca6b, battery.id, shell);
			const targetX = Math.max(
				0,
				Math.min(input.width - 1, input.targetX + (hashX % spread) - ARTILLERY_SHELL_SPREAD)
			);
			const targetY = Math.max(
				0,
				Math.min(input.height - 1, input.targetY + (hashY % spread) - ARTILLERY_SHELL_SPREAD)
			);
			shells.push({
				id: nextShellId++,
				ownerId: input.ownerId,
				fromX: battery.x,
				fromY: battery.y,
				targetX,
				targetY,
				launchedAtTick: input.tick,
				arriveAtTick: input.tick + ARTILLERY_SHELL_TRAVEL_TICKS
			});
		}
	}
	return { shells, nextShellId };
}

/** Nearest non-State hostile structure within the blast radius, lower id on ties. */
export function findArtilleryImpactTarget(
	shell: ArtilleryShell,
	structures: readonly Structure[],
	areAllied: (a: number, b: number) => boolean
): Structure | null {
	const radiusSq = ARTILLERY_BLAST_RADIUS * ARTILLERY_BLAST_RADIUS;
	let target: Structure | null = null;
	let bestDistance = radiusSq + 1;
	for (const structure of structures) {
		if (structure.ownerId === shell.ownerId) continue;
		if (areAllied(shell.ownerId, structure.ownerId)) continue;
		if (structure.type === 'state') continue;
		const dx = structure.x - shell.targetX;
		const dy = structure.y - shell.targetY;
		const distance = dx * dx + dy * dy;
		if (distance > radiusSq) continue;
		if (
			distance < bestDistance ||
			(distance === bestDistance && structure.id < (target?.id ?? 0))
		) {
			target = structure;
			bestDistance = distance;
		}
	}
	return target;
}

/** Split shells into those arriving this tick and those still in flight. */
export function partitionDueArtilleryShells(
	shells: readonly ArtilleryShell[],
	tick: number
): { due: ArtilleryShell[]; remaining: ArtilleryShell[] } {
	const due: ArtilleryShell[] = [];
	const remaining: ArtilleryShell[] = [];
	for (const shell of shells) {
		if (tick < shell.arriveAtTick) remaining.push(shell);
		else due.push(shell);
	}
	return { due, remaining };
}
