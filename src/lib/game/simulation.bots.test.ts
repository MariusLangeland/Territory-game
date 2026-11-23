import { describe, expect, it } from 'vitest';
import {
	ATTACK_IDLE_TICKS,
	BOT_BUILD_INTERVAL,
	BOT_DECISION_INTERVAL,
	BOT_DEFENSE_RESERVE_MAX,
	BOT_DEFENSE_STALL_INTERVALS,
	BOT_THREAT_DEFENSIVE,
	HUMAN_PLAYER_ID,
	PLAYER_COUNT,
	STRUCTURE_MIN_SPACING
} from './constants';
import { createGrowthLayer } from './growth';
import { TerritorySimulation, type AttackState, type PlayerState } from './simulation';
import type { BotDefenseInternals } from './simulation.test-helpers';

/** Step until the simulation reaches the requested tick. */
function stepUntilTick(sim: TerritorySimulation, targetTick: number): void {
	while (sim.tick < targetTick) sim.step();
}

function findBareOwnedCells(sim: TerritorySimulation, playerId: number, count: number): number[] {
	const cells: number[] = [];
	for (let index = 0; index < sim.owners.length && cells.length < count; index++) {
		if (sim.owners[index] !== playerId || !sim.terrain[index]) continue;
		if (sim.structures.at(index)) continue;
		const x = index % sim.width;
		const y = (index - x) / sim.width;
		if (sim.getDistrictStructureId(x, y) !== 0) continue;
		if (sim.structures.hasWithinRadius(x, y, STRUCTURE_MIN_SPACING)) continue;
		cells.push(index);
	}
	return cells;
}

/**
 * Inject a hostile front that is retired by processAttacks on the same step.
 * The threat refresh runs before combat, so the defender still sees the attack.
 */
function injectThreatAttack(
	sim: TerritorySimulation,
	attackerId: number,
	defenderId: number
): void {
	const start = sim.map.starts[defenderId - 1];
	const internals = sim as unknown as { attacks: AttackState[] };
	internals.attacks.push({
		id: 900_000 + attackerId,
		attackerId,
		defenderId,
		targetX: start.x,
		targetY: start.y,
		anchorX: start.x,
		anchorY: start.y,
		growthMode: 'circular',
		frontier: createGrowthLayer('circular', {
			width: sim.width,
			height: sim.height,
			owners: sim.owners,
			attackerId,
			anchorX: start.x,
			anchorY: start.y,
			rngSeed: 7
		}),
		createdAtTick: sim.tick,
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
	});
}

describe('bot command-post modifier', () => {
	it('grants every AI seat a 500-stack starting Command Post', () => {
		const sim = new TerritorySimulation({
			seed: 1234,
			playerCount: 8,
			botCommandPostStacks: 500
		});
		for (const player of sim.players) {
			const posts = sim.structures
				.forOwner(player.id)
				.filter((structure) => structure.type === 'command-post');
			if (player.isBot) {
				expect(posts).toHaveLength(1);
				expect(posts[0]?.stacks).toBe(500);
			} else {
				expect(posts).toHaveLength(0);
			}
		}
	});

	it('runs the surge deterministically under load', () => {
		const build = () =>
			new TerritorySimulation({
				seed: 1234,
				playerCount: PLAYER_COUNT,
				botCommandPostStacks: 500
			});
		const left = build();
		const right = build();
		expect(
			left.structures.all.filter((structure) => structure.type === 'command-post')
		).toHaveLength(PLAYER_COUNT - 1);
		for (let tick = 0; tick < 600; tick++) {
			left.step();
			right.step();
		}
		expect(left.checksum()).toBe(right.checksum());
		expect(left.players.filter((player) => player.alive).length).toBe(
			right.players.filter((player) => player.alive).length
		);
		expect(left.activeAttacks.length).toBe(right.activeAttacks.length);
		expect(left.structures.count).toBe(right.structures.count);
		const snapshot = left.getSnapshot();
		const totalTerritory = snapshot.players.reduce((sum, player) => sum + player.territory, 0);
		expect(totalTerritory).toBe(snapshot.claimedLand);
		for (const player of left.players) expect(player.territory).toBeGreaterThanOrEqual(0);
	}, 30_000);
});

