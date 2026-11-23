import { describe, expect, it } from 'vitest';
import { formatClock, formatCompact, formatShare, formatSupply } from './format';

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

describe('HUD formatting', () => {
	it('formats compact counts', () => {
		expect(formatCompact(999)).toBe('999');
		expect(formatCompact(1500)).toBe('1.5K');
		expect(formatCompact(12_500)).toBe('13K');
		expect(formatCompact(2_500_000)).toBe('2.5M');
	});

	it('formats land shares', () => {
		expect(formatShare(0.1234)).toBe('12.3');
		expect(formatShare(0.0123)).toBe('1.23');
	});

	it('formats MM:SS clocks', () => {
		expect(formatClock(0)).toBe('00:00');
		expect(formatClock(65.9)).toBe('01:05');
		expect(formatClock(-10)).toBe('00:00');
	});
});
