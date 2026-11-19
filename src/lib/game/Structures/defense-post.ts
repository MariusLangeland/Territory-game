import type { StructureDefinition } from './types';

/** Kept for the shared effect shape; district coverage ignores radius entirely. */
export const DEFENSE_POST_AURA_RADIUS = 0;
export const DEFENSE_POST_DEFENSE = 5;

export const DEFENSE_POST_DEFINITION: StructureDefinition = {
	label: 'DEFENSE POST',
	description: '+5 defense to every friendly pixel in its district.',
	cost: 2,
	buildable: true,
	accent: '#63c6d7',
	districtRange: 40,
	effects: [
		{
			kind: 'defense-aura',
			radius: DEFENSE_POST_AURA_RADIUS,
			defense: DEFENSE_POST_DEFENSE,
			stacking: 'add'
		}
	]
};
