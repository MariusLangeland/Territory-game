import { describe, expect, it } from 'vitest';
import { parseSeed, randomSeed, seedHexFor } from './seed';

describe('seed helpers', () => {
	it('parses hexadecimal seed input', () => {
		expect(parseSeed('1234')).toBe(0x1234);
		expect(parseSeed('0x1234')).toBe(0x1234);
		expect(parseSeed('  DEADBEEF ')).toBe(0xdeadbeef);
	});

	it('rejects invalid seed input', () => {
		expect(parseSeed('')).toBeNull();
		expect(parseSeed('xyz')).toBeNull();
		expect(parseSeed('123456789')).toBeNull();
	});

	it('formats seeds as eight uppercase hex digits', () => {
		expect(seedHexFor(0x1234)).toBe('00001234');
		expect(seedHexFor(0xdeadbeef)).toBe('DEADBEEF');
	});

	it('generates a nonzero 32-bit seed', () => {
		const seed = randomSeed();
		expect(seed).toBeGreaterThan(0);
		expect(Number.isSafeInteger(seed)).toBe(true);
	});
});
