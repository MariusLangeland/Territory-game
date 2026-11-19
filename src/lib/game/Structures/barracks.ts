import type { StructureDefinition } from './types';

export const BARRACKS_ORDER_BONUS = 1;
/** Every two Barracks levels grant one embedded order, capped at five. */
export const BARRACKS_LEVELS_PER_ORDER = 2;
export const BARRACKS_MAX_BONUS_ORDERS = 5;

export const BARRACKS_DEFINITION: StructureDefinition = {
	label: 'BARRACKS',
	description: '+1 embedded attack order per two levels, up to +5.',
	cost: 12,
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
