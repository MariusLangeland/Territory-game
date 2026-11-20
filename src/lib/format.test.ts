import { describe, expect, it } from 'vitest';
import { formatSupply } from './format';

describe('formatSupply', () => {
	it('keeps small values as integers', () => {
		expect(formatSupply(0)).toBe('0');
		expect(formatSupply(999)).toBe('999');
	});

	it('uses at most three significant digits with comma decimals', () => {
		expect(formatSupply(1000)).toBe('1k');
		expect(formatSupply(1250)).toBe('1,25k');
		expect(formatSupply(4250)).toBe('4,25k');
		expect(formatSupply(42500)).toBe('42,5k');
		expect(formatSupply(425000)).toBe('425k');
		expect(formatSupply(999_999)).toBe('1M');
		expect(formatSupply(1_250_000)).toBe('1,25M');
	});

	it('handles invalid and negative input safely', () => {
		expect(formatSupply(-50)).toBe('0');
		expect(formatSupply(Number.NaN)).toBe('0');
	});
});
