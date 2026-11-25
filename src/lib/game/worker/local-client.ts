import type { LedgerBlock } from '../ledger/agent';
import type {
	LocalWorkerCommand,
	LocalWorkerCommandType,
	LocalWorkerInit,
	LocalWorkerInitConfig,
	LocalWorkerInbound,
	LocalWorkerOutbound,
	LocalWorkerReplayControl,
	LocalWorkerReplayStatus,
	LocalWorkerTelemetry,
	LocalWorkerVisual
} from './local-protocol';

export interface LocalWorkerCommandPromiseResult {
	ok: boolean;
	reason?: string;
	message: string;
	ledgerBlock?: LedgerBlock | null;
	ledgerText?: string;
}

interface LocalWorkerHandlers {
	onInit: (init: LocalWorkerInit) => void;
	onVisual: (visual: LocalWorkerVisual) => void;
	onReplayStatus?: (status: LocalWorkerReplayStatus) => void;
	onTelemetry?: (telemetry: LocalWorkerTelemetry) => void;
	onError?: (error: Error) => void;
}

/**
 * Main-thread driver for the worker-owned local match. Commands are promises;
 * rendering is driven exclusively by worker visuals.
 */
export class LocalWorkerClient {
	private readonly worker: Worker;
	private readonly handlers: LocalWorkerHandlers;
	private nextCommandId = 1;
	private readonly pending = new Map<
		number,
		{ resolve: (result: LocalWorkerCommandPromiseResult) => void }
	>();
	private readonly latencyTimers = new Set<ReturnType<typeof setTimeout>>();
	private simulatedLatencyMs = 0;
	private disposed = false;

	constructor(init: LocalWorkerInitConfig, handlers: LocalWorkerHandlers) {
		this.handlers = handlers;
		this.worker = new Worker(new URL('./local-simulation.worker.ts', import.meta.url), {
			type: 'module'
		});
		this.worker.onmessage = (event: MessageEvent<LocalWorkerOutbound>) => {
			this.handleMessage(event.data);
		};
		this.worker.onerror = (event) => {
			handlers.onError?.(new Error(event.message || 'Simulation worker failed.'));
		};
		const message: LocalWorkerInbound = { type: 'init', config: init };
		this.worker.postMessage(message);
	}

	/** Simulated one-way latency is half the configured round trip. */
	setSimulatedLatency(roundTripMs: number): void {
		this.simulatedLatencyMs = Math.max(0, Math.round(roundTripMs));
	}

	private later(action: () => void, delayMs: number): void {
		if (delayMs <= 0) {
			if (!this.disposed) action();
			return;
		}
		const timer = setTimeout(() => {
			this.latencyTimers.delete(timer);
			if (!this.disposed) action();
		}, delayMs);
		this.latencyTimers.add(timer);
	}

	private handleMessage(message: LocalWorkerOutbound): void {
		if (this.disposed) return;
		if (message.type === 'init') {
			this.handlers.onInit(message);
			return;
		}
		if (message.type === 'visual') {
			this.later(() => this.handlers.onVisual(message), this.simulatedLatencyMs / 2);
			return;
		}
		if (message.type === 'replay-status') {
			this.handlers.onReplayStatus?.(message);
			return;
		}
		if (message.type === 'telemetry') {
			this.handlers.onTelemetry?.(message);
			return;
		}
		if (message.type === 'paused') return;
		if (message.type === 'command-result') {
			const pending = this.pending.get(message.id);
			if (!pending) return;
			this.later(() => {
				this.pending.delete(message.id);
				pending.resolve({
					ok: message.ok,
					reason: message.reason,
					message: message.message,
					ledgerBlock: message.ledgerBlock,
					ledgerText: message.ledgerText
				});
			}, this.simulatedLatencyMs / 2);
		}
	}

	command(
		type: LocalWorkerCommandType,
		args: Omit<LocalWorkerCommand['command'], 'type'> = {}
	): Promise<LocalWorkerCommandPromiseResult> {
		if (this.disposed) {
			return Promise.resolve({ ok: false, message: 'Match worker is disposed.' });
		}
		const id = this.nextCommandId++;
		return new Promise((resolve) => {
			this.pending.set(id, { resolve });
			const message: LocalWorkerCommand = {
				type: 'command',
				id,
				command: { type, ...args }
			};
			this.later(() => this.worker.postMessage(message), this.simulatedLatencyMs / 2);
		});
	}

	replayControl(control: Omit<LocalWorkerReplayControl, 'type'>): void {
		this.worker.postMessage({ type: 'replay-control', ...control } satisfies LocalWorkerInbound);
	}

	pause(): void {
		this.worker.postMessage({ type: 'pause' } satisfies LocalWorkerInbound);
	}

	resume(): void {
		this.worker.postMessage({ type: 'resume' } satisfies LocalWorkerInbound);
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		for (const timer of this.latencyTimers) clearTimeout(timer);
		this.latencyTimers.clear();
		for (const pending of this.pending.values()) {
			pending.resolve({ ok: false, message: 'Match worker stopped.' });
		}
		this.pending.clear();
		this.worker.terminate();
	}
}
