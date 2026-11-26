import type { DbConnection } from '#lib/spacetime/module_bindings';
import type { OnlineIntent } from '../net/online-protocol';
import { encodeOnlineIntent } from './codec';
import {
	acceptedTransactionFromRow,
	type AcceptedTransaction,
	type LedgerRecord,
	type LedgerSource,
	type LedgerSubmitResult
} from './types';

type TransactionListener = (transaction: AcceptedTransaction) => void;
type AvailabilityListener = (available: boolean, message?: string) => void;

/**
 * Remote ledger adapter over the Spacetime `ledger_transactions` table. The
 * table row is the canonical record; `data` is only decoded when handing an
 * accepted intent to the view layer.
 */
export class SpacetimeLedgerSource implements LedgerSource {
	readonly mode = 'remote' as const;
	playerId: number;
	private readonly listeners = new Set<TransactionListener>();
	private readonly availabilityListeners = new Set<AvailabilityListener>();
	private readonly onRow: (row: LedgerRecord) => void;
	private readonly onDisconnect: (message?: string) => void;
	private clientSequence = 0n;
	private lastRowIndex = 0n;
	private disposed = false;

	constructor(
		private readonly connection: DbConnection,
		playerId: number
	) {
		this.playerId = playerId;
		this.onDisconnect = (message) => {
			for (const listener of this.availabilityListeners) listener(false, message);
		};
		this.onRow = (row) => {
			if (row.rowIndex <= this.lastRowIndex) return;
			this.lastRowIndex = row.rowIndex;
			const transaction = acceptedTransactionFromRow(row);
			if (!transaction) return;
			for (const listener of this.listeners) listener(transaction);
		};
		connection.db.ledgerTransactions.onInsert((_ctx, row) => this.onRow(row));
	}

	subscribe(handler: TransactionListener): () => void {
		this.listeners.add(handler);
		return () => this.listeners.delete(handler);
	}

	onAvailability(handler: AvailabilityListener): () => void {
		this.availabilityListeners.add(handler);
		return () => this.availabilityListeners.delete(handler);
	}

	async submitIntent(intent: OnlineIntent): Promise<LedgerSubmitResult> {
		if (this.disposed) return { ok: false, message: 'Ledger is disconnected.' };
		try {
			await this.connection.reducers.submitTransaction({
				clientSequence: ++this.clientSequence,
				type: intent.type,
				data: encodeOnlineIntent(intent)
			});
			return { ok: true, message: 'Transaction submitted.' };
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Transaction submission failed.';
			this.onDisconnect(message);
			return { ok: false, message };
		}
	}

	/** Called by the room session when its sockets become available/unavailable. */
	setAvailable(available: boolean, message?: string): void {
		if (available) {
			for (const listener of this.availabilityListeners) listener(true);
		} else {
			this.onDisconnect(message);
		}
	}

	dispose(): void {
		this.disposed = true;
		this.listeners.clear();
		this.availabilityListeners.clear();
	}
}
