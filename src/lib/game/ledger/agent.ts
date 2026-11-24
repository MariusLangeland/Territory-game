import { TerritorySimulation, type SimulationOptions, type StepResult } from '../simulation';
import {
	createMatchLedger,
	recordMatchLedgerEntry,
	type MatchLedger,
	type MatchLedgerEntry
} from '../net/match-ledger';
import { applyOnlineIntent } from '../net/online-intent';
import type { OnlineIntent } from '../net/online-protocol';

/**
 * One ordered block in the ledger chain. A block may be open (checksum null)
 * while transactions for the target tick are still being accepted; advance()
 * seals it with the post-step simulation checksum.
 */
export interface LedgerBlock {
	index: number;
	tick: number;
	previousChecksum: number;
	transactions: MatchLedgerEntry[];
	checksum: number | null;
}

export interface LedgerSubmitResult {
	ok: boolean;
	reason?: string;
	message: string;
	/** Open block containing the accepted transaction. */
	block?: LedgerBlock;
}

export interface LedgerAdvanceResult {
	step: StepResult;
	/** Sealed block for this tick, if transactions were accepted. */
	block: LedgerBlock | null;
}

/**
 * Sole authoritative writer for the local offline ledger. All mutations enter
 * through submit(); the simulation is a derived cache of the ledger chain.
 */
export class LedgerAgent {
	simulation: TerritorySimulation;
	readonly ledger: MatchLedger;
	private readonly blocks: LedgerBlock[] = [];
	private openBlock: LedgerBlock | null = null;
	private readonly replay: MatchLedger | null;
	private readonly replayEntries: MatchLedgerEntry[];
	private readonly replayTargetTick: number;
	private replayIndex = 0;
	private lastReplayTick = 0;

	constructor(options: SimulationOptions, replay: MatchLedger | null = null) {
		this.replay = replay;
		const source = replay?.options ?? options;
		this.simulation = new TerritorySimulation(JSON.parse(JSON.stringify(source)));
		if (replay) {
			this.ledger = replay;
			this.replayEntries = [...replay.entries].sort((a, b) => a.tick - b.tick);
			this.replayTargetTick =
				replay.finalTick ?? this.replayEntries.at(-1)?.tick ?? this.simulation.tick;
		} else {
			this.ledger = createMatchLedger(options);
			this.ledger.finalTick = this.simulation.tick;
			this.ledger.checksumTick = this.simulation.tick;
			this.ledger.finalChecksum = this.simulation.checksum();
			this.replayEntries = [];
			this.replayTargetTick = 0;
		}
	}

	get replayComplete(): boolean {
		return (
			this.replay !== null &&
			this.replayIndex >= this.replayEntries.length &&
			this.lastReplayTick >= this.replayTargetTick
		);
	}

	get replayChecksumMatches(): boolean | null {
		if (!this.replayComplete || !this.replay) return null;
		if (this.replay.checksumTick !== this.replayTargetTick) return null;
		return this.replay.finalChecksum === this.simulation.checksum();
	}

	get tick(): number {
		return this.simulation.tick;
	}

	get ended(): boolean {
		return this.simulation.ended;
	}

	get openBlockView(): LedgerBlock | null {
		return this.openBlock ? cloneBlock(this.openBlock) : null;
	}

	get blocksView(): LedgerBlock[] {
		return this.blocks.map(cloneBlock);
	}

	get ledgerView(): MatchLedger {
		return JSON.parse(JSON.stringify(this.ledger)) as MatchLedger;
	}

	/**
	 * Rebuild replay state at `tick`. Replays from the seed/config; the replay
	 * worker currently has no snapshot keyframes, so long seeks are O(tick).
	 */
	seek(tick: number): void {
		if (!this.replay) throw new Error('Seek is only available in replay mode.');
		const target = Math.max(0, Math.min(this.replayTargetTick, Math.trunc(tick)));
		this.simulation = new TerritorySimulation(JSON.parse(JSON.stringify(this.replay.options)));
		this.replayIndex = 0;
		this.lastReplayTick = 0;
		while (this.simulation.tick < target && !this.simulation.ended) this.advance();
	}

