/** Empty ledger rows are emitted when the coordinator has no client activity. */
export const HEARTBEAT_TRANSACTION_TYPE = 'heartbeat';

/** At 10 Hz this is one second without a client transaction. */
export const HEARTBEAT_INTERVAL_TICKS = 10;

/** A client treats the link as stale after two missed heartbeat windows. */
export const CLIENT_STALE_TICKS = HEARTBEAT_INTERVAL_TICKS * 2;

export interface HeartbeatTransaction {
	type: typeof HEARTBEAT_TRANSACTION_TYPE;
	tick: number;
}

export function heartbeatTransaction(tick: number): HeartbeatTransaction {
	return { type: HEARTBEAT_TRANSACTION_TYPE, tick };
}

export function isHeartbeatTransaction(transaction: { type: string }): boolean {
	return transaction.type === HEARTBEAT_TRANSACTION_TYPE;
}

/**
 * Heartbeats are themselves transactions, so they reset the idle window. The
 * coordinator calls this on its liveness pass with the last row tick.
 */
export function shouldSendHeartbeat(currentTick: number, lastTransactionTick: number): boolean {
	return currentTick - lastTransactionTick >= HEARTBEAT_INTERVAL_TICKS;
}

export function isLinkStale(currentTick: number, lastHeartbeatTick: number): boolean {
	return currentTick - lastHeartbeatTick >= CLIENT_STALE_TICKS;
}
