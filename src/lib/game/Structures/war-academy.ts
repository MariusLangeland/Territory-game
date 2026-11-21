import type { StructureDefinition } from './types';

export const WAR_ACADEMY_DEFINITION: StructureDefinition = {
	label: 'WAR ACADEMY',
	description: '+80 supply cap.',
	cost: 60,
	buildable: true,
	accent: '#c6a2ff',
	districtRange: 32,
	effects: [{ kind: 'supply-cap', amount: 80 }]
};
