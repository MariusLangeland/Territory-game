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
		expect(mapPreset('compact')).toMatchObject({ width: 1536, height: 768 });
	});

	it('normalizes invalid or partial saved settings back to supported values', () => {
		const normalized = normalizeMatchSettings({
			states: 9999,
			mapPreset: 'moon' as never,
			difficulty: 'impossible' as never,
			growthMode: 'noise' as never,
			timerMinutes: 11
		});
		expect(normalized).toEqual(DEFAULT_MATCH_SETTINGS);
	});

	it('detects changed settings', () => {
		const changed = { ...DEFAULT_MATCH_SETTINGS, states: 8, timerMinutes: 10 };
		expect(matchSettingsEqual(DEFAULT_MATCH_SETTINGS, changed)).toBe(false);
		expect(matchSettingsEqual(DEFAULT_MATCH_SETTINGS, { ...DEFAULT_MATCH_SETTINGS })).toBe(true);
	});
});
