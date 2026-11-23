const COMPACT_UNITS = ['k', 'M', 'B', 'T', 'Q'] as const;

/** Small HUD counts: 12.3K, 4.5M. */
export function formatCompact(value: number): string {
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
	if (value >= 10_000) return `${Math.round(value / 1000)}K`;
	if (value >= 1_000) return `${(value / 1000).toFixed(1)}K`;
	return String(Math.max(0, Math.round(value)));
}

/** Land-share percentage without a suffix. */
export function formatShare(share: number): string {
	const percent = share * 100;
	return percent >= 10 ? percent.toFixed(1) : percent.toFixed(2);
}

/** MM:SS clock. */
export function formatClock(totalSeconds: number): string {
	const seconds = Math.max(0, Math.floor(totalSeconds));
	return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * Supply can grow without a cap. HUD values use at most three significant
 * digits and a comma decimal separator: 42,500 -> "42,5k".
 */
export function formatSupply(value: number): string {
	const amount = Math.max(0, Math.trunc(Number.isFinite(value) ? value : 0));
	if (amount < 1000) return String(amount);

	let unitIndex = -1;
	let divisor = 1;
	while (amount / divisor >= 1000 && unitIndex < COMPACT_UNITS.length - 1) {
		divisor *= 1000;
		unitIndex++;
	}

	let scaled = amount / divisor;
	let digitsBefore = scaled >= 100 ? 3 : scaled >= 10 ? 2 : 1;
	let decimals = Math.max(0, 3 - digitsBefore);
	let factor = 10 ** decimals;
	let rounded = Math.round(scaled * factor);

	if (rounded >= 1000 && unitIndex < COMPACT_UNITS.length - 1) {
		unitIndex++;
		divisor *= 1000;
		scaled = amount / divisor;
		digitsBefore = scaled >= 100 ? 3 : scaled >= 10 ? 2 : 1;
		decimals = Math.max(0, 3 - digitsBefore);
		factor = 10 ** decimals;
		rounded = Math.round(scaled * factor);
	}

	const whole = Math.floor(rounded / factor);
	const fraction = String(rounded % factor)
		.padStart(decimals, '0')
		.replace(/0+$/, '');
	return `${whole}${fraction ? `,${fraction}` : ''}${COMPACT_UNITS[unitIndex]}`;
}
