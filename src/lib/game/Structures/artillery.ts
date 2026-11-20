import {
	ARTILLERY_COOLDOWN_TICKS,
	ARTILLERY_RANGE,
	ARTILLERY_SUPPLY_COST_PER_SHELL,
	TICK_RATE
} from '../constants';
import type { StructureDefinition } from './types';

export const ARTILLERY_DEFINITION: StructureDefinition = {
	label: 'ARTILLERY',
	description: `Active: fires 1 shell per level at a point within 140 px. Each shell costs ${ARTILLERY_SUPPLY_COST_PER_SHELL} supply and damages a structure.`,
	cost: 30,
	buildable: true,
	accent: '#ff9b5a',
	districtRange: 32,
	effects: [
		{
			kind: 'artillery',
			range: ARTILLERY_RANGE,
			cooldownTicks: ARTILLERY_COOLDOWN_TICKS,
			shellsPerLevel: 1,
			supplyCostPerShell: ARTILLERY_SUPPLY_COST_PER_SHELL,
			cooldownSeconds: ARTILLERY_COOLDOWN_TICKS / TICK_RATE
		}
	]
};
