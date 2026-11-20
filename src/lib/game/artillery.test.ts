import { describe, expect, it } from 'vitest';
import {
	ARTILLERY_COOLDOWN_TICKS,
	ARTILLERY_RANGE,
	ARTILLERY_SHELL_TRAVEL_TICKS,
	ARTILLERY_SUPPLY_COST_PER_SHELL,
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

describe('artillery active ability', () => {
	it('is expensive to build and fire', () => {
		expect(ARTILLERY_DEFINITION.cost).toBe(30);
		expect(ARTILLERY_SUPPLY_COST_PER_SHELL).toBe(12);

		const sim = new TerritorySimulation({ seed: 700001 });
		const { target } = createBattery(sim);
		sim.gold = ARTILLERY_SUPPLY_COST_PER_SHELL - 1;
		const poor = sim.enqueueArtillery(HUMAN_PLAYER_ID, target.x, target.y);
		expect(poor.ok).toBe(false);
		expect(poor.reason).toBe('no-supply');

		sim.gold = ARTILLERY_SUPPLY_COST_PER_SHELL;
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

	it('fires one shell per level and removes one level per hit', () => {
		const sim = new TerritorySimulation({ seed: 700002 });
		const { battery, target } = createBattery(sim);
		sim.structures.setStacks(battery, 3);
		sim.structures.setStacks(target, 5);

		const result = sim.enqueueArtillery(HUMAN_PLAYER_ID, target.x, target.y);
		expect(result.ok).toBe(true);
		const step = sim.step();
		expect(step.snapshot.shells).toHaveLength(3);
		expect(step.snapshot.structures.find((entry) => entry.id === battery.id)?.readyAtTick).toBe(61);

		for (let tick = 0; tick <= ARTILLERY_SHELL_TRAVEL_TICKS; tick++) sim.step();
		expect(
			sim.getSnapshot().shells.filter((shell) => shell.ownerId === HUMAN_PLAYER_ID)
		).toHaveLength(0);
		expect(sim.structures.byId(target.id)?.stacks).toBe(2);
	});

	it('destroys a structure whose last level is hit', () => {
		const sim = new TerritorySimulation({ seed: 700003 });
		const { target } = createBattery(sim);
		expect(target.stacks).toBe(1);

		expect(sim.enqueueArtillery(HUMAN_PLAYER_ID, target.x, target.y).ok).toBe(true);
		sim.step();
		for (let tick = 0; tick <= ARTILLERY_SHELL_TRAVEL_TICKS; tick++) sim.step();
		expect(sim.structures.byId(target.id)).toBeUndefined();
	});

	it('enforces range and cooldown', () => {
		const sim = new TerritorySimulation({ seed: 700004 });
		const { battery, target } = createBattery(sim);
		const far = battery.x + ARTILLERY_RANGE + 20;
		expect(sim.enqueueArtillery(HUMAN_PLAYER_ID, far, battery.y).ok).toBe(false);
		expect(sim.enqueueArtillery(HUMAN_PLAYER_ID, far, battery.y).reason).toBe('out-of-range');

		expect(sim.enqueueArtillery(HUMAN_PLAYER_ID, target.x, target.y).ok).toBe(true);
		sim.step();
		expect(sim.validateArtillery(HUMAN_PLAYER_ID, target.x, target.y).reason).toBe('cooling');
		for (let tick = 0; tick < ARTILLERY_COOLDOWN_TICKS; tick++) sim.step();
		expect(sim.validateArtillery(HUMAN_PLAYER_ID, target.x, target.y).ok).toBe(true);
	});

	it('replays identical artillery volleys deterministically', () => {
		const run = (): number => {
			const sim = new TerritorySimulation({ seed: 700006 });
			const { target } = createBattery(sim);
			sim.structures.setStacks(target, 4);
			expect(sim.enqueueArtillery(HUMAN_PLAYER_ID, target.x, target.y).ok).toBe(true);
			for (let tick = 0; tick <= ARTILLERY_SHELL_TRAVEL_TICKS + 5; tick++) sim.step();
			return sim.checksum();
		};
		expect(run()).toBe(run());
	});

	it('lets bots fire artillery at hostile structures', () => {
		const sim = new TerritorySimulation({ seed: 700005 });
		const capital = sim.structures.forOwnerType(2, 'state');
		expect(capital).toBeDefined();
		if (!capital) return;
		sim.structures.create('artillery', 2, capital.x, capital.y, sim.width);
		sim.structures.create('barracks', HUMAN_PLAYER_ID, capital.x + 40, capital.y, sim.width);
		const internals = sim as unknown as { artilleryShells: ArtilleryShell[] };
		for (let tick = 0; tick < 20; tick++) sim.step();
		expect(sim.getSnapshot().shells.length).toBeGreaterThan(0);
		expect(internals.artilleryShells.length).toBeGreaterThan(0);
	});
});
