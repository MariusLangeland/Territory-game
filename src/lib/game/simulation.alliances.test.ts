import { describe, expect, it } from 'vitest';
import { HUMAN_PLAYER_ID } from './constants';
import { createGrowthLayer } from './growth';
import { TerritorySimulation, type AttackState } from './simulation';

describe('alliances', () => {
	it('accepts a request, blocks allied attacks, and breaks with a cooldown', () => {
		const sim = new TerritorySimulation({ seed: 1234, playerCount: 8 });
		expect(sim.requestAlliance(HUMAN_PLAYER_ID, 2).ok).toBe(true);
		for (let tick = 0; tick < 30 && sim.getSnapshot().alliances.length === 0; tick++) {
			sim.step();
		}
		const snapshot = sim.getSnapshot();
		expect(snapshot.alliances).toHaveLength(1);
		expect(snapshot.alliances[0]).toMatchObject({ playerA: HUMAN_PLAYER_ID, playerB: 2 });
		const targetStart = sim.map.starts[1];
		expect(sim.validateAttack(HUMAN_PLAYER_ID, targetStart.x, targetStart.y).reason).toBe('allied');
		expect(sim.breakAlliance(HUMAN_PLAYER_ID, 2).ok).toBe(true);
		sim.step();
		expect(sim.getSnapshot().alliances).toHaveLength(0);
		expect(sim.requestAlliance(HUMAN_PLAYER_ID, 2).ok).toBe(false);
	});

	it('cancels conflicting fronts when an alliance forms', () => {
		const sim = new TerritorySimulation({ seed: 1234, playerCount: 8 });
		const target = sim.map.starts[1];
		const frontier = createGrowthLayer('organic', {
			width: sim.width,
			height: sim.height,
			owners: sim.owners,
			attackerId: HUMAN_PLAYER_ID,
			anchorX: target.x - 2,
			anchorY: target.y,
			rngSeed: 1
		});
		const attack: AttackState = {
			id: 900,
			attackerId: HUMAN_PLAYER_ID,
			defenderId: 2,
			targetX: target.x,
			targetY: target.y,
			anchorX: target.x - 2,
			anchorY: target.y,
			growthMode: 'organic',
			frontier,
			createdAtTick: 0,
			lifetimeTicks: 0,
			orders: 1,
			initialOrders: 1,
			strength: 1500,
			initialStrength: 1500,
			supplyCost: 30,
			power: 30,
			pierce: 0,
			idleTicks: 0,
			captures: 0,
			done: false
		};
		(sim as unknown as { attacks: AttackState[] }).attacks = [attack];
		expect(sim.requestAlliance(HUMAN_PLAYER_ID, 2).ok).toBe(true);
		for (let tick = 0; tick < 30 && sim.getSnapshot().alliances.length === 0; tick++) {
			sim.step();
		}
		expect(sim.getSnapshot().alliances).toHaveLength(1);
		expect(
			sim.activeAttacks.some(
				(entry) =>
					(entry.attackerId === HUMAN_PLAYER_ID && entry.defenderId === 2) ||
					(entry.attackerId === 2 && entry.defenderId === HUMAN_PLAYER_ID)
			)
		).toBe(false);
	});

	it('rejects a low-trust request and expires stale diplomatic state', () => {
		const sim = new TerritorySimulation({ seed: 1234, playerCount: 8 });
		const internals = sim as unknown as {
			botGrievance: Uint16Array;
			tick: number;
			allianceProposals: Array<Record<string, number>>;
			alliances: Array<Record<string, number>>;
			updateAlliances(): void;
		};
		internals.botGrievance[1 * 8 + 0] = 200;
		expect(sim.requestAlliance(HUMAN_PLAYER_ID, 2).ok).toBe(true);
		for (let tick = 0; tick < 30 && sim.getSnapshot().allianceProposals.length > 0; tick++) {
			sim.step();
		}
		expect(sim.getSnapshot().alliances).toHaveLength(0);
		expect(sim.getSnapshot().allianceProposals).toHaveLength(0);

		internals.tick = 100;
		internals.allianceProposals = [
			{ id: 10, fromPlayerId: 1, toPlayerId: 2, createdAtTick: 0, expiresAtTick: 50 }
		];
		internals.alliances = [
			{
				id: 11,
				playerA: 1,
				playerB: 2,
				startedAtTick: 0,
				expiresAtTick: 50
			}
		];
		internals.updateAlliances();
		expect(internals.allianceProposals).toHaveLength(0);
		expect(internals.alliances).toHaveLength(0);
	});

	it('removes alliances when a member is eliminated', () => {
		const sim = new TerritorySimulation({ seed: 1234, playerCount: 8 });
		const internals = sim as unknown as {
			alliances: Array<Record<string, number>>;
			players: Array<{ alive: boolean }>;
			updateAlliances(): void;
		};
		internals.alliances = [
			{
				id: 20,
				playerA: HUMAN_PLAYER_ID,
				playerB: 2,
				startedAtTick: 0,
				expiresAtTick: 10_000
			}
		];
		internals.players[1].alive = false;
		internals.updateAlliances();
		expect(internals.alliances).toHaveLength(0);
	});
});
