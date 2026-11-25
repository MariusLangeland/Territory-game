import {
	TerritorySimulation,
	type SimulationOptions,
	type SimulationSnapshot,
	type StepResult
} from '../simulation';
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
	private snapshots: SimulationSnapshot[] = [];
	private readonly snapshotBytesByTick = new Map<number, number>();

	/** Replay keyframes are captured at this cadence while advancing. */
	static readonly SNAPSHOT_INTERVAL = 100;
	/** Total retained keyframe budget, in bytes. */
	static readonly SNAPSHOT_BUDGET_BYTES = 100 * 1024 * 1024;

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
		if (replay) this.captureSnapshot();
	}

	/**
	 * Capture the current authoritative tick as a replay keyframe. Ticks are
	 * unique: re-capturing an existing tick replaces that checkpoint.
	 */
	captureSnapshot(tick: number = this.simulation.tick): SimulationSnapshot {
		const snapshot = this.simulation.captureSnapshot(tick);
		const existing = this.snapshots.findIndex((entry) => entry.tick === tick);
		if (existing >= 0) this.snapshots[existing] = snapshot;
		else this.snapshots.push(snapshot);
		this.snapshots.sort((a, b) => a.tick - b.tick);
		this.snapshotBytesByTick.set(tick, estimateSnapshotBytes(snapshot.data));
		this.trimSnapshotsToBudget();
		return snapshot;
	}

	get snapshotBytes(): number {
		let total = 0;
		for (const snapshot of this.snapshots) {
			total += this.snapshotBytesByTick.get(snapshot.tick) ?? 0;
		}
		return total;
	}

	private trimSnapshotsToBudget(): void {
		let total = this.snapshotBytes;
		while (total > LedgerAgent.SNAPSHOT_BUDGET_BYTES && this.snapshots.length > 1) {
			// Preserve tick 0 for early seeks; evict the next-oldest checkpoint.
			const removeAt = this.snapshots[0]?.tick === 0 ? 1 : 0;
			const removed = this.snapshots.splice(removeAt, 1)[0];
			if (!removed) break;
			total -= this.snapshotBytesByTick.get(removed.tick) ?? 0;
			this.snapshotBytesByTick.delete(removed.tick);
		}
	}

	/** The closest stored keyframe at or before `tick`, without restoring it. */
	closestSnapshot(tick: number): SimulationSnapshot | null {
		let candidate: SimulationSnapshot | null = null;
		for (const snapshot of this.snapshots) {
			if (snapshot.tick > tick) break;
			candidate = snapshot;
		}
		return candidate;
	}

	/**
	 * Restore the closest keyframe at or before `tick` and return it. Returns
	 * null when no keyframe exists before the requested tick.
	 */
	restoreSnapshot(tick: number): SimulationSnapshot | null {
		const snapshot = this.closestSnapshot(tick);
		if (!snapshot) return null;
		this.simulation.restoreSnapshot(snapshot);
		this.replayIndex = this.replay
			? this.replayEntries.filter((entry) => entry.tick <= snapshot.tick).length
			: 0;
		this.lastReplayTick = snapshot.tick;
		return snapshot;
	}

	get snapshotTicks(): readonly number[] {
		return this.snapshots.map((snapshot) => snapshot.tick);
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
		const restored = this.restoreSnapshot(target);
		if (!restored) {
			this.simulation = new TerritorySimulation(JSON.parse(JSON.stringify(this.replay.options)));
			this.replayIndex = 0;
			this.lastReplayTick = 0;
		}
		while (this.simulation.tick < target && !this.simulation.ended) this.advance();
		this.captureSnapshot(this.simulation.tick);
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
		if (this.replay) {
			if (step.tick % LedgerAgent.SNAPSHOT_INTERVAL === 0 || this.replayComplete) {
				this.captureSnapshot(step.tick);
			}
			return { step, block: null };
		}
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

/** Approximate retained heap bytes for budget accounting. */
function estimateSnapshotBytes(value: unknown, seen = new Set<object>()): number {
	if (value === null || value === undefined) return 0;
	if (ArrayBuffer.isView(value)) return value.byteLength;
	if (typeof value === 'number') return 8;
	if (typeof value === 'boolean') return 4;
	if (typeof value === 'string') return value.length * 2;
	if (typeof value !== 'object') return 0;
	if (seen.has(value)) return 0;
	seen.add(value);
	if (Array.isArray(value)) {
		let total = 16;
		for (const entry of value) total += estimateSnapshotBytes(entry, seen);
		return total;
	}
	let total = 16;
	for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
		total += key.length * 2 + estimateSnapshotBytes(entry, seen);
	}
	return total;
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
