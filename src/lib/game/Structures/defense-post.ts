import type { StructureDefinition } from './types';

export const DEFENSE_POST_AURA_RADIUS = 16;
export const DEFENSE_POST_DEFENSE = 5;

export const DEFENSE_POST_DEFINITION: StructureDefinition = {
	label: 'DEFENSE POST',
	description: '+5 defense to friendly pixels in a medium radius.',
	cost: 2,
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
