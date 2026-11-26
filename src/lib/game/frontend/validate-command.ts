import { ARTILLERY_SUPPLY_COST_PER_LEVEL } from '../constants';
import { STRUCTURE_DEFINITIONS } from '../structures';
import type { WorkerLocalSimulation } from '../worker/local-simulation';
import type { LocalWorkerCommandType } from '../worker/local-protocol';

/**
 * Reject illegal player commands before they reach the ledger. The local
 * simulation is the deterministic rule source; a command that would be a no-op
 * locally should never become a server row.
 */
export function validateLocalCommand(
	sim: WorkerLocalSimulation,
	type: LocalWorkerCommandType,
	args: Parameters<WorkerLocalSimulation['command']>[1] = {}
): { ok: boolean; reason?: string; message: string } {
	const snapshot = sim.getSnapshot();
	const playerId = sim.humanPlayerId;

	switch (type) {
		case 'attack':
			return sim.validateAttack(playerId, args.x ?? 0, args.y ?? 0);
		case 'artillery': {
			const validation = sim.validateArtillery(playerId, args.x ?? 0, args.y ?? 0);
			if (!validation.ok) return validation;
			const shells = snapshot.structures
				.filter(
					(structure) =>
						structure.ownerId === playerId &&
						structure.type === 'artillery' &&
						structure.readyAtTick <= snapshot.tick
				)
				.reduce((total, structure) => total + structure.stacks, 0);
			const cost = shells * ARTILLERY_SUPPLY_COST_PER_LEVEL;
			return snapshot.supply >= cost
				? validation
				: {
						ok: false,
						reason: 'no-gold',
						message: `Need ${cost} supply to fire this volley.`
					};
		}
		case 'naval': {
			const target = sim.resolveNavalTarget(playerId, args.x ?? 0, args.y ?? 0);
			if (!target) {
				return {
					ok: false,
					reason: 'invalid-target',
					message: 'Naval landings target a shore within 32 px.'
				};
			}
			if (
				!snapshot.structures.some(
					(structure) => structure.ownerId === playerId && structure.type === 'port'
				)
			) {
				return { ok: false, reason: 'no-port', message: 'Build a Port first.' };
			}
			const owner = snapshot.players.find(
				(player) => player.id === sim.getOwner(target.x, target.y)
			);
			const cost =
				sim.getAttackStats(playerId, owner?.id ?? 0).cost + STRUCTURE_DEFINITIONS.port.cost;
			return snapshot.supply >= cost
				? { ok: true, message: 'Naval landing ordered.' }
				: {
						ok: false,
						reason: 'no-gold',
						message: `Need ${cost} supply for the landing and Port.`
					};
		}
		case 'build':
			return sim.validateBuild(
				playerId,
				args.cardId ?? 0,
				args.x ?? 0,
				args.y ?? 0,
				args.allowTightSpacing === true
			);
		case 'upgrade': {
			const quote = sim.getUpgradeQuote(
				playerId,
				args.x ?? 0,
				args.y ?? 0,
				args.levels ?? 1,
				args.merged ?? true
			);
			return { ok: quote.ok, reason: quote.reason, message: quote.message };
		}
		case 'demolish': {
			const structure = snapshot.structures.find((entry) => entry.id === args.structureId);
			if (!structure) {
				return { ok: false, reason: 'missing', message: 'That structure is no longer here.' };
			}
			if (structure.ownerId !== playerId) {
				return {
					ok: false,
					reason: 'not-owned',
					message: 'You can only demolish your own structures.'
				};
			}
			if (structure.type === 'state') {
				return { ok: false, reason: 'state', message: 'State structures cannot be demolished.' };
			}
			return { ok: true, message: 'Structure queued for demolition.' };
		}
		case 'cancel-attack':
			return snapshot.attacks.some((attack) => attack.attackerId === playerId)
				? { ok: true, message: 'Front cancellation queued.' }
				: { ok: false, reason: 'no-fronts', message: 'No active fronts to cancel.' };
		case 'alliance-request': {
			const target = snapshot.players.find((player) => player.id === args.targetPlayerId);
			if (!target || target.id === playerId || !target.alive) {
				return { ok: false, reason: 'invalid-target', message: 'Invalid alliance target.' };
			}
			const busy = snapshot.alliances.some(
				(alliance) =>
					alliance.playerA === playerId ||
					alliance.playerB === playerId ||
					alliance.playerA === target.id ||
					alliance.playerB === target.id
			);
			const pending = snapshot.allianceProposals.some(
				(proposal) =>
					proposal.fromPlayerId === playerId ||
					proposal.toPlayerId === playerId ||
					proposal.fromPlayerId === target.id ||
					proposal.toPlayerId === target.id
			);
			return busy || pending
				? { ok: false, reason: 'busy', message: 'Alliance request already pending or active.' }
				: { ok: true, message: `Alliance request sent to ${target.name}.` };
		}
		case 'alliance-break':
			return snapshot.alliances.some(
				(alliance) =>
					(alliance.playerA === playerId && alliance.playerB === args.targetPlayerId) ||
					(alliance.playerB === playerId && alliance.playerA === args.targetPlayerId)
			)
				? { ok: true, message: 'Alliance broken.' }
				: { ok: false, reason: 'not-allied', message: 'You are not allied with that state.' };
	}
}
