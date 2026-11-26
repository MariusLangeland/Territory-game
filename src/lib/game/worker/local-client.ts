import type { OnlineIntent } from '../net/online-protocol';
import type {
	LocalWorkerCommand,
	LocalWorkerCommandType,
	LocalWorkerInit,
	LocalWorkerInitConfig,
	LocalWorkerInbound,
	LocalWorkerOutbound,
	LocalWorkerTelemetry,
	LocalWorkerVisual
} from './local-protocol';

export interface LocalWorkerCommandPromiseResult {
	ok: boolean;
	reason?: string;
	message: string;
}

interface LocalWorkerHandlers {
	onInit: (init: LocalWorkerInit) => void;
	onVisual: (visual: LocalWorkerVisual) => void;
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

	private handleMessage(message: LocalWorkerOutbound): void {
		if (this.disposed) return;
		if (message.type === 'init') {
			this.handlers.onInit(message);
			return;
		}
		if (message.type === 'visual') {
			this.handlers.onVisual(message);
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
			this.pending.delete(message.id);
			pending.resolve({
				ok: message.ok,
				reason: message.reason,
				message: message.message
			});
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
			this.worker.postMessage(message);
		});
	}

	applyIntent(tick: number, playerId: number, intent: OnlineIntent): void {
		if (this.disposed) return;
		this.worker.postMessage({
			type: 'apply-intent',
			tick,
			playerId,
			intent
		} satisfies LocalWorkerInbound);
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
		for (const pending of this.pending.values()) {
			pending.resolve({ ok: false, message: 'Match worker stopped.' });
		}
		this.pending.clear();
		this.worker.terminate();
	}
}
