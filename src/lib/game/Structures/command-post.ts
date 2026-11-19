import { COMMAND_POST_ORDER_TICKS } from '../constants';
import type { StructureDefinition } from './types';

export const COMMAND_POST_DEFINITION: StructureDefinition = {
	label: 'COMMAND POST',
	description: 'Gain +1 attack order every 60 seconds.',
	cost: 4,
	buildable: true,
	accent: '#95e07a',
	effects: [
		{
			kind: 'order-gain',
			intervalTicks: COMMAND_POST_ORDER_TICKS,
			amount: 1
		}
	]
};
