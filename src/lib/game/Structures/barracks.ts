import type { StructureDefinition } from './types';

export const BARRACKS_ORDER_BONUS = 1;

export const BARRACKS_DEFINITION: StructureDefinition = {
	label: 'BARRACKS',
	description: 'Your attacks now issue 1 extra order.',
	cost: 2,
	buildable: true,
	accent: '#ff7868',
	districtRange: 44,
	effects: [
		{
			kind: 'attack-order-bonus',
			amount: BARRACKS_ORDER_BONUS
		}
	]
};
