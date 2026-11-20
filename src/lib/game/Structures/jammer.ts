import type { StructureDefinition } from './types';

/**
 * Global suppression aura: every enemy front attacking this owner loses one
 * effective Barracks level per Jammer level. It never raises pixel defense.
 */
export const JAMMER_SUPPRESSION_PER_LEVEL = 1;

export const JAMMER_DEFINITION: StructureDefinition = {
	label: 'JAMMER',
	description: 'Global aura: -1 effective enemy Barracks level per stack.',
	cost: 8,
	buildable: true,
	accent: '#7be0c0',
	districtRange: 32,
	effects: [
		{
			kind: 'barracks-suppression',
			amount: JAMMER_SUPPRESSION_PER_LEVEL
		}
	]
};
