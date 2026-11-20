import { ARTILLERY_COOLDOWN_TICKS, ARTILLERY_RANGE, TICK_RATE } from '../constants';
import type { StructureDefinition } from './types';

export const ARTILLERY_DEFINITION: StructureDefinition = {
	label: 'ARTILLERY',
	description:
		'Active: fires 1 shell per level at a point within 140 px. Each shell damages a structure.',
	cost: 6,
	buildable: true,
	accent: '#ff9b5a',
	districtRange: 32,
	effects: [
		{
			kind: 'artillery',
			range: ARTILLERY_RANGE,
			cooldownTicks: ARTILLERY_COOLDOWN_TICKS,
			shellsPerLevel: 1,
			cooldownSeconds: ARTILLERY_COOLDOWN_TICKS / TICK_RATE
		}
	]
};
