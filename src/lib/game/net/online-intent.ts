import type { TerritorySimulation } from '../simulation';
import type { OnlineIntent } from './online-protocol';

export interface OnlineIntentApplication {
	ok: boolean;
	reason?: string;
	message: string;
}

/** Apply one accepted ledger intent to a simulation. */
export function applyOnlineIntent(
	sim: TerritorySimulation,
	playerId: number,
	intent: OnlineIntent
): OnlineIntentApplication {
	switch (intent.type) {
		case 'attack':
			return sim.enqueueAttack(playerId, intent.x, intent.y);
		case 'artillery':
			return sim.enqueueArtillery(playerId, intent.x, intent.y);
		case 'naval':
			return sim.enqueueNavalAttack(playerId, intent.x, intent.y);
		case 'build':
			return sim.playCard(
				playerId,
				intent.cardId,
				intent.x,
				intent.y,
				intent.newStructureOnly === true,
				intent.allowTightSpacing === true
			);
		case 'upgrade':
			return sim.upgradeDistrict(playerId, intent.x, intent.y, intent.levels, intent.merged);
		case 'demolish':
			return sim.demolishStructure(playerId, intent.structureId);
		case 'cancel-attack':
			return sim.cancelLatestAttack(playerId);
		case 'alliance-request':
			return sim.requestAlliance(playerId, intent.targetPlayerId);
		case 'alliance-break':
			return sim.breakAlliance(playerId, intent.targetPlayerId);
		default:
			return { ok: false, message: 'Unknown command.' };
	}
}
