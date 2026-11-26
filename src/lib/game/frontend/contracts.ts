import type { LocalWorkerCommandType } from '../worker/local-protocol';

/** Command result consumed by the frontend; transport/ledger details stay below. */
export interface MatchCommandResult {
	ok: boolean;
	reason?: string;
	message: string;
}

export interface MatchCommandArgs {
	x?: number;
	y?: number;
	cardId?: number;
	levels?: number;
	merged?: boolean;
	newStructureOnly?: boolean;
	allowTightSpacing?: boolean;
	structureId?: number;
	targetPlayerId?: number;
}

/**
 * Frontend-facing input boundary. The current implementation maps commands to
 * either the local worker or the remote Spacetime ledger.
 */
export interface MatchCommandGateway {
	command(type: LocalWorkerCommandType, args?: MatchCommandArgs): Promise<MatchCommandResult>;
}
