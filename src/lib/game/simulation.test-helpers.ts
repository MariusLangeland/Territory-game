import type { AttackState, TerritorySimulation } from './simulation';
import type { BuildableStructureType } from './structures';

/**
 * Fixtures shared by the split simulation suites. Kept out of the suite files
 * (and outside Vitest's `*.test.ts` include glob) so every suite can import
 * them without registering tests of its own.
 */

export function findAttackablePixel(
	sim: TerritorySimulation,
	playerId: number
): { x: number; y: number } | null {
	const start = sim.map.starts[playerId - 1];
	for (let radius = 1; radius < 80; radius++) {
		for (let dy = -radius; dy <= radius; dy++) {
			for (let dx = -radius; dx <= radius; dx++) {
				if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
				const x = start.x + dx;
				const y = start.y + dy;
				if (!sim.isLand(x, y)) continue;
				if (sim.getOwner(x, y) !== 0) continue;
				if (sim.validateAttack(playerId, x, y).ok) return { x, y };
			}
		}
	}
	return null;
}

export type BotDefenseInternals = {
	botThreat: Uint16Array;
	botDefensive: Uint8Array;
	botReserve: Uint8Array;
	botDefenseStall: Uint8Array;
	botGold: number[];
	botGrievance: Uint16Array;
	botAttackers: Uint8Array;
	botProfiles: Array<{ buildPlan: BuildableStructureType[] }>;
	attacks: AttackState[];
	scoreBotTarget(
		attackerId: number,
		profile: Record<string, unknown>,
		defenderId: number,
		selfStrength: number,
		strengths: Uint32Array
	): { score: number; opportunity: boolean };
};
