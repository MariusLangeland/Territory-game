import { describe, expect, it } from 'vitest';
import {
	DEFAULT_MATCH_SETTINGS,
	MAP_PRESETS,
	STATE_COUNT_OPTIONS,
	mapPreset,
	matchSettingsEqual,
	normalizeMatchSettings
} from './match-config';

describe('match settings', () => {
	it('provides deterministic presets and state-count options', () => {
		expect(STATE_COUNT_OPTIONS).toContain(51);
		expect(MAP_PRESETS.map((preset) => preset.id)).toEqual(['standard', 'compact', 'clash']);
		expect(mapPreset('compact')).toMatchObject({ width: 3072, height: 1536 });
	});

	it('normalizes invalid or partial saved settings back to supported values', () => {
		const normalized = normalizeMatchSettings({
			states: 9999,
			mapPreset: 'moon' as never,
			difficulty: 'impossible' as never,
			timerMinutes: 11
		});
		expect(normalized).toEqual(DEFAULT_MATCH_SETTINGS);
	});

	it('accepts arbitrary valid atlas dimensions and rejects unsafe ones', () => {
		expect(normalizeMatchSettings({ mapWidth: 3000, mapHeight: 2000 })).toMatchObject({
			mapWidth: 3000,
			mapHeight: 2000
		});
		expect(normalizeMatchSettings({ mapWidth: 99999, mapHeight: 2000 })).toMatchObject({
			mapWidth: DEFAULT_MATCH_SETTINGS.mapWidth,
			mapHeight: 2000
		});
		expect(normalizeMatchSettings({ mapWidth: 8192, mapHeight: 8192 })).toMatchObject({
			mapWidth: 8192,
			mapHeight: 8192
		});
		expect(normalizeMatchSettings({ mapWidth: 8192, mapHeight: 8256 })).toMatchObject({
			mapWidth: 8192,
			mapHeight: DEFAULT_MATCH_SETTINGS.mapHeight
		});
	});

	it('detects changed settings', () => {
		const changed = { ...DEFAULT_MATCH_SETTINGS, states: 8, timerMinutes: 10 };
		expect(matchSettingsEqual(DEFAULT_MATCH_SETTINGS, changed)).toBe(false);
		expect(matchSettingsEqual(DEFAULT_MATCH_SETTINGS, { ...DEFAULT_MATCH_SETTINGS })).toBe(true);
	});

	it('ignores legacy growth-mode settings after locking the match to organic', () => {
		const normalized = normalizeMatchSettings({ growthMode: 'organic' } as never);
		expect(normalized).toEqual(DEFAULT_MATCH_SETTINGS);
		expect('growthMode' in normalized).toBe(false);
	});

	it('normalizes and compares the bot command-post modifier', () => {
		const surged = normalizeMatchSettings({ botCommandPostStacks: 500 });
		expect(surged.botCommandPostStacks).toBe(500);
		expect(
			normalizeMatchSettings({ botCommandPostStacks: 123 as never }).botCommandPostStacks
		).toBe(0);
		expect(matchSettingsEqual(DEFAULT_MATCH_SETTINGS, surged)).toBe(false);
	});
});
