import type { MatchSettings } from '#lib/game/match-config';

export type RoomStatus = 'open' | 'running' | 'closed';

export interface RoomDefinition {
	id: string;
	databaseName: string;
	name: string;
	classification: string;
	description: string;
	rules: readonly string[];
	settings: MatchSettings;
	seed: number;
	accent: string;
	status: RoomStatus;
}

export function roomBotCount(room: RoomDefinition): number {
	return Math.max(0, room.settings.states - 1);
}

export function roomSeedLabel(room: RoomDefinition): string {
	return room.seed.toString(16).toUpperCase().padStart(8, '0');
}
