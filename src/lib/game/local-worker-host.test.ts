import { describe, expect, it } from 'vitest';
import { LocalWorkerHost } from './local-worker-host';
import type { LocalWorkerInitConfig } from './local-worker-protocol';

const CONFIG: LocalWorkerInitConfig = {
	seed: 1234,
	width: 1024,
	height: 512,
	playerCount: 8,
	growthMode: 'organic',
	botDifficulty: 'standard',
	matchDurationTicks: 0,
	botCommandPostStacks: 0
};

describe('local worker host', () => {
	it('exposes an init snapshot and streams deterministic visual deltas', () => {
		const host = new LocalWorkerHost(CONFIG);
		const init = host.initMessage();
		expect(init.width).toBe(1024);
		expect(init.height).toBe(512);
		expect(init.starts).toHaveLength(8);
		expect(init.owners).toHaveLength(1024 * 512);
		expect(init.snapshot.tick).toBe(0);

		const visual = host.step();
		expect(visual).not.toBeNull();
		expect(visual?.tick).toBe(1);
		expect(visual?.changes.length).toBeLessThanOrEqual(16_384);
		const second = host.step();
		expect(second?.tick).toBe(2);
	});

	it('holds steps while paused and resumes without losing the tick sequence', () => {
		const host = new LocalWorkerHost(CONFIG);
		host.setPaused(true);
		expect(host.step()).toBeNull();
		expect(host.tick).toBe(0);
		host.setPaused(false);
		expect(host.step()?.tick).toBe(1);
	});

	it('validates commands through the worker-owned simulation', () => {
		const host = new LocalWorkerHost(CONFIG);
		const result = host.command({
			type: 'command',
			id: 1,
			command: { type: 'alliance-request', targetPlayerId: 2 }
		});
		expect(result.type).toBe('command-result');
		expect(result.id).toBe(1);
		expect(result.message.length).toBeGreaterThan(0);
	});
});
