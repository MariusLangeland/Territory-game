/** Strategic options sit above the tactical utility layer. */
export const BOT_OPTION_IDS = [
	'supply-ramp',
	'fortify-front',
	'expand',
	'naval-opportunity',
	'exploit-weakness',
	'coalition-strike',
	'conserve'
] as const;

export type BotOptionId = (typeof BOT_OPTION_IDS)[number];

export const BOT_OPTION_LABELS: Record<BotOptionId, string> = {
	'supply-ramp': 'Supply ramp',
	'fortify-front': 'Fortify front',
	expand: 'Expand',
	'naval-opportunity': 'Naval opportunity',
	'exploit-weakness': 'Exploit weakness',
	'coalition-strike': 'Coalition strike',
	conserve: 'Conserve'
};

/** Zero is "no option"; 1..n are stable checksum codes. */
export const BOT_OPTION_CODES: Record<BotOptionId, number> = {
	'supply-ramp': 1,
	'fortify-front': 2,
	expand: 3,
	'naval-opportunity': 4,
	'exploit-weakness': 5,
	'coalition-strike': 6,
	conserve: 7
};

export function botOptionFromCode(code: number): BotOptionId | null {
	for (const id of BOT_OPTION_IDS) {
		if (BOT_OPTION_CODES[id] === code) return id;
	}
	return null;
}

export function emptyOptionCounts(): Record<BotOptionId, number> {
	const counts = {} as Record<BotOptionId, number>;
	for (const id of BOT_OPTION_IDS) counts[id] = 0;
	return counts;
}
