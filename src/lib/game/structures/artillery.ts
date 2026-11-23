import {
	ARTILLERY_COOLDOWN_TICKS,
	ARTILLERY_RANGE,
	ARTILLERY_SUPPLY_COST_PER_LEVEL,
	TICK_RATE
} from '../constants';
import type { StructureDefinition } from './types';

export const ARTILLERY_DEFINITION: StructureDefinition = {
	label: 'ARTILLERY',
	description: `Active: inaccurate barrage, 1 shell per level within 140 px. Each shell costs ${ARTILLERY_SUPPLY_COST_PER_LEVEL} supply and cannot destroy a State.`,
	cost: 1000,
	buildable: true,
	accent: '#ff9b5a',
	districtRange: 64,
	effects: [
		{
			kind: 'artillery',
			range: ARTILLERY_RANGE,
			cooldownTicks: ARTILLERY_COOLDOWN_TICKS,
			shellsPerLevel: 1,
			supplyCostPerLevel: ARTILLERY_SUPPLY_COST_PER_LEVEL,
			cooldownSeconds: ARTILLERY_COOLDOWN_TICKS / TICK_RATE
		}
	]
};
