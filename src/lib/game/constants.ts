/**
 * Rules that both the simulation and the presentation layer agree on.
 *
 * EXPERIMENTAL ATTACK BUILD:
 * Troops and production caps are removed so the attack pipeline can be
 * exercised in isolation. This is NOT the intended final combat model.
 * Attack limits and the 50-bot field are temporary stress-test choices.
 *
 * Anything that changes simulation outcomes is a versioned protocol concern:
 * bump PROTOCOL_VERSION and the map version whenever a value here changes.
 */

export const MAP_WIDTH = 2048;
export const MAP_HEIGHT = 1024;
export const MAP_VERSION = 4;

export const TICK_RATE = 10;
export const TICK_MS = 1000 / TICK_RATE;
/** Renderer dirty-tile granularity; simulation also reports district tiles at this size. */
export const RENDER_TILE_SIZE = 32;

/** One human + 50 AI states for the attack stress test. */
export const PLAYER_COUNT = 51;
export const HUMAN_PLAYER_ID = 1;

/** Fraction of map pixels that should become land, targeting a 62/38 ocean/land split. */
export const LAND_FRACTION = 0.38;

/** Radius, in map pixels, of every player's initial territory. */
export const START_RADIUS = 16;

/**
 * Attack points spent by one front per tick. A capture costs the target
 * pixel's defense, so defended or elevated pixels are captured more slowly.
 */
/** Frontage v1: durable strength and per-tick capture budget. */
export const ATTACK_DAMAGE_PER_TICK = 30;
export const ATTACK_ORDER_DAMAGE_BONUS = 15;
export const ATTACK_ORDER_DEFENSE_PIERCE = 1;
export const ATTACK_SUPPLY_COST_BASE = 30;
export const ATTACK_SUPPLY_COST_BONUS = 15;
export const ATTACK_STRENGTH_BASE = 1500;
export const ATTACK_STRENGTH_BONUS = 450;
export const ATTACK_ATTRITION_BASE = 100;
export const ATTACK_ATTRITION_BONUS = 50;
/** A front that captures nothing for this many ticks dies. */
export const ATTACK_IDLE_TICKS = 20;

/**
 * The attack samples this many top-priority frontier cells and takes the
 * cheapest one that still fits the remaining budget. Geometry still decides
 * which cells are candidates; defense decides which sampled lane advances.
 */
export const LEAST_RESISTANCE_SAMPLE_SIZE = 10;

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

/** How often disconnected territory is reattached to a surrounding mainland. */
export const ANNEX_INTERVAL_TICKS = 10;
/** Small landlocked neutral pockets are filled at most once per 10 seconds. */
export const UNCLAIMED_CLEANUP_INTERVAL_TICKS = TICK_RATE * 10;
/** Only pockets at or below this area are auto-filled. */
export const UNCLAIMED_POCKET_MAX_AREA = 96;

/** Minimum centre-to-centre distance, in map cells, between any two structures. */
export const STRUCTURE_MIN_SPACING = 8;

/** District edge fuzz: coherent cell size and worst-case outward growth. */
export const DISTRICT_NOISE_CELL = 8;
export const DISTRICT_NOISE_MARGIN = 4;

/** Player economy. */
/** Single resource: supply pays for cards, upgrades, and front launches. */
export const STARTING_GOLD = 90;
export const BASE_GOLD_INCOME = 3;
export const INCOME_INTERVAL_TICKS = TICK_RATE * 10;
export const SUPPLY_CAP_BASE = 120;
export const SUPPLY_CAP_TERRITORY_DIVISOR = 1000;
export const SUPPLY_CAP_WAR_ACADEMY = 40;
export const SUPPLY_CAP_MAX = 600;
export const SUPPLY_INCOME_TERRITORY_DIVISOR = 10000;
export const SUPPLY_INCOME_MAX = 60;
export const SUPPLY_WIN_SHARE = 70;

/** How far from a click the simulation looks for a shared border. */
export const ATTACK_SEARCH_RADIUS = 34;

/** Active artillery: one shell per structure level per volley. */
export const ARTILLERY_SUPPLY_COST_PER_SHELL = 12;
export const ARTILLERY_RANGE = 140;
export const ARTILLERY_COOLDOWN_TICKS = TICK_RATE * 6;
export const ARTILLERY_SHELL_TRAVEL_TICKS = TICK_RATE * 2;
export const ARTILLERY_BLAST_RADIUS = 12;
/** Clicks near a hostile structure snap to it so targeting stays usable when zoomed out. */
export const ARTILLERY_TARGET_SNAP_RADIUS = 28;
/** Deterministic impact spread around the aim point. */
export const ARTILLERY_SHELL_SPREAD = 7;

/** Bots act once per second. */
export const BOT_DECISION_INTERVAL = TICK_RATE;
export const BOT_SEARCH_TRIES = 8;
/** Bots evaluate their focus build every 3 seconds. */
export const BOT_BUILD_INTERVAL = TICK_RATE * 3;
export const BOT_STARTING_GOLD = 90;

/**
 * Bot defence. A bot's threat score is an integer recomputed once per decision
 * tick from active attacks, hostile border contact, and recent territory loss.
 * It only gates deterministic spending/targeting; it never uses the shared RNG.
 */
export const BOT_THREAT_PER_ATTACK = 25; // one active front is already an emergency
export const BOT_THREAT_ATTACK_CAP = 50;
export const BOT_THREAT_PER_CONTACT = 1; // hostile pixels touching the bot's border
export const BOT_THREAT_CONTACT_CAP = 8; // below SAFE: contact alone cannot hold the posture
export const BOT_THREAT_PER_LOSS = 2; // grievances added since the previous refresh
export const BOT_THREAT_LOSS_CAP = 20;
/** Enter defensive posture at/above DEFENSIVE, leave at/below SAFE (hysteresis). */
export const BOT_THREAT_DEFENSIVE = 20;
export const BOT_THREAT_SAFE = 10;

/** Gold a threatened bot withholds from its build plan until it is safe again. */
export const BOT_DEFENSE_RESERVE_MAX = 12; // roughly one Barracks
/**
 * Build intervals a threatened bot may fail to afford any defensive action
 * before the reserve is released. This keeps a long stalemate from blocking
 * every non-defensive purchase forever; saving resumes after the next
 * successful fortification. (3 intervals = 9 seconds.)
 */
export const BOT_DEFENSE_STALL_INTERVALS = 3;

/** While threatened, value the grudge/attacker target over unrelated ones. */
export const BOT_THREAT_RETALIATE_BONUS = 60;
export const BOT_THREAT_COUNTER_BONUS = 40;
export const BOT_THREAT_UNRELATED_PENALTY = 30;
export const BOT_THREAT_NEUTRAL_BIAS = 10;

export const PROTOCOL_VERSION = 34;

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
