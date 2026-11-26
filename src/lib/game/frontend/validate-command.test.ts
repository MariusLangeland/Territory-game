import { describe, expect, it, vi } from 'vitest';
import type { WorkerLocalSimulation } from '../worker/local-simulation';
import { validateLocalCommand } from './validate-command';

function stubSim(overrides: Record<string, unknown> = {}): WorkerLocalSimulation {
	const snapshot = {
		supply: 100,
		tick: 10,
		players: [{ id: 1, name: 'SABLE', alive: true }],
		structures: [],
		attacks: [],
		alliances: [],
		allianceProposals: [],
		...overrides
	};
	return {
		humanPlayerId: 1,
		getSnapshot: () => snapshot,
		validateAttack: vi.fn(() => ({
			ok: false,
			reason: 'ocean',
			message: 'Cannot take ocean pixels.'
		})),
		validateArtillery: vi.fn(() => ({ ok: true, message: 'ok' })),
		validateBuild: vi.fn(() => ({ ok: true, message: 'ok' })),
		getUpgradeQuote: vi.fn(() => ({ ok: true, message: 'ok' })),
		resolveNavalTarget: vi.fn(() => null),
		getAttackStats: vi.fn(() => ({ cost: 30 })),
		getOwner: vi.fn(() => 0)
	} as unknown as WorkerLocalSimulation;
}

describe('local command validation', () => {
	it('discards an invalid attack without needing the ledger', () => {
		expect(validateLocalCommand(stubSim(), 'attack', { x: 2, y: 3 })).toMatchObject({
			ok: false,
			reason: 'ocean'
		});
	});

	it('passes tight-spacing build validation through', () => {
		const sim = stubSim();
		validateLocalCommand(sim, 'build', { cardId: 2, x: 4, y: 5, allowTightSpacing: true });
		expect(sim.validateBuild).toHaveBeenCalledWith(1, 2, 4, 5, true);
	});

	it('rejects demolishing a State structure locally', () => {
		const sim = stubSim({
			structures: [{ id: 7, ownerId: 1, type: 'state', x: 0, y: 0, stacks: 1, readyAtTick: 0 }]
		});
		expect(validateLocalCommand(sim, 'demolish', { structureId: 7 })).toMatchObject({
			ok: false,
			reason: 'state'
		});
	});
});
