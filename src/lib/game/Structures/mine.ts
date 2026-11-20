import type { StructureDefinition } from './types';

export const MINE_SUPPLY_PER_SECOND = 1;

export const MINE_DEFINITION: StructureDefinition = {
	label: 'MINE',
	description: '+1 supply per second, paid continuously.',
	cost: 3,
	buildable: true,
	accent: '#f5b85c',
	districtRange: 32,
	effects: [{ kind: 'supply-income', perSecond: MINE_SUPPLY_PER_SECOND }]
};
