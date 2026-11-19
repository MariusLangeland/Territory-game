import type { StructureDefinition } from './types';

export const DEFENSE_POST_AURA_RADIUS = 8;
export const DEFENSE_POST_DEFENSE = 1;

export const DEFENSE_POST_DEFINITION: StructureDefinition = {
	label: 'DEFENSE POST',
	description: '+1 pixel defense in a medium radius.',
	cost: 1,
	buildable: true,
	accent: '#63c6d7',
	effects: [
		{
			kind: 'defense-aura',
			radius: DEFENSE_POST_AURA_RADIUS,
			defense: DEFENSE_POST_DEFENSE,
			stacking: 'add'
		}
	]
};
