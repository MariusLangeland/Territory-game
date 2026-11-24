import type { LedgerBlock } from './agent';
import type { MatchLedger } from '../net/match-ledger';
import { decodeMatchLedger } from '../net/match-ledger';

export interface LedgerDocument {
	ledger: MatchLedger;
	blocks: LedgerBlock[];
	openBlock: LedgerBlock | null;
}

/**
 * Decode a downloaded ledger file. Accepts both the inspection wrapper
 * `{ ledger, blocks, openBlock }` and a bare `MatchLedger`. Bare ledgers get
 * synthesized block anchors so the viewer still has navigable ticks.
 */
export function decodeLedgerDocument(encoded: string): LedgerDocument {
	const ledger = decodeMatchLedger(encoded);
	const root = JSON.parse(encoded) as {
		blocks?: unknown;
		openBlock?: unknown;
	};
	const blocks = Array.isArray(root.blocks)
		? (root.blocks as LedgerBlock[]).filter(isLedgerBlock)
		: synthesizeBlocks(ledger);
	const openBlock = isLedgerBlock(root.openBlock) ? root.openBlock : null;
	return { ledger, blocks, openBlock };
}

function isLedgerBlock(value: unknown): value is LedgerBlock {
	if (!value || typeof value !== 'object') return false;
	const candidate = value as Partial<LedgerBlock>;
	return (
		Number.isSafeInteger(candidate.index) &&
		Number.isSafeInteger(candidate.tick) &&
		Array.isArray(candidate.transactions)
	);
}

function synthesizeBlocks(ledger: MatchLedger): LedgerBlock[] {
	const byTick = new Map<number, LedgerBlock>();
	for (const entry of ledger.entries) {
		const existing = byTick.get(entry.tick);
		if (existing) {
			existing.transactions.push(entry);
			continue;
		}
		byTick.set(entry.tick, {
			index: byTick.size,
			tick: entry.tick,
			previousChecksum: 0,
			transactions: [entry],
			checksum: null
		});
	}
	return [...byTick.values()].sort((a, b) => a.tick - b.tick);
}
