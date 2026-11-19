/**
 * Rules that both the simulation and the presentation layer agree on.
 *
 * EXPERIMENTAL ATTACK BUILD:
 * The economy (troops, income, caps, attack costs) has been removed so the
 * attack pipeline can be exercised in isolation. This is NOT the intended final
 * combat model. Attack limits are a temporary safety valve for the 108-state
 * stress test, not a game-design decision.
 *
 * Anything that changes simulation outcomes is a versioned protocol concern:
 * bump PROTOCOL_VERSION and the map version whenever a value here changes.
 */

export const MAP_WIDTH = 2048;
export const MAP_HEIGHT = 1024;
export const MAP_VERSION = 3;

export const TICK_RATE = 10;
export const TICK_MS = 1000 / TICK_RATE;

/** One human + 107 AI states for the attack stress test. */
export const PLAYER_COUNT = 108;
export const HUMAN_PLAYER_ID = 1;

/** Fraction of map pixels that should become land, targeting a 62/38 ocean/land split. */
export const LAND_FRACTION = 0.38;

/** Radius, in map pixels, of every player's initial territory. */
export const START_RADIUS = 16;

/**
 * Attack points spent by one front per tick. A capture costs the target
 * pixel's defense, so defended or elevated pixels are captured more slowly.
 */
export const ATTACK_DAMAGE_PER_TICK = 30;

/** Six visual/gameplay tiers, from lowland (0) to peak (5). */
export const ELEVATION_LEVELS = 6;

export const ELEVATION_NAMES = [
	'LOWLAND',
	'PLAINS',
	'HILLS',
	'HIGHLANDS',
	'MOUNTAINS',
	'PEAKS'
] as const;

/** Base defense = 1 + elevation level. */
export const BASE_DEFENSE_OFFSET = 1;

/** An owned pixel adds this much defense on top of its base. */
export const OCCUPIED_DEFENSE_BONUS = 1;

/**
 * Orders are finite. An attack front expires after this many simulation ticks
 * (5 seconds at 10 Hz), even if its frontier still has reachable cells.
 */
export const ATTACK_LIFETIME_TICKS = TICK_RATE * 5;

/** How often disconnected territory is reattached to a surrounding mainland. */
export const ANNEX_INTERVAL_TICKS = 10;

/** Player economy. */
export const STARTING_GOLD = 3;
export const BASE_GOLD_INCOME = 1;
export const INCOME_INTERVAL_TICKS = TICK_RATE * 10;
export const STARTING_HAND_SIZE = 3;
export const REFRESH_COST = 1;

/** Technical guardrail only: prevents unbounded simultaneous orders while stress testing. */
export const MAX_ATTACKS_PER_PLAYER = 3;

/** How far from a click the simulation looks for a shared border. */
export const ATTACK_SEARCH_RADIUS = 34;

/** Bots act once per second. */
export const BOT_DECISION_INTERVAL = TICK_RATE;
export const BOT_ATTACK_LIMIT = 2;
export const BOT_SEARCH_TRIES = 8;

export const PROTOCOL_VERSION = 12;

const CORE_PLAYER_NAMES = [
	'SABLE',
	'AURELIA',
	'KESTREL',
	'VANTA',
	'ORISON',
	'HELIX',
	'MORROW',
	'CINDER'
];
const AI_PREFIXES = [
	'NOVA',
	'VEX',
	'ARC',
	'HALO',
	'ONYX',
	'QUILL',
	'RIFT',
	'SOL',
	'THORN',
	'UMBRA'
];
const AI_SUFFIXES = [
	'PRIME',
	'WARDEN',
	'ARRAY',
	'VEIL',
	'BLOOM',
	'CROWN',
	'DRIFT',
	'EMBER',
	'FROST',
	'ISLE'
];

export const PLAYER_NAMES: readonly string[] = [
	...CORE_PLAYER_NAMES,
	...Array.from(
		{ length: PLAYER_COUNT - CORE_PLAYER_NAMES.length },
		(_, index) =>
			`${AI_PREFIXES[index % AI_PREFIXES.length]}-${AI_SUFFIXES[Math.floor(index / AI_PREFIXES.length)]}`
	)
];

export interface PlayerColor {
	name: string;
	hex: string;
	rgb: readonly [number, number, number];
}

function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
	const h = ((hue % 360) + 360) % 360;
	const s = Math.max(0, Math.min(1, saturation));
	const l = Math.max(0, Math.min(1, lightness));
	const c = (1 - Math.abs(2 * l - 1)) * s;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = l - c / 2;

	let r = 0;
	let g = 0;
	let b = 0;
	if (h < 60) [r, g, b] = [c, x, 0];
	else if (h < 120) [r, g, b] = [x, c, 0];
	else if (h < 180) [r, g, b] = [0, c, x];
	else if (h < 240) [r, g, b] = [0, x, c];
	else if (h < 300) [r, g, b] = [x, 0, c];
	else [r, g, b] = [c, 0, x];

	return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function hex(rgb: readonly [number, number, number]): string {
	return `#${rgb.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Palette index 0 is unclaimed land. Player ids are palette indexes, so the
 * renderer can resolve an owner byte with a single texture lookup.
 *
 * The first eight colors are hand-picked; the remaining stress-test states are
 * generated on a golden-angle hue wheel so every id remains visually distinct.
 */
const BASE_PALETTE: readonly PlayerColor[] = [
	{ name: 'Unclaimed', hex: '#656b52', rgb: [101, 107, 82] },
	{ name: 'Sable', hex: '#ff625f', rgb: [255, 98, 95] },
	{ name: 'Aurelia', hex: '#3ddbd9', rgb: [61, 219, 217] },
	{ name: 'Kestrel', hex: '#ffd166', rgb: [255, 209, 102] },
	{ name: 'Vanta', hex: '#a78bfa', rgb: [167, 139, 250] },
	{ name: 'Orison', hex: '#7bd88f', rgb: [123, 216, 143] },
	{ name: 'Helix', hex: '#ff9f43', rgb: [255, 159, 67] },
	{ name: 'Morrow', hex: '#ff7ab6', rgb: [255, 122, 182] },
	{ name: 'Cinder', hex: '#79a7ff', rgb: [121, 167, 255] }
];

function buildPalette(): PlayerColor[] {
	const palette: PlayerColor[] = [...BASE_PALETTE];
	for (let id = BASE_PALETTE.length; id <= PLAYER_COUNT; id++) {
		const hue = (id * 137.508 + 19) % 360;
		const saturation = 0.58 + (id % 4) * 0.07;
		const lightness = 0.47 + (id % 3) * 0.075;
		const rgb = hslToRgb(hue, saturation, lightness);
		palette.push({ name: `State ${id}`, hex: hex(rgb), rgb });
	}
	return palette;
}

export const PALETTE: readonly PlayerColor[] = buildPalette();

export function colorForPlayer(id: number): PlayerColor {
	return PALETTE[id] ?? PALETTE[0];
}
