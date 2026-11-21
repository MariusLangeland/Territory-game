import type { StructureDefinition } from './types';

export const PORT_DEFINITION: StructureDefinition = {
	label: 'PORT',
	description:
		'Naval landing port. Build on a shore; enables sea landings and protects sea-linked territory.',
	cost: 200,
	buildable: true,
	accent: '#58c7e8',
	// Ports are point anchors, not districts. This keeps them placeable on
	// narrow shores without a district covering the water or the whole coast.
	districtRange: 0,
	effects: [{ kind: 'port' }]
};