describe('bot offensive investment', () => {
	it('builds Barracks early and reaches Artillery in a normal match', () => {
		const sim = new TerritorySimulation({ seed: 1234 });
		let barracksAt1800 = 0;
		let artilleryAt6000 = 0;
		for (let tick = 1; tick <= 6000; tick++) {
			sim.step();
			if (tick === 1800) {
				barracksAt1800 = sim.structures.all.filter(
					(structure) => structure.type === 'barracks'
				).length;
			}
			if (tick === 6000) {
				artilleryAt6000 = sim.structures.all.filter(
					(structure) => structure.type === 'artillery'
				).length;
			}
		}
		expect(barracksAt1800).toBeGreaterThan(0);
		expect(artilleryAt6000).toBeGreaterThan(0);
		// 6000 full-map bot ticks run ~30s; keep headroom for parallel suites.
	}, 120_000);
});

describe('bot strategy and economy', () => {
	it('gives bots varied strategies and lets them build', () => {
		const sim = new TerritorySimulation({ seed: 581321 });
		const internals = sim as unknown as {
			botProfiles: Array<{
				aggression: number;
				focus: string;
				vengeful: number;
				cautious: number;
				conciliatory: number;
				opportunist: number;
				buildPlan: string[];
				structureBias: Record<string, number>;
			}>;
		};
		const profiles = internals.botProfiles.slice(1);
		const focuses = new Set(profiles.map((profile) => profile.focus));
		expect(focuses.size).toBeGreaterThan(1);
		for (const profile of profiles) {
			expect(profile.buildPlan).toHaveLength(7);
			expect(new Set(profile.buildPlan).size).toBe(7);
			expect(profile.buildPlan[0]).toBe(profile.focus);
			expect(Object.keys(profile.structureBias)).toHaveLength(7);
			for (const value of Object.values(profile.structureBias)) {
				expect(value).toBeGreaterThanOrEqual(0);
				expect(value).toBeLessThanOrEqual(200);
			}
		}
		const biasRanges = Object.keys(profiles[0].structureBias).map((type) => {
			const values = profiles.map((profile) => profile.structureBias[type]);
			return Math.max(...values) - Math.min(...values);
		});
		expect(Math.max(...biasRanges)).toBeGreaterThan(30);
		const aggressions = profiles.map((profile) => profile.aggression);
		expect(Math.max(...aggressions) - Math.min(...aggressions)).toBeGreaterThan(30);
		for (const trait of ['vengeful', 'cautious', 'conciliatory', 'opportunist'] as const) {
			const values = profiles.map((profile) => profile[trait]);
			expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(30);
		}

		for (let i = 0; i < 60; i++) sim.step();
		const built = sim.structures.all.filter((structure) => structure.type !== 'state');
		expect(built.length).toBeGreaterThan(0);
		expect(new Set(built.map((structure) => structure.type)).size).toBeGreaterThan(1);
		for (let index = 0; index < sim.districtStructureIds.length; index++) {
			const structureId = sim.districtStructureIds[index];
			if (structureId === 0) continue;
			const structure = sim.structures.byId(structureId);
			expect(structure).toBeDefined();
			expect(structure?.ownerId).toBe(sim.owners[index]);
		}
	});

	it('lets utility bots diversify structures instead of following one fixed plan', () => {
		const sim = new TerritorySimulation({ seed: 1234 });
		for (let tick = 0; tick < 600; tick++) sim.step();
		const builtTypes = new Set(
			sim.structures.all
				.filter((structure) => structure.type !== 'state')
				.map((structure) => structure.type)
		);
		expect(builtTypes.size).toBeGreaterThanOrEqual(3);
		expect(builtTypes.has('command-post')).toBe(true);
		expect(builtTypes.has('war-academy')).toBe(true);
		const human = sim.players[HUMAN_PLAYER_ID - 1];
		expect(human.alive).toBe(true);
	});

	it('keeps bot expansion flowing while they save for expensive aspirations', () => {
		const sim = new TerritorySimulation({ seed: 1234 });
		for (let tick = 0; tick < 3000; tick++) sim.step();
		const snapshot = sim.getSnapshot();
		expect(snapshot.attacks.length).toBeGreaterThan(10);
		expect(snapshot.players.filter((player) => player.alive).length).toBeLessThan(
			snapshot.players.length
		);
	}, 45_000);

	it('weights grudges, caution, conciliation, and opportunity in bot targeting', () => {
		const sim = new TerritorySimulation({ seed: 918273 });
		const internals = sim as unknown as {
			botGrievance: Uint16Array;
			botPressure: Uint16Array;
			scoreBotTarget(
				attackerId: number,
				profile: Record<string, unknown>,
				defenderId: number,
				selfStrength: number,
				strengths: Uint32Array
			): { score: number; opportunity: boolean };
		};
		const base = {
			aggression: 50,
			economy: 50,
			fortification: 50,
			command: 50,
			vengeful: 0,
			cautious: 0,
			conciliatory: 0,
			opportunist: 0,
			focus: 'artillery',
			buildPlan: []
		};
		const strengths = new Uint32Array(PLAYER_COUNT);
		strengths[0] = 1000;
		const score = (overrides: Record<string, number>) =>
			internals.scoreBotTarget(2, { ...base, ...overrides }, 1, 100, strengths);

		const targetScore = (overrides: Record<string, number>) => score(overrides).score;

		internals.botGrievance[PLAYER_COUNT] = 10;
		expect(targetScore({ vengeful: 100 })).toBeGreaterThan(targetScore({ vengeful: 0 }));
		internals.botGrievance[PLAYER_COUNT] = 0;

		expect(targetScore({ cautious: 100 })).toBeLessThan(targetScore({ cautious: 0 }));
		expect(targetScore({ conciliatory: 100 })).toBeLessThan(targetScore({ conciliatory: 0 }));

		internals.botPressure[0] = 3;
		expect(targetScore({ opportunist: 100 })).toBeGreaterThan(targetScore({ opportunist: 0 }));

		// A stronger neighbour that cannot afford a counterattack is an
		// opportunity even for a cautious profile.
		const savedGold = sim.gold;
		sim.gold = 0;
		const lowSupply = score({ cautious: 100, opportunist: 100 });
		expect(lowSupply.opportunity).toBe(true);
		sim.gold = 1000;
		const highSupply = score({ cautious: 100, opportunist: 100 });
		expect(highSupply.opportunity).toBe(false);
		expect(lowSupply.score).toBeGreaterThan(highSupply.score);
		sim.gold = savedGold;
	});
});

