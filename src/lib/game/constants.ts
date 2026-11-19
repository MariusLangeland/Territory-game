/**
 * Rules that both the simulation and the presentation layer agree on.
 *
 * Anything that changes simulation outcomes is a versioned protocol concern:
 * bump PROTOCOL_VERSION and the map version whenever a value here changes.
 */

export const MAP_WIDTH = 2048;
export const MAP_HEIGHT = 1024;
export const MAP_VERSION = 1;

export const TICK_RATE = 10;
export const TICK_MS = 1000 / TICK_RATE;

export const PLAYER_COUNT = 8;
export const HUMAN_PLAYER_ID = 1;

/** Fraction of map pixels that should become land, targeting a 62/38 ocean/land split. */
export const LAND_FRACTION = 0.38;

/** Radius, in map pixels, of every player's initial territory. */
export const START_RADIUS = 26;
export const START_TROOPS = 4_000;

/** Pixels captured by one attack in a single tick. */
export const CAPTURE_PER_TICK = 30;

/** Up-front cost of launching an attack. Capture itself costs one troop per pixel. */
export const ATTACK_LAUNCH_COST = 50;
export const MAX_ATTACKS_PER_PLAYER = 3;

/** How far from a click the simulation looks for a shared border. */
export const ATTACK_SEARCH_RADIUS = 34;

/** Bots act once per second. */
export const BOT_DECISION_INTERVAL = TICK_RATE;
export const BOT_MIN_TROOPS = 700;
export const BOT_ATTACK_LIMIT = 2;
export const BOT_SEARCH_TRIES = 8;

/** Income = INCOME_BASE_TROOPS + floor(territory / INCOME_TILES_PER_TROOP) per tick. */
export const INCOME_BASE_TROOPS = 2;
export const INCOME_TILES_PER_TROOP = 100;

/** Troop storage cap = TROOP_CAP_BASE + territory * TROOP_CAP_PER_TILE. */
export const TROOP_CAP_BASE = 2_000;
export const TROOP_CAP_PER_TILE = 3;

export const PROTOCOL_VERSION = 1;

export const PLAYER_NAMES = [
	'SABLE',
	'AURELIA',
	'KESTREL',
	'VANTA',
	'ORISON',
	'HELIX',
	'MORROW',
	'CINDER'
] as const;

export interface PlayerColor {
	name: string;
	hex: string;
	rgb: readonly [number, number, number];
}

/**
 * Palette index 0 is unclaimed land. Player ids are palette indexes, so the
 * renderer can resolve an owner byte with a single texture lookup.
 */
export const PALETTE: readonly PlayerColor[] = [
	{ name: 'Unclaimed', hex: '#656b52', rgb: [101, 107, 82] },
	{ name: 'Sable', hex: '#ff625f', rgb: [255, 98, 95] },
	{ name: 'Aurelia', hex: '#3ddbd9', rgb: [61, 219, 217] },
	{ name: 'Kestrel', hex: '#ffd166', rgb: [255, 209, 102] },
	{ name: 'Vanta', hex: '#a78bfa', rgb: [167, 139, 250] },
	{ name: 'Orison', hex: '#7bd88f', rgb: [123, 216, 143] },
	{ name: 'Helix', hex: '#ff9f43', rgb: [255, 159, 67] },
	{ name: 'Morrow', hex: '#ff7ab6', rgb: [255, 122, 182] },
	{ name: 'Cinder', hex: '#79a7ff', rgb: [121, 167, 255] }
] as const;

export function colorForPlayer(id: number): PlayerColor {
	return PALETTE[id] ?? PALETTE[0];
}

export function troopCap(territory: number): number {
	return TROOP_CAP_BASE + territory * TROOP_CAP_PER_TILE;
}

export function incomeForTerritory(territory: number): number {
	return INCOME_BASE_TROOPS + Math.floor(territory / INCOME_TILES_PER_TROOP);
}
