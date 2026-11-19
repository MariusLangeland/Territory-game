import type { StructureDefinition } from './types';

export const MINE_INCOME_PER_INTERVAL = 1;

export const MINE_DEFINITION: StructureDefinition = {
	label: 'MINE',
	description: '+1 income every 10 seconds.',
	cost: 3,
	buildable: true,
	accent: '#f5b85c',
	effects: [{ kind: 'income', goldPerInterval: MINE_INCOME_PER_INTERVAL }]
};
