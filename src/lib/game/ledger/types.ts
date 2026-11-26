import type { OnlineIntent } from '../net/online-protocol';
import { decodeOnlineIntent } from './codec';

/**
 * Canonical ledger record. Remote and local sources both expose this shape; the
 * fields mirror the Spacetime `ledger_transactions` table so adapters stay thin.
 */
export interface LedgerRecord {
	rowIndex: bigint;
	tick: bigint;
	seatId: bigint;
	playerId: number;
	clientSequence: bigint;
	type: string;
	data: Uint8Array;
	status: string;
	createdAt: unknown;
}

export interface AcceptedTransaction {
	rowIndex: bigint;
	tick: number;
	playerId: number;
	intent: OnlineIntent;
}

export interface LedgerSubmitResult {
	ok: boolean;
	message: string;
}

export interface LedgerSource {
	readonly mode: 'local' | 'remote';
	readonly playerId: number;
	submitIntent(intent: OnlineIntent): Promise<LedgerSubmitResult>;
	subscribe(handler: (transaction: AcceptedTransaction) => void): () => void;
	onAvailability(handler: (available: boolean, message?: string) => void): () => void;
	dispose(): void;
}

export function acceptedTransactionFromRow(row: LedgerRecord): AcceptedTransaction | null {
	if (row.type === 'heartbeat') return null;
	const intent = decodeOnlineIntent(row.type, row.data);
	if (!intent) return null;
	return {
		rowIndex: row.rowIndex,
		tick: Number(row.tick),
		playerId: row.playerId,
		intent
	};
}
