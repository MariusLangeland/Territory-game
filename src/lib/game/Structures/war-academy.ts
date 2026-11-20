import type { StructureDefinition } from './types';

export const WAR_ACADEMY_DEFINITION: StructureDefinition = {
	label: 'WAR ACADEMY',
	description: '+40 supply cap.',
	cost: 120,
	buildable: true,
	accent: '#c6a2ff',
	districtRange: 32,
	effects: [{ kind: 'supply-cap', amount: 40 }]
};
