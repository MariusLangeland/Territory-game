import type { OnlineIntent } from '../net/online-protocol';
import type { LocalWorkerCommand } from './local-protocol';

/** Shared mapping between the UI command shape and the authoritative intent. */
export function workerCommandToIntent(command: LocalWorkerCommand['command']): OnlineIntent {
	switch (command.type) {
		case 'attack':
			return { type: 'attack', x: command.x ?? 0, y: command.y ?? 0 };
		case 'artillery':
			return { type: 'artillery', x: command.x ?? 0, y: command.y ?? 0 };
		case 'naval':
			return { type: 'naval', x: command.x ?? 0, y: command.y ?? 0 };
		case 'build':
			return {
				type: 'build',
				cardId: command.cardId ?? 0,
				x: command.x ?? 0,
				y: command.y ?? 0,
				newStructureOnly: command.newStructureOnly === true,
				allowTightSpacing: command.allowTightSpacing === true
			};
		case 'upgrade':
			return {
				type: 'upgrade',
				x: command.x ?? 0,
				y: command.y ?? 0,
				levels: command.levels ?? 1,
				merged: command.merged ?? true
			};
		case 'demolish':
			return { type: 'demolish', structureId: command.structureId ?? 0 };
		case 'cancel-attack':
			return { type: 'cancel-attack' };
		case 'alliance-request':
			return { type: 'alliance-request', targetPlayerId: command.targetPlayerId ?? 0 };
		case 'alliance-break':
			return { type: 'alliance-break', targetPlayerId: command.targetPlayerId ?? 0 };
		case 'ledger':
			throw new Error('Ledger export is not a gameplay transaction.');
	}
}
