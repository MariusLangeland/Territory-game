/**
 * Pure conversions from authoritative simulation records to public payloads.
 *
 * Render-only interpolation (`progress`) is derived from the current tick; it
 * is never checksummed. Keep these converters side-effect free so the worker,
 * local mirror, and tests can share the exact same shapes.
 */

import type { PublicStructure, Structure } from '../structures';
import type {
	ArtilleryShell,
	AttackState,
	NavalLanding,
	PublicArtilleryShell,
	PublicAttack,
	PublicNavalLanding
} from './types';

/** Encode an integer pixel array as interleaved [value, count] runs. */
export function encodeRle(values: Uint16Array | Uint32Array): Uint32Array {
	if (values.length === 0) return new Uint32Array(0);
	const runs: number[] = [];
	let value = values[0] ?? 0;
	let count = 0;
	for (let index = 0; index < values.length; index++) {
		const next = values[index] ?? 0;
		if (next !== value) {
			runs.push(value, count);
			value = next;
			count = 0;
		}
		count++;
	}
	runs.push(value, count);
	return Uint32Array.from(runs);
}

/** Decode [value, count] runs into a preallocated pixel array. */
export function decodeRle(encoded: Uint32Array, target: Uint16Array | Uint32Array): void {
	let offset = 0;
	for (let index = 0; index + 1 < encoded.length; index += 2) {
		const value = encoded[index] ?? 0;
		const count = encoded[index + 1] ?? 0;
		const end = Math.min(target.length, offset + count);
		target.fill(value, offset, end);
		offset = end;
		if (offset >= target.length) break;
	}
	if (offset < target.length) target.fill(0, offset);
}

export function toPublicAttack(attack: AttackState): PublicAttack {
	return {
		id: attack.id,
		attackerId: attack.attackerId,
		defenderId: attack.defenderId,
		targetX: attack.targetX,
		targetY: attack.targetY,
		orders: attack.orders,
		strength: attack.strength,
		initialStrength: attack.initialStrength,
		power: attack.power,
		pierce: attack.pierce,
		captures: attack.captures,
		growthMode: attack.growthMode
	};
}

export function toPublicStructure(structure: Structure, readyAtTick: number): PublicStructure {
	return {
		id: structure.id,
		type: structure.type,
		ownerId: structure.ownerId,
		x: structure.x,
		y: structure.y,
		stacks: structure.stacks,
		effects: structure.effects,
		readyAtTick
	};
}

export function toPublicNavalLanding(landing: NavalLanding, tick: number): PublicNavalLanding {
	const span = Math.max(1, landing.arriveAtTick - landing.launchedAtTick);
	const elapsed = Math.max(0, Math.min(span, tick - landing.launchedAtTick));
	const path = landing.path.filter(
		(_, index) => index % 8 === 0 || index === landing.path.length - 1
	);
	return { ...landing, path, progress: elapsed / span };
}

export function toPublicShell(shell: ArtilleryShell, tick: number): PublicArtilleryShell {
	const span = Math.max(1, shell.arriveAtTick - shell.launchedAtTick);
	const elapsed = Math.max(0, Math.min(span, tick - shell.launchedAtTick));
	return { ...shell, progress: elapsed / span };
}
