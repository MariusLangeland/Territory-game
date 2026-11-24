import { describe, expect, it } from 'vitest';
import { TerritorySimulation, type SimulationOptions } from '../simulation';
import { replayMatchLedger } from '../net/match-ledger';
import { LedgerAgent } from './agent';

const OPTIONS: SimulationOptions = {
	seed: 771122,
	width: 512,
	height: 256,
	playerCount: 8,
	humanPlayerIds: [1],
	botDifficulty: 'standard',
	matchDurationTicks: 0,
	botCommandPostStacks: 0
};

function firstAttack(sim: TerritorySimulation): { x: number; y: number } | null {
	const land = (sim as unknown as { land: Uint8Array }).land;
	for (let y = 0; y < sim.height; y++) {
		for (let x = 0; x < sim.width; x++) {
			const index = y * sim.width + x;
			if (sim.owners[index] !== 1 || !land[index]) continue;
			for (const neighbour of [index - 1, index + 1, index - sim.width, index + sim.width]) {
				if (neighbour < 0 || neighbour >= sim.owners.length) continue;
				if (land[neighbour] && sim.owners[neighbour] !== 1) {
					return { x: neighbour % sim.width, y: Math.floor(neighbour / sim.width) };
				}
			}
		}
	}
	return null;
}

describe('LedgerAgent', () => {
	it('accepts, blocks, seals, and replays offline transactions', () => {
		const agent = new LedgerAgent(OPTIONS);
		const attack = firstAttack(agent.simulation);
		expect(attack).not.toBeNull();
		if (!attack) return;

		const submitted = agent.submit(1, { type: 'attack', ...attack });
		expect(submitted.ok).toBe(true);
		expect(submitted.block?.tick).toBe(1);
		expect(submitted.block?.checksum).toBeNull();
		expect(agent.ledger.entries).toHaveLength(1);

		const first = agent.advance();
		expect(first.block?.tick).toBe(1);
		expect(first.block?.checksum).not.toBeNull();
		expect(first.block?.transactions).toHaveLength(1);
		expect(agent.ledger.finalTick).toBe(1);

		for (let tick = 0; tick < 20; tick++) agent.advance();
		agent.sampleChecksum();
		const snapshotLedger = agent.ledgerView;
		const replay = replayMatchLedger(snapshotLedger);
		expect(replay.tick).toBe(agent.tick);
		expect(replay.checksum).toBe(agent.simulation.checksum());
		expect(replay.matches).toBe(true);
	});

	it('replays a recorded ledger in read-only mode', () => {
		const source = new LedgerAgent(OPTIONS);
		const attack = firstAttack(source.simulation);
		expect(attack).not.toBeNull();
		if (!attack) return;
		expect(source.submit(1, { type: 'attack', ...attack }).ok).toBe(true);
		for (let tick = 0; tick < 25; tick++) source.advance();
		source.sampleChecksum();

		const replay = new LedgerAgent(OPTIONS, source.ledgerView);
		expect(replay.submit(1, { type: 'attack', ...attack })).toMatchObject({
			ok: false,
			reason: 'read-only'
		});
		let guard = 0;
		while (!replay.replayComplete && guard++ < 100) replay.advance();
		expect(replay.replayComplete).toBe(true);
		expect(replay.simulation.tick).toBe(source.simulation.tick);
		expect(replay.simulation.checksum()).toBe(source.simulation.checksum());
		expect(replay.replayChecksumMatches).toBe(true);
	});

	it('rejects invalid transactions without writing a block', () => {
		const agent = new LedgerAgent(OPTIONS);
		const before = agent.ledger.entries.length;
		const result = agent.submit(1, { type: 'attack', x: -10, y: -10 });
		expect(result.ok).toBe(false);
		expect(agent.ledger.entries).toHaveLength(before);
		expect(agent.openBlockView).toBeNull();
	});

	it('chains sealed block checksums', () => {
		const agent = new LedgerAgent(OPTIONS);
		const attack = firstAttack(agent.simulation);
		expect(attack).not.toBeNull();
		if (!attack) return;
		expect(agent.submit(1, { type: 'attack', ...attack }).ok).toBe(true);
		const first = agent.advance().block;
		expect(first).not.toBeNull();
		if (!first) return;

		const attack2 = firstAttack(agent.simulation);
		if (attack2) {
			const second = agent.submit(1, { type: 'attack', ...attack2 });
			expect(second.ok).toBe(true);
			const sealed = agent.advance().block;
			expect(sealed?.previousChecksum).toBe(first.checksum);
		}
	});
});
