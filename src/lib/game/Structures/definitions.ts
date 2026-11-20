import { ARTILLERY_DEFINITION } from './artillery';
import { BARRACKS_DEFINITION } from './barracks';
import { COMMAND_POST_DEFINITION } from './command-post';
import { DEFENSE_POST_DEFINITION } from './defense-post';
import { STATE_DEFINITION } from './state';
import { WAR_ACADEMY_DEFINITION } from './war-academy';
import type {
	BuildableStructureType,
	StructureDefinition,
	StructureEffect,
	StructureType
} from './types';

export const STRUCTURE_TYPES = [
	'state',
	'artillery',
	'barracks',
	'defense-post',
	'command-post',
	'war-academy'
] as const satisfies readonly StructureType[];

export const BUILDABLE_STRUCTURE_TYPES = [
	'artillery',
	'barracks',
	'defense-post',
	'command-post',
	'war-academy'
] as const satisfies readonly BuildableStructureType[];

export const STRUCTURE_DEFINITIONS: Record<StructureType, StructureDefinition> = {
	state: STATE_DEFINITION,
	artillery: ARTILLERY_DEFINITION,
	barracks: BARRACKS_DEFINITION,
	'defense-post': DEFENSE_POST_DEFINITION,
	'command-post': COMMAND_POST_DEFINITION,
	'war-academy': WAR_ACADEMY_DEFINITION
};

export const STRUCTURE_TYPE_CODES: Record<StructureType, number> = {
	state: 1,
	artillery: 2,
	barracks: 3,
	'defense-post': 4,
	'command-post': 5,
	'war-academy': 6
};

export function structureTypeFromCode(code: number): StructureType | null {
	switch (code) {
		case 1:
			return 'state';
		case 2:
			return 'artillery';
		case 3:
			return 'barracks';
		case 4:
			return 'defense-post';
		case 5:
			return 'command-post';
		case 6:
			return 'war-academy';
		default:
			return null;
	}
}

export const STRUCTURE_ACCENTS: Record<StructureType, string> = {
	state: STATE_DEFINITION.accent,
	artillery: ARTILLERY_DEFINITION.accent,
	barracks: BARRACKS_DEFINITION.accent,
	'defense-post': DEFENSE_POST_DEFINITION.accent,
	'command-post': COMMAND_POST_DEFINITION.accent,
	'war-academy': WAR_ACADEMY_DEFINITION.accent
};

export function effectsForType(type: StructureType): readonly StructureEffect[] {
	return STRUCTURE_DEFINITIONS[type].effects;
}

export function costForType(type: StructureType): number {
	return STRUCTURE_DEFINITIONS[type].cost;
}

export function definitionForType(type: StructureType): StructureDefinition {
	return STRUCTURE_DEFINITIONS[type];
}
