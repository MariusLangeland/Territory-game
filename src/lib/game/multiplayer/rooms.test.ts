import { describe, expect, it } from 'vitest';
import { normalizeMatchSettings, STATE_COUNT_OPTIONS } from '../match-config';
import { LOCAL_ROOMS, roomBotCount, roomSeedLabel } from './rooms';

describe('local multiplayer rooms', () => {
	it('offers a small set of distinct rooms', () => {
		expect(LOCAL_ROOMS.length).toBeGreaterThanOrEqual(3);
		expect(LOCAL_ROOMS.length).toBeLessThanOrEqual(4);
		expect(new Set(LOCAL_ROOMS.map((room) => room.id)).size).toBe(LOCAL_ROOMS.length);
		expect(new Set(LOCAL_ROOMS.map((room) => room.seed)).size).toBe(LOCAL_ROOMS.length);
	});

	it('keeps every room inside the supported match configuration', () => {
		for (const room of LOCAL_ROOMS) {
			expect(STATE_COUNT_OPTIONS).toContain(room.settings.states as never);
			expect(normalizeMatchSettings(room.settings)).toEqual(room.settings);
			expect(room.humans).toBe(1);
			expect(roomBotCount(room)).toBe(room.settings.states - room.humans);
			expect(room.rules.length).toBeGreaterThan(0);
		}
	});

	it('formats room seeds as eight uppercase hex digits', () => {
		for (const room of LOCAL_ROOMS) {
			expect(roomSeedLabel(room)).toMatch(/^[0-9A-F]{8}$/);
		}
	});
});
