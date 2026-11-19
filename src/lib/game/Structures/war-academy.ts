import type { StructureDefinition } from './types';

export const WAR_ACADEMY_DEFINITION: StructureDefinition = {
	label: 'WAR ACADEMY',
	description: 'Increase the attack-order cap by 1.',
	cost: 6,
	buildable: true,
	accent: '#c6a2ff',
	districtRange: 32,
	effects: [{ kind: 'order-cap', amount: 1 }]
};
