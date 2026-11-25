import type { MatchSettings } from '../match-config';

export interface LocalRoomDefinition {
	id: string;
	name: string;
	classification: string;
	description: string;
	rules: readonly string[];
	settings: MatchSettings;
	seed: number;
	/** Human seats reserved in this prototype. */
	humans: number;
	accent: string;
	/** Present when the card came from the Spacetime room directory. */
	databaseName?: string;
	status?: 'open' | 'running' | 'closed';
}

export const LOCAL_ROOMS: readonly LocalRoomDefinition[] = [
	{
		id: 'border-skirmish',
		name: 'BORDER SKIRMISH',
		classification: 'TRAINING / COMPACT',
		description:
			'A compact frontier with a short opening. Seven bots contest a small atlas without a match clock.',
		rules: ['NO MATCH TIMER', 'STANDARD BOT ECONOMY', 'FAST OPENING'],
		settings: {
			states: 8,
			mapPreset: 'compact',
			mapWidth: 1536,
			mapHeight: 768,
			difficulty: 'relaxed',
			timerMinutes: 0,
			botCommandPostStacks: 0
		},
		seed: 0x51a7e,
		humans: 1,
		accent: '#7ed6c8'
	},
	{
		id: 'supply-siege',
		name: 'SUPPLY SIEGE',
		classification: 'ECONOMY / 20 MIN',
		description:
			'A mid-sized contested atlas. Fifteen bots lean into the economy while the clock forces a decision.',
		rules: ['20 MINUTE LIMIT', 'DENSE MIDFIELD', 'STANDARD BOT ECONOMY'],
		settings: {
			states: 16,
			mapPreset: 'compact',
			mapWidth: 2048,
			mapHeight: 1024,
			difficulty: 'standard',
			timerMinutes: 20,
			botCommandPostStacks: 0
		},
		seed: 0x5e9e,
		humans: 1,
		accent: '#e0c27a'
	},
	{
		id: 'iron-tide',
		name: 'IRON TIDE',
		classification: 'SIEGE / RUTHLESS',
		description:
			'A large battlefield with fortified bot economies. Twenty-three bots begin with a supply surge.',
		rules: ['30 MINUTE LIMIT', 'BOTS START WITH 500 CP', 'RUTHLESS PRESSURE'],
		settings: {
			states: 24,
			mapPreset: 'clash',
			mapWidth: 2560,
			mapHeight: 1440,
			difficulty: 'ruthless',
			timerMinutes: 30,
			botCommandPostStacks: 500
		},
		seed: 0x1f0e,
		humans: 1,
		accent: '#e88972'
	},
	{
		id: 'total-front',
		name: 'TOTAL FRONT',
		classification: 'TOTAL WAR / 51 STATES',
		description:
			'The full roster. Fifty bots, a dense atlas, and a supply surge make this a long attrition match.',
		rules: ['51 STATES', 'BOTS START WITH 500 CP', 'RUTHLESS PRESSURE'],
		settings: {
			states: 51,
			mapPreset: 'compact',
			mapWidth: 2048,
			mapHeight: 1024,
			difficulty: 'ruthless',
			timerMinutes: 0,
			botCommandPostStacks: 500
		},
		seed: 0x70a1f,
		humans: 1,
		accent: '#b7a4ff'
	}
];

export function roomBotCount(room: LocalRoomDefinition): number {
	return Math.max(0, room.settings.states - room.humans);
}

export function roomSeedLabel(room: LocalRoomDefinition): string {
	return room.seed.toString(16).toUpperCase().padStart(8, '0');
}
