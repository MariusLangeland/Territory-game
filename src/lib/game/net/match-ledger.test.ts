import { describe, expect, it } from 'vitest';
import { TerritorySimulation, type SimulationOptions } from '../simulation';
import {
	createMatchLedger,
	decodeMatchLedger,
	encodeMatchLedger,
	recordMatchLedgerEntry,
	replayMatchLedger
} from './match-ledger';
import { applyOnlineIntent } from './online-intent';
import { OnlineRoom } from './online-room';
import type { OnlineIntent, OnlineRoomConfig } from './online-protocol';

const OPTIONS: SimulationOptions = {
	seed: 20261124,
	width: 512,
	height: 256,
	playerCount: 8,
	humanPlayerIds: [1],
	botDifficulty: 'standard',
	matchDurationTicks: 0,
	botCommandPostStacks: 0
};

function firstAttack(sim: TerritorySimulation): OnlineIntent | null {
	const land = (sim as unknown as { land: Uint8Array }).land;
	for (let y = 0; y < sim.height; y++) {
		for (let x = 0; x < sim.width; x++) {
			const index = y * sim.width + x;
			if (sim.owners[index] !== 1 || !land[index]) continue;
			const neighbours = [index - 1, index + 1, index - sim.width, index + sim.width];
			for (const neighbour of neighbours) {
				if (neighbour < 0 || neighbour >= sim.owners.length) continue;
				if (land[neighbour] && sim.owners[neighbour] !== 1) {
					const nx = neighbour % sim.width;
					const ny = Math.floor(neighbour / sim.width);
					return { type: 'attack', x: nx, y: ny };
				}
			}
		}
	}
	return null;
}

describe('match ledger', () => {
	it('replays accepted moves to the same checksum', () => {
		const sim = new TerritorySimulation(OPTIONS);
		const ledger = createMatchLedger(OPTIONS);
		const attack = firstAttack(sim);
		expect(attack).not.toBeNull();
		if (!attack) return;

		const queued = applyOnlineIntent(sim, 1, attack);
		expect(queued.ok).toBe(true);
		recordMatchLedgerEntry(ledger, sim.tick + 1, 1, attack);

		for (let tick = 0; tick < 40; tick++) sim.step();
		ledger.finalTick = sim.tick;
		ledger.checksumTick = sim.tick;
		ledger.finalChecksum = sim.checksum();

		const replay = replayMatchLedger(ledger);
		expect(replay.tick).toBe(sim.tick);
		expect(replay.checksum).toBe(sim.checksum());
		expect(replay.matches).toBe(true);
		expect(replay.applied).toBe(1);
		expect(replay.rejected).toEqual([]);
	});

	it('round-trips through the compact JSON ledger form', () => {
		const sim = new TerritorySimulation(OPTIONS);
		const ledger = createMatchLedger(OPTIONS);
		const attack = firstAttack(sim);
		expect(attack).not.toBeNull();
		if (!attack) return;
		expect(applyOnlineIntent(sim, 1, attack).ok).toBe(true);
		recordMatchLedgerEntry(ledger, sim.tick + 1, 1, attack);
		for (let tick = 0; tick < 10; tick++) sim.step();
		ledger.finalTick = sim.tick;
		ledger.checksumTick = sim.tick;
		ledger.finalChecksum = sim.checksum();

		const decoded = decodeMatchLedger(encodeMatchLedger(ledger));
		const replay = replayMatchLedger(decoded);
		expect(replay.checksum).toBe(sim.checksum());
		expect(replay.matches).toBe(true);

		const wrapped = decodeMatchLedger(
			JSON.stringify({ ledger: JSON.parse(encodeMatchLedger(ledger)), blocks: [], openBlock: null })
		);
		expect(wrapped.entries).toHaveLength(ledger.entries.length);
	});

	it('records accepted online-room moves and replays them', () => {
		const config: OnlineRoomConfig = {
			totalStates: 8,
			maxHumans: 2,
			seed: 4411,
			mapWidth: 512,
			mapHeight: 256,
			botDifficulty: 'standard',
			timerMinutes: 0,
			botCommandPostStacks: 0
		};
		const room = new OnlineRoom('ledger-room', config);
		const host = room.join('Host', 'host-token');
		expect(room.start(host.token).ok).toBe(true);
		const result = room.submit(host.token, {
			sequence: 1,
			intent: { type: 'alliance-request', targetPlayerId: 2 }
		});
		expect(result.ok).toBe(true);
		for (let tick = 0; tick < 50; tick++) room.tickOnce();
		const ledger = room.matchLedger();
		expect(ledger).not.toBeNull();
		if (!ledger) return;
		expect(ledger.entries).toHaveLength(1);
		const replay = replayMatchLedger(ledger);
		expect(replay.tick).toBe(50);
		expect(replay.matches).toBe(true);
		expect(replay.applied).toBe(1);
	});
});
