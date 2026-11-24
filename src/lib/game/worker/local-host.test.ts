import { describe, expect, it } from 'vitest';
import { LocalWorkerHost } from './local-host';
import type { LocalWorkerInitConfig } from './local-protocol';
import { TerritorySimulation } from '../simulation';
import { replayMatchLedger } from '../net/match-ledger';

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

	it('matches a direct simulation checksum across the worker tick loop', () => {
		const host = new LocalWorkerHost(CONFIG);
		const direct = new TerritorySimulation({
			seed: CONFIG.seed,
			width: CONFIG.width,
			height: CONFIG.height,
			playerCount: CONFIG.playerCount,
			growthMode: CONFIG.growthMode,
			botDifficulty: CONFIG.botDifficulty,
			matchDurationTicks: CONFIG.matchDurationTicks,
			botCommandPostStacks: CONFIG.botCommandPostStacks
		});
		for (let tick = 0; tick < 120; tick++) {
			host.step();
			direct.step();
		}
		expect(host.simulation.checksum()).toBe(direct.checksum());
		expect(host.simulation.getSnapshot().tick).toBe(120);
	});

	it('transfers a district color for every owner change', () => {
		const host = new LocalWorkerHost({ ...CONFIG, playerCount: 8 });
		let visual = host.step();
		for (let tick = 1; tick < 30 && (visual?.changes.length ?? 0) === 0; tick++) {
			visual = host.step();
		}
		expect(visual?.changes.length ?? 0).toBeGreaterThan(0);
		expect(visual?.changeDistrictColors?.length).toBe(visual?.changes.length);
		const cell = (visual?.changes[0] ?? 0) & 0x3ffffff;
		expect(visual?.changeDistrictColors?.[0]).toBe(host.simulation.districtColorCodes[cell]);
	});

	it('transfers district tile color bytes for dirty district tiles', () => {
		const host = new LocalWorkerHost({ ...CONFIG, playerCount: 8 });
		let visual = host.step();
		for (let tick = 1; tick < 200 && visual?.districtTiles.length === 0; tick++) {
			visual = host.step();
		}
		expect(visual?.districtTiles.length ?? 0).toBeGreaterThan(0);
		const tiles = visual!.districtTiles;
		const colors = visual!.districtTileColors;
		expect(colors).toBeInstanceOf(Uint8Array);
		expect(colors?.length).toBe(tiles.length * 32 * 32);
		const tile = tiles[0]!;
		const tilesX = Math.ceil(host.simulation.width / 32);
		const x0 = (tile % tilesX) * 32;
		const y0 = Math.floor(tile / tilesX) * 32;
		expect(colors?.[0]).toBe(host.simulation.districtColorCodes[y0 * host.simulation.width + x0]);
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

	it('seeks replay state and exposes playback status', () => {
		const source = new LocalWorkerHost(CONFIG);
		source.command({
			type: 'command',
			id: 1,
			command: { type: 'alliance-request', targetPlayerId: 2 }
		});
		for (let tick = 0; tick < 20; tick++) source.step();
		source.agent.sampleChecksum();

		const replay = new LocalWorkerHost({ ...CONFIG, replay: source.agent.ledgerView });
		expect(replay.replayStatus().maxTick).toBe(20);
		replay.setReplaySpeed(4);
		expect(replay.speed).toBe(4);
		const visual = replay.seekReplay(7);
		expect(visual.changesOverflow).toBe(true);
		expect(visual.owners?.length).toBe(1024 * 512);
		expect(replay.simulation.tick).toBe(7);
		replay.seekReplay(20);
		expect(replay.agent.replayComplete).toBe(true);
		expect(replay.replayStatus().complete).toBe(true);
	});

	it('routes commands through the ledger agent and sends sealed blocks', () => {
		const host = new LocalWorkerHost(CONFIG);
		const result = host.command({
			type: 'command',
			id: 2,
			command: { type: 'alliance-request', targetPlayerId: 2 }
		});
		expect(result.ok).toBe(true);
		expect(result.ledgerBlock?.checksum).toBeNull();
		expect(result.ledgerBlock?.transactions).toHaveLength(1);
		const visual = host.step();
		expect(visual?.ledgerBlock?.checksum).not.toBeNull();
		host.agent.sampleChecksum();
		const replay = replayMatchLedger(host.agent.ledgerView);
		expect(replay.checksum).toBe(host.simulation.checksum());
		expect(replay.matches).toBe(true);

		const exported = host.command({ type: 'command', id: 3, command: { type: 'ledger' } });
		expect(exported.ok).toBe(true);
		expect(exported.ledgerText).toContain('"entries"');
		expect(JSON.parse(exported.ledgerText ?? '{}').blocks).toHaveLength(1);
	});
});