describe('bot threat detection and defensive behaviour', () => {
	it('detects an active attack targeting a bot and enters a defensive posture', () => {
		const sim = new TerritorySimulation({ seed: 13579 });
		const internals = sim as unknown as BotDefenseInternals;
		stepUntilTick(sim, BOT_DECISION_INTERVAL - 1);
		expect(internals.botThreat[1]).toBe(0);
		expect(internals.botDefensive[1]).toBe(0);

		injectThreatAttack(sim, 3, 2);
		sim.step();

		expect(internals.botThreat[1]).toBeGreaterThanOrEqual(BOT_THREAT_DEFENSIVE);
		expect(internals.botDefensive[1]).toBe(1);
		expect(internals.botReserve[1]).toBeGreaterThan(0);
		expect(internals.botReserve[1]).toBeLessThanOrEqual(BOT_DEFENSE_RESERVE_MAX);
	});

	it('counts hostile border contact as threat without holding the posture', () => {
		const sim = new TerritorySimulation({ seed: 97531 });
		const internals = sim as unknown as BotDefenseInternals;
		stepUntilTick(sim, BOT_DECISION_INTERVAL - 1);

		// Fabricate enemy ownership on three neutral pixels touching bot 2.
		let touches = 0;
		for (const index of sim.players[1].border) {
			const x = index % sim.width;
			const y = (index - x) / sim.width;
			const neighbours = [
				x > 0 ? index - 1 : -1,
				x + 1 < sim.width ? index + 1 : -1,
				y > 0 ? index - sim.width : -1,
				y + 1 < sim.height ? index + sim.width : -1
			];
			for (const neighbour of neighbours) {
				if (neighbour < 0 || !sim.terrain[neighbour]) continue;
				if (sim.owners[neighbour] !== 0) continue;
				sim.owners[neighbour] = 3;
				touches++;
				if (touches >= 3) break;
			}
			if (touches >= 3) break;
		}
		expect(touches).toBe(3);

		sim.step();
		expect(internals.botThreat[1]).toBeGreaterThan(0);
		expect(internals.botThreat[1]).toBeLessThan(BOT_THREAT_DEFENSIVE);
		expect(internals.botDefensive[1]).toBe(0);
		expect(internals.botReserve[1]).toBe(0);
	});

	it('releases the gold reserve once the threat passes', () => {
		const sim = new TerritorySimulation({ seed: 24680 });
		const internals = sim as unknown as BotDefenseInternals;
		stepUntilTick(sim, BOT_DECISION_INTERVAL - 1);

		injectThreatAttack(sim, 3, 2);
		sim.step();
		expect(internals.botDefensive[1]).toBe(1);
		expect(internals.botReserve[1]).toBeGreaterThan(0);

		// The injected front idles out, then the next decision clears posture.
		stepUntilTick(sim, BOT_DECISION_INTERVAL * 2 + ATTACK_IDLE_TICKS + 4);
		expect(internals.botThreat[1]).toBe(0);
		expect(internals.botDefensive[1]).toBe(0);
		expect(internals.botReserve[1]).toBe(0);
	});

	it('releases a stuck reserve so a long stalemate cannot block spending forever', () => {
		const sim = new TerritorySimulation({ seed: 314159 });
		const internals = sim as unknown as BotDefenseInternals;
		stepUntilTick(sim, BOT_BUILD_INTERVAL - 2);

		const cells = findBareOwnedCells(sim, 2, 2);
		expect(cells).toHaveLength(2);
		if (cells.length < 2) return;
		const [postCell, barracksCell] = cells;
		const post = sim.structures.create(
			'fortification',
			2,
			postCell % sim.width,
			Math.floor(postCell / sim.width),
			sim.width
		);
		const barracks = sim.structures.create(
			'barracks',
			2,
			barracksCell % sim.width,
			Math.floor(barracksCell / sim.width),
			sim.width
		);
		// Both defensive options are far above what the bot can save between
		// build intervals, so defensive progress genuinely stalls.
		for (let level = 1; level < 100; level++) {
			sim.structures.reinforce(post);
			sim.structures.reinforce(barracks);
		}
		internals.botGold[1] = 300;

		// Fresh losses at every decision tick keep the bot threatened.
		const grudge = (2 - 1) * PLAYER_COUNT + (3 - 1);
		const lastTick = BOT_BUILD_INTERVAL * BOT_DEFENSE_STALL_INTERVALS;
		for (let tick = BOT_DECISION_INTERVAL; tick <= lastTick; tick += BOT_DECISION_INTERVAL) {
			stepUntilTick(sim, tick - 1);
			internals.botGrievance[grudge] += 10;
			sim.step();
		}

		expect(internals.botDefensive[1]).toBe(1);
		// The reserve was released, so the bot finally bought a plan structure.
		const planStructures = sim.structures
			.forOwner(2)
			.filter(
				(entry) => entry.type !== 'state' && entry.id !== post.id && entry.id !== barracks.id
			);
		expect(planStructures.length).toBeGreaterThan(0);
	});

	it('builds a fortification before the build plan when threatened', () => {
		const sim = new TerritorySimulation({ seed: 246810 });
		const internals = sim as unknown as BotDefenseInternals;
		stepUntilTick(sim, BOT_BUILD_INTERVAL - 2);
		expect(internals.botDefensive[1]).toBe(0);
		expect(sim.structures.forOwner(2).filter((entry) => entry.type !== 'state')).toHaveLength(0);

		// A fresh loss at the refresh tick raises threat past the threshold.
		internals.botGrievance[(2 - 1) * PLAYER_COUNT + (3 - 1)] += 10;
		sim.step();

		expect(internals.botDefensive[1]).toBe(1);
		expect(internals.botReserve[1]).toBeGreaterThan(0);
		expect(sim.structures.forOwnerType(2, 'fortification')).toBeDefined();
		const buildables = sim.structures
			.forOwner(2)
			.filter((entry) => entry.type !== 'state')
			.map((entry) => entry.type);
		expect(buildables).toEqual(['fortification']);
	});

	it('upgrades a defensive structure before unrelated plan steps when threatened', () => {
		const sim = new TerritorySimulation({ seed: 918273 });
		const internals = sim as unknown as BotDefenseInternals;
		stepUntilTick(sim, BOT_BUILD_INTERVAL - 2);

		const cells = findBareOwnedCells(sim, 2, 2);
		expect(cells).toHaveLength(2);
		if (cells.length < 2) return;
		const [postCell, barracksCell] = cells;
		const post = sim.structures.create(
			'fortification',
			2,
			postCell % sim.width,
			Math.floor(postCell / sim.width),
			sim.width
		);
		const barracks = sim.structures.create(
			'barracks',
			2,
			barracksCell % sim.width,
			Math.floor(barracksCell / sim.width),
			sim.width
		);

		internals.botGrievance[(2 - 1) * PLAYER_COUNT + (3 - 1)] += 10;
		sim.step();

		expect(internals.botDefensive[1]).toBe(1);
		expect(post.stacks).toBe(2);
		expect(barracks.stacks).toBe(1);
		const built = sim.structures
			.forOwner(2)
			.filter(
				(entry) => entry.type !== 'state' && entry.id !== post.id && entry.id !== barracks.id
			);
		expect(built).toHaveLength(0);
	});

	it('rebuilds a destroyed fortification when threatened', () => {
		const sim = new TerritorySimulation({ seed: 553311 });
		const internals = sim as unknown as BotDefenseInternals;
		stepUntilTick(sim, BOT_BUILD_INTERVAL - 2);

		const [cell] = findBareOwnedCells(sim, 2, 1);
		expect(cell).toBeDefined();
		if (cell === undefined) return;
		const destroyed = sim.structures.create(
			'fortification',
			2,
			cell % sim.width,
			Math.floor(cell / sim.width),
			sim.width
		);
		expect(sim.structures.destroy(destroyed)).toBe(true);
		expect(sim.structures.forOwnerType(2, 'fortification')).toBeUndefined();

		internals.botGrievance[(2 - 1) * PLAYER_COUNT + (3 - 1)] += 10;
		internals.botGold[1] = 100;
		sim.step();

		const rebuilt = sim.structures.forOwnerType(2, 'fortification');
		expect(rebuilt).toBeDefined();
		expect(rebuilt?.id).not.toBe(destroyed.id);
	});

	it('rebuilds a destroyed early-economy structure when affordable and a site exists', () => {
		const sim = new TerritorySimulation({ seed: 314159 });
		const internals = sim as unknown as BotDefenseInternals;
		stepUntilTick(sim, BOT_BUILD_INTERVAL - 2);
		expect(internals.botDefensive[1]).toBe(0);

		const economyType = 'command-post';
		const [cell] = findBareOwnedCells(sim, 2, 1);
		expect(cell).toBeDefined();
		if (cell === undefined) return;
		const destroyed = sim.structures.create(
			economyType,
			2,
			cell % sim.width,
			Math.floor(cell / sim.width),
			sim.width
		);
		expect(sim.structures.destroy(destroyed)).toBe(true);
		internals.botGold[1] = 1000;

		sim.step();
		expect(sim.structures.forOwnerType(2, economyType)).toBeDefined();
	});

	it('biases high-threat targeting toward the grudge holder and attacker', () => {
		const sim = new TerritorySimulation({ seed: 1234 });
		const internals = sim as unknown as BotDefenseInternals;
		const profile = internals.botProfiles[1] as unknown as Record<string, unknown>;
		const strengths = new Uint32Array(PLAYER_COUNT).fill(1000);
		const score = (defenderId: number): number =>
			internals.scoreBotTarget(2, profile, defenderId, 1000, strengths).score;

		const peacefulNeutral = score(0);
		expect(peacefulNeutral).toBeGreaterThan(0);

		internals.botDefensive[1] = 1;
		internals.botGrievance[(2 - 1) * PLAYER_COUNT + (3 - 1)] = 8;
		internals.botAttackers[(4 - 1) * PLAYER_COUNT + (2 - 1)] = 1;

		expect(score(0)).toBeGreaterThan(peacefulNeutral);
		expect(score(3)).toBeGreaterThan(score(5));
		expect(score(4)).toBeGreaterThan(score(5));
	});

	it('measures income and strength gaps against bordering neighbours', () => {
		const sim = new TerritorySimulation({ seed: 1234 });
		const width = sim.width;
		const internals = sim as unknown as {
			claim(index: number, newOwner: number, sourceAttackId?: number): void;
			botIncomeGap: Uint8Array;
			botDeterrence: Uint16Array;
		};
		const self = sim.players[1];
		const neighbour = sim.players[2];
		expect(self).toBeDefined();
		expect(neighbour).toBeDefined();
		if (!self || !neighbour) return;
		let claimed = -1;
		for (const index of self.border) {
			const x = index % width;
			const y = (index - x) / width;
			const candidates = [
				x > 0 ? index - 1 : -1,
				x + 1 < width ? index + 1 : -1,
				y > 0 ? index - width : -1,
				y + 1 < sim.height ? index + width : -1
			];
			for (const next of candidates) {
				if (next < 0 || (sim.owners[next] ?? 0) !== 0) continue;
				internals.claim(next, neighbour.id);
				claimed = next;
				break;
			}
			if (claimed >= 0) break;
		}
		expect(claimed).toBeGreaterThanOrEqual(0);
		neighbour.territory += 30_000;
		stepUntilTick(sim, BOT_DECISION_INTERVAL);

		expect(internals.botIncomeGap[self.id - 1]).toBeGreaterThan(0);
		expect(internals.botDeterrence[self.id - 1]).toBeGreaterThan(0);
	});

	it('prioritizes income and deterrent fortifications from neighbour pressure', () => {
		const sim = new TerritorySimulation({ seed: 90210 });
		const internals = sim as unknown as {
			tick: number;
			botIncomeGap: Uint8Array;
			botDeterrence: Uint16Array;
			botDefensive: Uint8Array;
			chooseBotEconomicAction(
				player: PlayerState,
				budget: number,
				defensiveBudget?: number
			): { type: string } | null;
		};
		const player = sim.players[1];
		expect(player).toBeDefined();
		if (!player) return;
		internals.tick = 1201;
		internals.botDefensive[player.id - 1] = 0;

		internals.botIncomeGap[player.id - 1] = 100;
		internals.botDeterrence[player.id - 1] = 0;
		expect(internals.chooseBotEconomicAction(player, 1000, 1000)?.type).toBe('command-post');

		internals.botIncomeGap[player.id - 1] = 0;
		internals.botDeterrence[player.id - 1] = 100;
		expect(internals.chooseBotEconomicAction(player, 1000, 1000)?.type).toBe('fortification');
	});

	it('counts threatened fortifications and deterrence-triggered posture', () => {
		const sim = new TerritorySimulation({ seed: 1234 });
		const internals = sim as unknown as {
			tick: number;
			botDefensive: Uint8Array;
			botThreat: Uint16Array;
			botReserve: Uint8Array;
			botGold: number[];
			botPressure: Uint16Array;
			runBotEconomy(): void;
		};
		internals.tick = BOT_BUILD_INTERVAL - 1;
		internals.botPressure[1] = 1;
		internals.botDefensive[1] = 1;
		internals.botThreat[1] = BOT_THREAT_DEFENSIVE;
		internals.botReserve[1] = BOT_DEFENSE_RESERVE_MAX;
		internals.botGold[1] = 1000;
		internals.runBotEconomy();
		expect(sim.getBotBehaviorTelemetry().threatenedFortificationBuilds).toBeGreaterThan(0);

		const deterrenceSim = new TerritorySimulation({ seed: 1234 });
		const deterrenceInternals = deterrenceSim as unknown as {
			claim(index: number, newOwner: number, sourceAttackId?: number): void;
			botPressure: Uint16Array;
			botDefensive: Uint8Array;
			refreshBotThreat(player: PlayerState): void;
		};
		const self = deterrenceSim.players[1];
		const neighbour = deterrenceSim.players[2];
		expect(self).toBeDefined();
		expect(neighbour).toBeDefined();
		if (!self || !neighbour) return;
		let claimed = -1;
		for (const index of self.border) {
			const x = index % deterrenceSim.width;
			const y = (index - x) / deterrenceSim.width;
			for (const next of [
				x > 0 ? index - 1 : -1,
				x + 1 < deterrenceSim.width ? index + 1 : -1,
				y > 0 ? index - deterrenceSim.width : -1,
				y + 1 < deterrenceSim.height ? index + deterrenceSim.width : -1
			]) {
				if (next < 0 || (deterrenceSim.owners[next] ?? 0) !== 0) continue;
				deterrenceInternals.claim(next, neighbour.id);
				claimed = next;
				break;
			}
			if (claimed >= 0) break;
		}
		expect(claimed).toBeGreaterThanOrEqual(0);
		neighbour.territory += 30_000;
		deterrenceInternals.botPressure[self.id - 1] = 1;
		deterrenceInternals.botDefensive[self.id - 1] = 0;
		deterrenceInternals.refreshBotThreat(self);
		expect(deterrenceSim.getBotBehaviorTelemetry().deterrencePostures).toBeGreaterThan(0);
	});

	it('keeps coordinated teams from attacking each other', () => {
		const sim = new TerritorySimulation({
			seed: 424242,
			playerCount: 4,
			width: 640,
			height: 360,
			allPlayersBots: true,
			teamIds: [1, 1, 2, 2]
		});
		for (let tick = 0; tick < 900; tick++) sim.step();
		const snapshot = sim.getSnapshot();
		const sameTeamAttack = snapshot.attacks.some((attack) => {
			const attacker = sim.players[attack.attackerId - 1];
			const defender = sim.players[attack.defenderId - 1];
			return (
				attacker !== undefined &&
				defender !== undefined &&
				attacker.teamId !== 0 &&
				attacker.teamId === defender.teamId
			);
		});
		expect(sameTeamAttack).toBe(false);
	});

	it('selects committed strategic options deterministically', () => {
		const left = new TerritorySimulation({ seed: 424242 });
		const right = new TerritorySimulation({ seed: 424242 });
		for (let tick = 0; tick < 300; tick++) {
			left.step();
			right.step();
		}
		const leftOptions = left.players
			.filter((player) => player.isBot && player.alive)
			.map((player) => left.getBotOption(player.id));
		expect(leftOptions.some((option) => option !== null)).toBe(true);
		const telemetry = left.getBotBehaviorTelemetry();
		expect(Object.values(telemetry.optionSelections).some((count) => count > 0)).toBe(true);
		expect(left.checksum()).toBe(right.checksum());
		expect(left.getBotBehaviorTelemetry().optionSelections).toEqual(
			right.getBotBehaviorTelemetry().optionSelections
		);
	}, 15_000);

	it('records successful attack and defense reward metrics', () => {
		const sim = new TerritorySimulation({ seed: 1234 });
		for (let tick = 0; tick < 2500; tick++) sim.step();
		const metrics = sim.players.map((player) => sim.getPlayerBehaviorMetrics(player.id));
		const total = (key: keyof (typeof metrics)[number]): number =>
			metrics.reduce((sum, entry) => sum + entry[key], 0);
		expect(total('attacksVsWeakerStates')).toBeGreaterThan(0);
		expect(total('attacksRepelled')).toBeGreaterThan(0);
		expect(total('defenseDamage')).toBeGreaterThan(0);
		const erased = sim.players.filter((player) => !player.alive).length;
		expect(total('statesEliminated')).toBeGreaterThan(0);
		expect(total('statesEliminated')).toBeLessThanOrEqual(erased);
	}, 30_000);
});
