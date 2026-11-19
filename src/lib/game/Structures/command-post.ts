import { COMMAND_POST_ORDER_TICKS } from '../constants';
import type { StructureDefinition } from './types';

export const COMMAND_POST_DEFINITION: StructureDefinition = {
	label: 'COMMAND POST',
	description: '+1 attack order per 60 seconds, paid continuously.',
	cost: 4,
	buildable: true,
	accent: '#95e07a',
	districtRange: 32,
	effects: [
		{
			kind: 'order-gain',
			intervalTicks: COMMAND_POST_ORDER_TICKS,
			amount: 1
		}
	]
};
