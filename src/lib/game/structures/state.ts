import type { StructureDefinition } from './types';

/** State capitals project a defensive field over nearby land. */
export const STATE_AURA_RADIUS = 16;
export const STATE_AURA_DEFENSE = 20;

export const STATE_DEFINITION: StructureDefinition = {
	label: 'STATE',
	description: 'Anchors protected territory; projects a +20 friendly-defense aura.',
	cost: 0,
	buildable: false,
	accent: '#f7eed0',
	// The capital is an aura anchor, not a district. A district-sized capital
	// would cover the whole starting territory and make cards unplayable.
	districtRange: 0,
	effects: [
		{
			kind: 'defense-aura',
			radius: STATE_AURA_RADIUS,
			defense: STATE_AURA_DEFENSE,
			stacking: 'max'
		}
	]
};
