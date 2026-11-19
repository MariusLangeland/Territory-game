import type { StructureDefinition } from './types';

export const BARRACKS_AURA_RADIUS = 18;
export const BARRACKS_ATTACK_STRENGTH = 1;

export const BARRACKS_DEFINITION: StructureDefinition = {
	label: 'BARRACKS',
	description: 'Friendly attacks ignore 1 defense in a large radius.',
	cost: 2,
	buildable: true,
	accent: '#ff7868',
	districtRange: 44,
	effects: [
		{
			kind: 'attack-aura',
			radius: BARRACKS_AURA_RADIUS,
			strength: BARRACKS_ATTACK_STRENGTH
		}
	]
};
