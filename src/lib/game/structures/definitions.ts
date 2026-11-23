import { ARTILLERY_DEFINITION } from './artillery';
import { BARRACKS_DEFINITION } from './barracks';
import { COMMAND_POST_DEFINITION } from './command-post';
import { FORTIFICATION_DEFINITION } from './fortification';
import { JAMMER_DEFINITION } from './jammer';
import { PORT_DEFINITION } from './port';
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
	'fortification',
	'command-post',
	'war-academy',
	'jammer',
	'port'
] as const satisfies readonly StructureType[];

/** Hand order is ascending card cost. */
export const BUILDABLE_STRUCTURE_TYPES = [
	'fortification',
	'war-academy',
	'command-post',
	'jammer',
	'port',
	'barracks',
	'artillery'
] as const satisfies readonly BuildableStructureType[];

export const STRUCTURE_DEFINITIONS: Record<StructureType, StructureDefinition> = {
	state: STATE_DEFINITION,
	artillery: ARTILLERY_DEFINITION,
	barracks: BARRACKS_DEFINITION,
	fortification: FORTIFICATION_DEFINITION,
	'command-post': COMMAND_POST_DEFINITION,
	'war-academy': WAR_ACADEMY_DEFINITION,
	jammer: JAMMER_DEFINITION,
	port: PORT_DEFINITION
};

export const STRUCTURE_TYPE_CODES: Record<StructureType, number> = {
	state: 1,
	artillery: 2,
	barracks: 3,
	fortification: 4,
	'command-post': 5,
	'war-academy': 6,
	jammer: 7,
	port: 8
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
			return 'fortification';
		case 5:
			return 'command-post';
		case 6:
			return 'war-academy';
		case 7:
			return 'jammer';
		case 8:
			return 'port';
		default:
			return null;
	}
}

export const STRUCTURE_ACCENTS: Record<StructureType, string> = {
	state: STATE_DEFINITION.accent,
	artillery: ARTILLERY_DEFINITION.accent,
	barracks: BARRACKS_DEFINITION.accent,
	fortification: FORTIFICATION_DEFINITION.accent,
	'command-post': COMMAND_POST_DEFINITION.accent,
	'war-academy': WAR_ACADEMY_DEFINITION.accent,
	jammer: JAMMER_DEFINITION.accent,
	port: PORT_DEFINITION.accent
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
