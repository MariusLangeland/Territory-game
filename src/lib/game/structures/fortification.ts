import type { StructureDefinition } from './types';

/** Kept for the shared effect shape; district coverage ignores radius entirely. */
export const FORTIFICATION_AURA_RADIUS = 0;
export const FORTIFICATION_DEFENSE = 1;

export const FORTIFICATION_DEFINITION: StructureDefinition = {
	label: 'FORTIFICATION',
	description: '+1 defense to every friendly pixel in its district.',
	cost: 30,
	buildable: true,
	accent: '#63c6d7',
	districtRange: 40,
	effects: [
		{
			kind: 'defense-aura',
			radius: FORTIFICATION_AURA_RADIUS,
			defense: FORTIFICATION_DEFENSE,
			stacking: 'add'
		}
	]
};
