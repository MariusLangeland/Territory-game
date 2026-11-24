import { TerritorySimulation, type SimulationOptions } from '../simulation';
import { applyOnlineIntent, type OnlineIntentApplication } from './online-intent';
import type { OnlineIntent } from './online-protocol';

export const MATCH_LEDGER_VERSION = 1;

/**
 * One accepted player move. `tick` is the tick during which the command is
 * applied (the next `step()`), matching the authoritative room.
 */
export interface MatchLedgerEntry {
	tick: number;
	playerId: number;
	intent: OnlineIntent;
}

export interface MatchLedger {
	version: typeof MATCH_LEDGER_VERSION;
	options: SimulationOptions;
	entries: MatchLedgerEntry[];
	/** Last authoritative tick recorded in this ledger. */
	finalTick: number | null;
	/** Last tick with an authoritative checksum sample. */
	checksumTick: number | null;
	/** Checksum sampled at `checksumTick`, when available. */
	finalChecksum: number | null;
}

export interface MatchLedgerReplay {
	simulation: TerritorySimulation;
	tick: number;
	checksum: number;
	expectedChecksum: number | null;
	matches: boolean;
	applied: number;
	rejected: Array<{ entry: MatchLedgerEntry; result: OnlineIntentApplication }>;
}

/** Create an empty ledger from the exact simulation options used to start a match. */
export function createMatchLedger(options: SimulationOptions): MatchLedger {
	return {
		version: MATCH_LEDGER_VERSION,
		options: JSON.parse(JSON.stringify(options)) as SimulationOptions,
		entries: [],
		finalTick: null,
		checksumTick: null,
		finalChecksum: null
	};
}

/**
 * Record a move that the authoritative simulation accepted. The caller must
 * only pass accepted intents; rejected intents have no state effect and would
 * make the ledger dishonest.
 */
export function recordMatchLedgerEntry(
	ledger: MatchLedger,
	tick: number,
	playerId: number,
	intent: OnlineIntent
): MatchLedgerEntry {
	if (!Number.isSafeInteger(tick) || tick < 0) {
		throw new Error('Ledger tick must be a non-negative integer.');
	}
	const previous = ledger.entries.at(-1);
	if (previous && tick < previous.tick) {
		throw new Error('Ledger entries must be recorded in tick order.');
	}
	const entry: MatchLedgerEntry = { tick, playerId, intent };
	ledger.entries.push(entry);
	return entry;
}

/**
 * Replay a ledger from its seed/config through `targetTick`. Bots are not
 * recorded: they are deterministic functions of the seed, config, and prior
 * moves, so they regenerate identically.
 */
export function replayMatchLedger(
	ledger: MatchLedger,
	targetTick: number | null = ledger.finalTick
): MatchLedgerReplay {
	if (ledger.version !== MATCH_LEDGER_VERSION) {
		throw new Error(`Unsupported ledger version: ${String(ledger.version)}.`);
	}
	const target = Math.max(0, Math.trunc(targetTick ?? 0));
	const simulation = new TerritorySimulation(JSON.parse(JSON.stringify(ledger.options)));
	const entries = ledger.entries
		.map((entry, order) => ({ entry, order }))
		.sort((a, b) => a.entry.tick - b.entry.tick || a.order - b.order)
		.map(({ entry }) => entry);
	let index = 0;
	let applied = 0;
	const rejected: MatchLedgerReplay['rejected'] = [];

	while (!simulation.ended && simulation.tick < target) {
		const nextTick = simulation.tick + 1;
		while (index < entries.length && (entries[index]?.tick ?? Infinity) < nextTick) {
			index++;
		}
		while (index < entries.length && entries[index]?.tick === nextTick) {
			const entry = entries[index];
			if (!entry) break;
			const result = applyOnlineIntent(simulation, entry.playerId, entry.intent);
			if (result.ok) applied++;
			else rejected.push({ entry, result });
			index++;
		}
		simulation.step();
	}

	const checksum = simulation.checksum();
	const expectedChecksum =
		target === ledger.checksumTick && ledger.finalChecksum !== null ? ledger.finalChecksum : null;
	return {
		simulation,
		tick: simulation.tick,
		checksum,
		expectedChecksum,
		matches: expectedChecksum === null || expectedChecksum === checksum,
		applied,
		rejected
	};
}

/** Compact JSON form; the move list dominates and compresses well. */
export function encodeMatchLedger(ledger: MatchLedger): string {
	return JSON.stringify(ledger);
}

export function decodeMatchLedger(encoded: string): MatchLedger {
	const root = JSON.parse(encoded) as Partial<MatchLedger> & { ledger?: Partial<MatchLedger> };
	// Accept both a bare ledger and the inspection/download wrapper
	// { ledger, blocks, openBlock } produced by LedgerAgent.exportText().
	const parsed =
		root.ledger && typeof root.ledger === 'object' ? root.ledger : (root as Partial<MatchLedger>);
	if (parsed.version !== MATCH_LEDGER_VERSION) {
		throw new Error(`Unsupported ledger version: ${String(parsed.version)}.`);
	}
	if (!parsed.options || typeof parsed.options !== 'object') {
		throw new Error('Ledger is missing simulation options.');
	}
	if (!Array.isArray(parsed.entries)) throw new Error('Ledger is missing entries.');
	return {
		version: MATCH_LEDGER_VERSION,
		options: parsed.options,
		entries: parsed.entries,
		finalTick: typeof parsed.finalTick === 'number' ? parsed.finalTick : null,
		checksumTick: typeof parsed.checksumTick === 'number' ? parsed.checksumTick : null,
		finalChecksum: typeof parsed.finalChecksum === 'number' ? parsed.finalChecksum : null
	};
}
