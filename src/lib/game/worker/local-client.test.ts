import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalWorkerClient } from './local-client';
import type { LocalWorkerOutbound } from './local-protocol';

class FakeWorker {
	static last: FakeWorker | null = null;

	onmessage: ((event: MessageEvent) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	posted: unknown[] = [];
	terminated = false;

	constructor() {
		FakeWorker.last = this;
	}

	postMessage(message: unknown): void {
		this.posted.push(message);
	}

	terminate(): void {
		this.terminated = true;
	}

	receive(message: LocalWorkerOutbound): void {
		this.onmessage?.({ data: message } as MessageEvent);
	}
}

describe('LocalWorkerClient simulated latency', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.stubGlobal('Worker', FakeWorker);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
		FakeWorker.last = null;
	});

	it('delivers visuals after the downlink half of the round trip', () => {
		const onInit = vi.fn();
		const onVisual = vi.fn();
		const client = new LocalWorkerClient(
			{
				seed: 1,
				width: 512,
				height: 256,
				playerCount: 8,
				growthMode: 'organic',
				botDifficulty: 'standard',
				matchDurationTicks: 0,
				botCommandPostStacks: 0
			},
			{ onInit, onVisual }
		);
		const worker = FakeWorker.last;
		expect(worker).not.toBeNull();
		client.setSimulatedLatency(120);

		worker?.receive({ type: 'init' } as LocalWorkerOutbound);
		expect(onInit).toHaveBeenCalledTimes(1);

		worker?.receive({ type: 'visual' } as LocalWorkerOutbound);
		expect(onVisual).not.toHaveBeenCalled();
		vi.advanceTimersByTime(59);
		expect(onVisual).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(onVisual).toHaveBeenCalledTimes(1);

		client.dispose();
	});

	it('delays the command uplink and the command result downlink', async () => {
		const client = new LocalWorkerClient(
			{
				seed: 1,
				width: 512,
				height: 256,
				playerCount: 8,
				growthMode: 'organic',
				botDifficulty: 'standard',
				matchDurationTicks: 0,
				botCommandPostStacks: 0
			},
			{ onInit: vi.fn(), onVisual: vi.fn() }
		);
		const worker = FakeWorker.last;
		expect(worker).not.toBeNull();
		worker!.posted.length = 0;
		client.setSimulatedLatency(120);

		let settled = false;
		const result = client.command('attack', { x: 10, y: 20 }).then((value) => {
			settled = true;
			return value;
		});

		vi.advanceTimersByTime(59);
		expect(worker?.posted).toHaveLength(0);
		vi.advanceTimersByTime(1);
		expect(worker?.posted).toHaveLength(1);

		const sent = worker?.posted[0] as { id: number; command: { type: string } };
		worker?.receive({
			type: 'command-result',
			id: sent.id,
			ok: true,
			message: 'accepted',
			tick: 1,
			ledgerBlock: null
		} as LocalWorkerOutbound);
		await Promise.resolve();
		expect(settled).toBe(false);

		vi.advanceTimersByTime(59);
		await Promise.resolve();
		expect(settled).toBe(false);
		vi.advanceTimersByTime(1);
		await expect(result).resolves.toMatchObject({ ok: true, message: 'accepted' });
		expect(settled).toBe(true);

		client.dispose();
	});
});
