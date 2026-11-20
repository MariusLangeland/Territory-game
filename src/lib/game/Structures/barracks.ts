import type { StructureDefinition } from './types';

/**
 * Each Barracks level adds attack strength and launch cost linearly, while
 * speed and defense piercing use an integer log2 curve (`logTier`).
 */
export const BARRACKS_POWER_PER_LEVEL = 1;

export const BARRACKS_DEFINITION: StructureDefinition = {
	label: 'BARRACKS',
	description:
		'+1 attack strength level. Attack cost rises by 15; speed and piercing use log2 scaling.',
	cost: 240,
	buildable: true,
	accent: '#ff7868',
	districtRange: 44,
	effects: [
		{
			kind: 'barracks-power',
			amount: BARRACKS_POWER_PER_LEVEL
		}
	]
};
