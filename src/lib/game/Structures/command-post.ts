import type { StructureDefinition } from './types';

export const COMMAND_POST_SUPPLY_PER_SECOND = 2;

export const COMMAND_POST_DEFINITION: StructureDefinition = {
	label: 'COMMAND POST',
	description: '+2 supply per second, paid continuously.',
	cost: 4,
	buildable: true,
	accent: '#95e07a',
	districtRange: 32,
	effects: [{ kind: 'supply-income', perSecond: COMMAND_POST_SUPPLY_PER_SECOND }]
};
