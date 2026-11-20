import { describe, expect, it } from 'vitest';
import {
	ARTILLERY_BLAST_RADIUS,
	ARTILLERY_COOLDOWN_TICKS,
	ARTILLERY_RANGE,
	ARTILLERY_SHELL_TRAVEL_TICKS,
	ARTILLERY_SUPPLY_COST_PER_LEVEL,
	HUMAN_PLAYER_ID
} from './constants';
import { ARTILLERY_DEFINITION, type Structure } from './Structures';
import { TerritorySimulation, type ArtilleryShell } from './simulation';

function createBattery(sim: TerritorySimulation): {
	battery: Structure;
	target: Structure;
} {
	const capital = sim.structures.forOwnerType(HUMAN_PLAYER_ID, 'state');
	expect(capital).toBeDefined();
	if (!capital) throw new Error('missing capital');
	const x = Math.min(sim.width - 1, capital.x + 20);
	const y = capital.y;
	const battery = sim.structures.create('artillery', HUMAN_PLAYER_ID, x, y, sim.width);
	const target = sim.structures.create('barracks', 2, x + 50, y, sim.width);
	return { battery, target };
}

function impact(
	sim: TerritorySimulation,
	ownerId: number,
	from: Structure,
	target: Structure
): void {
	const internals = sim as unknown as {
		resolveArtilleryImpact(shell: ArtilleryShell): void;
	};
	internals.resolveArtilleryImpact({
		id: 999_999,
		ownerId,
		fromX: from.x,
		fromY: from.y,
		targetX: target.x,
		targetY: target.y,
		launchedAtTick: sim.tick,
		arriveAtTick: sim.tick
	});
}

describe('artillery active ability', () => {
	it('is expensive to build and fire', () => {
		expect(ARTILLERY_DEFINITION.cost).toBe(1000);
		expect(ARTILLERY_SUPPLY_COST_PER_LEVEL).toBe(300);

		const sim = new TerritorySimulation({ seed: 700001 });
		const { target } = createBattery(sim);
		sim.gold = ARTILLERY_SUPPLY_COST_PER_LEVEL - 1;
		const poor = sim.enqueueArtillery(HUMAN_PLAYER_ID, target.x, target.y);
		expect(poor.ok).toBe(false);
		expect(poor.reason).toBe('no-supply');

		sim.gold = ARTILLERY_SUPPLY_COST_PER_LEVEL;
		expect(sim.enqueueArtillery(HUMAN_PLAYER_ID, target.x, target.y).ok).toBe(true);
		sim.step();
		expect(sim.gold).toBe(0);
	});

	it('rejects firing without a battery', () => {
		const sim = new TerritorySimulation({ seed: 700001 });
		const result = sim.enqueueArtillery(HUMAN_PLAYER_ID, 10, 10);
		expect(result.ok).toBe(false);
		expect(result.reason).toBe('no-artillery');
	});

	it('fires one shell per level and replays deterministically', () => {
		const run = (): number => {
			const sim = new TerritorySimulation({ seed: 700002 });
			const { battery, target } = createBattery(sim);
			sim.structures.setStacks(battery, 3);
			sim.gold = 10_000;
			expect(sim.enqueueArtillery(HUMAN_PLAYER_ID, target.x, target.y).ok).toBe(true);
			const step = sim.step();
			expect(step.snapshot.shells.filter((shell) => shell.ownerId === 1)).toHaveLength(3);
			for (let tick = 0; tick <= ARTILLERY_SHELL_TRAVEL_TICKS + 5; tick++) sim.step();
			return sim.checksum();
		};
		expect(run()).toBe(run());
	});

	it('is intentionally inaccurate', () => {
		const sim = new TerritorySimulation({ seed: 700007 });
		const { battery, target } = createBattery(sim);
		sim.structures.setStacks(battery, 10);
		sim.gold = 10_000;
		expect(sim.enqueueArtillery(HUMAN_PLAYER_ID, target.x, target.y).ok).toBe(true);
		const shells = sim.step().snapshot.shells.filter((shell) => shell.ownerId === 1);
		expect(shells).toHaveLength(10);
		const misses = shells.filter((shell) => {
			const dx = shell.targetX - target.x;
			const dy = shell.targetY - target.y;
			return dx * dx + dy * dy > ARTILLERY_BLAST_RADIUS * ARTILLERY_BLAST_RADIUS;
		});
		expect(misses.length).toBeGreaterThan(0);
	});

	it('removes one level per direct impact and destroys level 1', () => {
		const sim = new TerritorySimulation({ seed: 700003 });
		const { battery, target } = createBattery(sim);
		sim.structures.setStacks(target, 2);
		impact(sim, HUMAN_PLAYER_ID, battery, target);
		expect(sim.structures.byId(target.id)?.stacks).toBe(1);
		impact(sim, HUMAN_PLAYER_ID, battery, target);
		expect(sim.structures.byId(target.id)).toBeUndefined();
	});

	it('cannot damage a State structure', () => {
		const sim = new TerritorySimulation({ seed: 700008 });
		const { battery } = createBattery(sim);
		const state = sim.structures.create('state', 2, battery.x + 30, battery.y, sim.width);
		impact(sim, HUMAN_PLAYER_ID, battery, state);
		expect(sim.structures.byId(state.id)).toBeDefined();
	});

	it('enforces range and cooldown', () => {
		const sim = new TerritorySimulation({ seed: 700004 });
		const { battery, target } = createBattery(sim);
		const far = battery.x + ARTILLERY_RANGE + 20;
		expect(sim.enqueueArtillery(HUMAN_PLAYER_ID, far, battery.y).ok).toBe(false);
		expect(sim.enqueueArtillery(HUMAN_PLAYER_ID, far, battery.y).reason).toBe('out-of-range');

		const capital = sim.structures.forOwnerType(HUMAN_PLAYER_ID, 'state');
		expect(capital).toBeDefined();
		if (!capital) return;
		for (let level = 0; level < 15; level++) {
			sim.structures.create(
				'war-academy',
				HUMAN_PLAYER_ID,
				capital.x + level,
				capital.y + 2,
				sim.width
			);
		}
		sim.gold = 700;
		expect(sim.enqueueArtillery(HUMAN_PLAYER_ID, target.x, target.y).ok).toBe(true);
		sim.step();
		expect(sim.validateArtillery(HUMAN_PLAYER_ID, target.x, target.y).reason).toBe('cooling');
		sim.tick += ARTILLERY_COOLDOWN_TICKS;
		expect(sim.validateArtillery(HUMAN_PLAYER_ID, target.x, target.y).ok).toBe(true);
	});

	it('lets bots fire artillery at hostile structures', () => {
		const sim = new TerritorySimulation({ seed: 700005 });
		const capital = sim.structures.forOwnerType(2, 'state');
		expect(capital).toBeDefined();
		if (!capital) return;
		sim.structures.create('artillery', 2, capital.x, capital.y, sim.width);
		sim.structures.create('barracks', HUMAN_PLAYER_ID, capital.x + 40, capital.y, sim.width);
		for (let level = 0; level < 10; level++) {
			sim.structures.create('war-academy', 2, capital.x + 10 + level, capital.y + 10, sim.width);
		}
		(sim as unknown as { botGold: number[] }).botGold[1] = 500;
		const internals = sim as unknown as { artilleryShells: ArtilleryShell[] };
		for (let tick = 0; tick < 20; tick++) sim.step();
		expect(sim.getSnapshot().shells.length).toBeGreaterThan(0);
		expect(internals.artilleryShells.length).toBeGreaterThan(0);
	});
});
