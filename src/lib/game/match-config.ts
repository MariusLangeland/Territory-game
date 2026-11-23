import { MAX_MAP_CELLS, MAX_MAP_DIMENSION, MIN_MAP_HEIGHT, MIN_MAP_WIDTH } from './constants';
import type { BotDifficulty } from './simulation';

export type MapPresetId = 'standard' | 'compact' | 'clash';

export interface MapPreset {
	id: MapPresetId;
	label: string;
	width: number;
	height: number;
}

export const MAP_PRESETS: readonly MapPreset[] = [
	{ id: 'standard', label: 'STANDARD · 4096×2048', width: 4096, height: 2048 },
	{ id: 'compact', label: 'COMPACT · 3072×1536', width: 3072, height: 1536 },
	{ id: 'clash', label: 'CLASH · 2560×1440', width: 2560, height: 1440 }
] as const;

export const STATE_COUNT_OPTIONS = [8, 16, 24, 32, 51] as const;

export const BOT_DIFFICULTY_OPTIONS: readonly {
	id: BotDifficulty;
	label: string;
	detail: string;
}[] = [
	{ id: 'relaxed', label: 'RELAXED', detail: 'slower bot economy and attacks' },
	{ id: 'standard', label: 'STANDARD', detail: 'baseline deterministic AI' },
	{ id: 'ruthless', label: 'RUTHLESS', detail: 'more frequent bot attacks' }
] as const;

export const TIMER_OPTIONS = [0, 10, 20, 30] as const;

/** Optional starting Command Post stack grant for every AI seat. */
export const BOT_COMMAND_POST_STACK_OPTIONS = [0, 500] as const;

export interface MatchSettings {
	states: number;
	mapPreset: MapPresetId;
	/** Arbitrary rectangular atlas size; validated against the map limits. */
	mapWidth: number;
	mapHeight: number;
	difficulty: BotDifficulty;
	timerMinutes: number;
	botCommandPostStacks: number;
}

export const DEFAULT_MATCH_SETTINGS: MatchSettings = {
	states: 51,
	mapPreset: 'standard',
	mapWidth: 4096,
	mapHeight: 2048,
	difficulty: 'standard',
	timerMinutes: 0,
	botCommandPostStacks: 0
};

const STORAGE_KEY = 'territory.match-settings.v1';

export function mapPreset(id: MapPresetId): MapPreset {
	return MAP_PRESETS.find((preset) => preset.id === id) ?? MAP_PRESETS[0];
}

export function normalizeMatchSettings(value: Partial<MatchSettings> | null): MatchSettings {
	const states = STATE_COUNT_OPTIONS.includes(value?.states as (typeof STATE_COUNT_OPTIONS)[number])
		? (value?.states ?? DEFAULT_MATCH_SETTINGS.states)
		: DEFAULT_MATCH_SETTINGS.states;
	const mapPresetId = MAP_PRESETS.some((preset) => preset.id === value?.mapPreset)
		? (value?.mapPreset ?? DEFAULT_MATCH_SETTINGS.mapPreset)
		: DEFAULT_MATCH_SETTINGS.mapPreset;
	const preset = mapPreset(mapPresetId);
	const dimension = (candidate: number | undefined, fallback: number, minimum: number): number =>
		Number.isSafeInteger(candidate) &&
		(candidate ?? 0) >= minimum &&
		(candidate ?? 0) <= MAX_MAP_DIMENSION
			? Number(candidate)
			: fallback;
	let mapWidth = dimension(value?.mapWidth, preset.width, MIN_MAP_WIDTH);
	let mapHeight = dimension(value?.mapHeight, preset.height, MIN_MAP_HEIGHT);
	if (mapWidth * mapHeight > MAX_MAP_CELLS) {
		mapWidth = preset.width;
		mapHeight = preset.height;
	}
	const difficulty = BOT_DIFFICULTY_OPTIONS.some((option) => option.id === value?.difficulty)
		? (value?.difficulty ?? DEFAULT_MATCH_SETTINGS.difficulty)
		: DEFAULT_MATCH_SETTINGS.difficulty;
	const timerMinutes = TIMER_OPTIONS.includes(value?.timerMinutes as (typeof TIMER_OPTIONS)[number])
		? (value?.timerMinutes ?? DEFAULT_MATCH_SETTINGS.timerMinutes)
		: DEFAULT_MATCH_SETTINGS.timerMinutes;
	const botCommandPostStacks = BOT_COMMAND_POST_STACK_OPTIONS.includes(
		value?.botCommandPostStacks as (typeof BOT_COMMAND_POST_STACK_OPTIONS)[number]
	)
		? (value?.botCommandPostStacks ?? DEFAULT_MATCH_SETTINGS.botCommandPostStacks)
		: DEFAULT_MATCH_SETTINGS.botCommandPostStacks;
	return {
		states,
		mapPreset: mapPresetId,
		mapWidth,
		mapHeight,
		difficulty,
		timerMinutes,
		botCommandPostStacks
	};
}

export function loadMatchSettings(): MatchSettings {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		return raw ? normalizeMatchSettings(JSON.parse(raw)) : { ...DEFAULT_MATCH_SETTINGS };
	} catch {
		return { ...DEFAULT_MATCH_SETTINGS };
	}
}

export function saveMatchSettings(settings: MatchSettings): void {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
	} catch {
		// Storage may be unavailable in private/sandboxed contexts.
	}
}

export function matchSettingsEqual(left: MatchSettings, right: MatchSettings): boolean {
	return (
		left.states === right.states &&
		left.mapPreset === right.mapPreset &&
		left.mapWidth === right.mapWidth &&
		left.mapHeight === right.mapHeight &&
		left.difficulty === right.difficulty &&
		left.timerMinutes === right.timerMinutes &&
		left.botCommandPostStacks === right.botCommandPostStacks
	);
}