	/** Pretty plain-text ledger plus block chain for inspection/export. */
	exportText(): string {
		return JSON.stringify(
			{
				ledger: this.ledgerView,
				blocks: this.blocksView,
				openBlock: this.openBlockView
			},
			null,
			2
		);
	}

	/** Sample the current checksum into the ledger tip for replay verification. */
	sampleChecksum(): number {
		const checksum = this.simulation.checksum();
		this.ledger.finalTick = this.simulation.tick;
		this.ledger.checksumTick = this.simulation.tick;
		this.ledger.finalChecksum = checksum;
		return checksum;
	}

	/** Validate and append one player transaction for the next tick. */
	submit(playerId: number, intent: OnlineIntent): LedgerSubmitResult {
		if (this.replay) {
			return { ok: false, reason: 'read-only', message: 'Ledger replay is read-only.' };
		}
		if (this.simulation.ended) {
			return { ok: false, reason: 'ended', message: 'The conflict is over.' };
		}
		const result = applyOnlineIntent(this.simulation, playerId, intent);
		if (!result.ok) return result;
		const targetTick = this.simulation.tick + 1;
		const entry = recordMatchLedgerEntry(this.ledger, targetTick, playerId, intent);
		if (!this.openBlock || this.openBlock.tick !== targetTick) {
			this.openBlock = {
				index: this.blocks.length,
				tick: targetTick,
				previousChecksum: this.previousChecksum(),
				transactions: [],
				checksum: null
			};
		}
		this.openBlock.transactions.push(entry);
		return { ...result, block: cloneBlock(this.openBlock) };
	}

	/** Advance the authoritative simulation exactly one tick and seal the open block. */
	advance(): LedgerAdvanceResult {
		if (this.simulation.ended) {
			return {
				step: {
					tick: this.simulation.tick,
					events: [],
					changes: new Uint32Array(),
					changeCount: 0,
					changesOverflow: false,
					districtsChanged: false,
					districtTiles: [],
					snapshot: this.simulation.getSnapshot()
				},
				block: null
			};
		}
		if (this.replay) this.applyReplayEntries(this.simulation.tick + 1);
		const block = this.openBlock;
		this.openBlock = null;
		const step = this.simulation.step();
		this.lastReplayTick = step.tick;
		if (this.replay) return { step, block: null };
		this.ledger.finalTick = step.tick;
		if (block) {
			block.checksum = this.simulation.checksum();
			this.blocks.push(block);
			this.ledger.checksumTick = step.tick;
			this.ledger.finalChecksum = block.checksum;
		}
		return { step, block: block ? cloneBlock(block) : null };
	}

	private applyReplayEntries(tick: number): void {
		while (this.replayIndex < this.replayEntries.length) {
			const entry = this.replayEntries[this.replayIndex];
			if (!entry || entry.tick > tick) break;
			if (entry.tick === tick) applyOnlineIntent(this.simulation, entry.playerId, entry.intent);
			this.replayIndex++;
		}
	}

	private previousChecksum(): number {
		const last = this.blocks.at(-1);
		if (
			last?.checksum !== null &&
			last?.checksum !== undefined &&
			last.tick === this.simulation.tick
		) {
			return last.checksum;
		}
		return this.simulation.checksum();
	}
}

function cloneBlock(block: LedgerBlock): LedgerBlock {
	return {
		index: block.index,
		tick: block.tick,
		previousChecksum: block.previousChecksum,
		transactions: block.transactions.map((entry) => ({
			tick: entry.tick,
			playerId: entry.playerId,
			intent: JSON.parse(JSON.stringify(entry.intent)) as OnlineIntent
		})),
		checksum: block.checksum
	};
}
