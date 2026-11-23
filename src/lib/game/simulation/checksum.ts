/**
 * Deterministic FNV-1a checksum mixer and per-record mix helpers.
 *
 * The mixer and record field order are wire-visible: the checksum must stay
 * bit-identical for identical simulation state. Never reorder a record's
 * `mix` calls or change the per-byte folding below.
 */

import { STRUCTURE_TYPE_CODES, type Structure } from '../structures';
import type { AttackState, ArtilleryShell, NavalLanding } from './types';

export type ChecksumMix = (value: number) => void;

export interface ChecksumMixer {
	mix: ChecksumMix;
	/** Unsigned 32-bit digest of everything mixed so far. */
	digest(): number;
}

/** FNV-1a over the four bytes of each mixed integer, low byte first. */
export function createChecksumMixer(): ChecksumMixer {
	let hash = 0x811c9dc5;
	const mix = (value: number) => {
		hash ^= value & 0xff;
		hash = Math.imul(hash, 0x01000193);
		hash ^= (value >>> 8) & 0xff;
		hash = Math.imul(hash, 0x01000193);
		hash ^= (value >>> 16) & 0xff;
		hash = Math.imul(hash, 0x01000193);
		hash ^= (value >>> 24) & 0xff;
		hash = Math.imul(hash, 0x01000193);
	};
	return { mix, digest: () => hash >>> 0 };
}

export function mixNumbers(mix: ChecksumMix, values: ArrayLike<number>): void {
	for (let i = 0; i < values.length; i++) mix(values[i]);
}

export function mixStructureChecksum(
	mix: ChecksumMix,
	structure: Structure,
	readyAtTick: number
): void {
	mix(structure.id);
	mix(STRUCTURE_TYPE_CODES[structure.type]);
	mix(structure.ownerId);
	mix(structure.index);
	mix(structure.stacks);
	mix(readyAtTick);
}

export function mixShellChecksum(mix: ChecksumMix, shell: ArtilleryShell): void {
	mix(shell.id);
	mix(shell.ownerId);
	mix(shell.fromX);
	mix(shell.fromY);
	mix(shell.targetX);
	mix(shell.targetY);
	mix(shell.launchedAtTick);
	mix(shell.arriveAtTick);
}

export function mixNavalLandingChecksum(mix: ChecksumMix, landing: NavalLanding): void {
	mix(landing.id);
	mix(landing.ownerId);
	mix(landing.portId);
	mix(landing.targetIndex);
	mix(landing.launchedAtTick);
	mix(landing.arriveAtTick);
	mix(landing.path.length);
	for (const cell of landing.path) mix(cell);
}

export function mixAttackChecksum(mix: ChecksumMix, attack: AttackState, modeCode: number): void {
	mix(attack.id);
	mix(attack.attackerId);
	mix(attack.defenderId);
	mix(attack.targetX);
	mix(attack.targetY);
	mix(attack.anchorX);
	mix(attack.anchorY);
	mix(modeCode);
	mix(attack.createdAtTick);
	mix(attack.lifetimeTicks);
	mix(attack.orders);
	mix(attack.initialOrders);
	mix(attack.captures);
	attack.frontier.mixState(mix);
}
