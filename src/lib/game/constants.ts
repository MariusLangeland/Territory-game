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

export const MAP_WIDTH = 4096;
export const MAP_HEIGHT = 2048;
/** Smallest supported atlas. */
export const MIN_MAP_WIDTH = 512;
export const MIN_MAP_HEIGHT = 256;
/** WebGPU texture dimension limit respected by every supported device. */
export const MAX_MAP_DIMENSION = 8192;
/** Change packets reserve 26 index bits and 6 owner bits in a Uint32. */
export const CHANGE_INDEX_BITS = 26;
export const CHANGE_INDEX_MASK = (1 << CHANGE_INDEX_BITS) - 1;
export const MAX_MAP_CELLS = 1 << CHANGE_INDEX_BITS;
export const MAP_VERSION = 5;

export const TICK_RATE = 10;
export const TICK_MS = 1000 / TICK_RATE;
/** Renderer dirty-tile granularity; simulation also reports district tiles at this size. */
export const RENDER_TILE_SIZE = 32;

/** One human + 50 AI states for the attack stress test. */
export const PLAYER_COUNT = 51;
/** Gauntlet mode seats up to 64 genomes in one free-for-all. */
export const MAX_PLAYER_COUNT = 64;
export const HUMAN_PLAYER_ID = 1;

/** Fraction of map pixels that should become land, targeting a 62/38 ocean/land split. */
export const LAND_FRACTION = 0.38;

/** Radius, in map pixels, of every player's initial territory. */
export const START_RADIUS = 16;

/**
 * Attack points spent by one front per tick. A capture costs the target
 * pixel's defense, so defended or elevated pixels are captured more slowly.
 */
/**
 * Frontage v1: durable strength and per-tick capture budget. Barracks levels
 * scale strength/cost linearly and speed/piercing by floor(log2(levels + 1)).
 */
export const ATTACK_DAMAGE_PER_TICK = 30;
export const ATTACK_ORDER_DAMAGE_BONUS = 15;
export const ATTACK_ORDER_DEFENSE_PIERCE = 1;
export const ATTACK_SUPPLY_COST_BASE = 30;
export const ATTACK_SUPPLY_COST_BONUS = 40;
export const ATTACK_STRENGTH_BASE = 1000;
export const ATTACK_STRENGTH_BONUS = 200;
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
export const ANNEX_INTERVAL_TICKS = TICK_RATE * 3;
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
/** Permanent supply/s awarded to the player who erases another state. */
export const ELIMINATION_SUPPLY_INCOME_BONUS = 10;
export const INCOME_INTERVAL_TICKS = TICK_RATE * 10;
export const SUPPLY_CAP_BASE = 120;
export const SUPPLY_CAP_TERRITORY_DIVISOR = 1000;
export const SUPPLY_INCOME_TERRITORY_DIVISOR = 3000;
export const SUPPLY_WIN_SHARE = 70;

/** How far from a click the simulation looks for a shared border. */
export const ATTACK_SEARCH_RADIUS = 34;

/** Active artillery: one shell per structure level per volley. */
export const ARTILLERY_SUPPLY_COST_PER_LEVEL = 300;
export const UPGRADE_LEVEL_COST_STEP = 15;
/** Largest atomic district upgrade batch exposed by the HUD. */
export const MAX_UPGRADE_BATCH = 25;
export const ARTILLERY_RANGE = 140;
/** Cursor-to-shore snapping radius for Port placement. */
export const PORT_BUILD_SNAP_RADIUS = 24;
/** Cursor-to-shore snapping radius for naval landing targeting. */
export const NAVAL_TARGET_SNAP_RADIUS = 32;
/** Shift-build searches this far for the closest valid structure cell. */
export const SHIFT_BUILD_SNAP_RADIUS = 160;
/** Artillery needs this much district-free ground around its centre. */
export const ARTILLERY_BUILD_CLEARANCE = 16;
export const ARTILLERY_COOLDOWN_TICKS = TICK_RATE * 6;
export const ARTILLERY_SHELL_TRAVEL_TICKS = TICK_RATE * 2;
export const ARTILLERY_BLAST_RADIUS = 12;
/** Clicks near a hostile structure snap to it so targeting stays usable when zoomed out. */
export const ARTILLERY_TARGET_SNAP_RADIUS = 0;
/** Deterministic impact spread around the aim point; intentionally inaccurate. */
export const ARTILLERY_SHELL_SPREAD = 36;

/** Bots act once per second. */
export const BOT_DECISION_INTERVAL = TICK_RATE;
export const BOT_SEARCH_TRIES = 8;
/** Bots evaluate their focus build every 3 seconds. */
export const BOT_BUILD_INTERVAL = TICK_RATE * 3;
export const BOT_STARTING_GOLD = 90;
/** Utility economy: exploration bonus for a first structure, diminishing repeats. */
export const BOT_ACTION_NOVELTY_BONUS = 20;
export const BOT_ACTION_REPEAT_PENALTY = 9;
export const BOT_ACTION_MAX_PER_INTERVAL = 2;
/** After this many buildables, bots keep a strategic reserve for their next aspiration. */
export const BOT_STRATEGIC_SAVE_MIN_STRUCTURES = 2;
/**
 * Shared opening strategy: every bot first builds a line of Command Posts and
 * War Academies (two of each) before personality-driven branching.
 */
export const BOT_EARLY_ECONOMY_PER_TYPE = 2;
export const BOT_EARLY_ECONOMY_TICK_LIMIT = 1200;
export const BOT_EARLY_ECONOMY_UTILITY = 20_000;
/** Once a basic economy exists, fund a first Barracks before over-investing in economy. */
export const BOT_EARLY_ECONOMY_MILITARY_TICK = TICK_RATE * 60;
export const BOT_BARRACKS_OPENING_UTILITY = 20_100;
/** Aggressive bots start cap-saving for a first Artillery after this point. */
export const BOT_ARTILLERY_OPENING_TICK = TICK_RATE * 240;
export const BOT_ARTILLERY_OPENING_AGGRESSION = 50;
export const BOT_ARTILLERY_OPENING_TERRITORY = 2_000;
/**
 * During the opening economy ramp, save the full next Command Post/War Academy
 * cost. A small 40-supply reserve let cheap Fortifications win the budget and
 * starved the supply ramp; the cap still leaves room for a base front.
 */
export const BOT_EARLY_ECONOMY_RESERVE_MAX = 60;
/** Attack ground preference: subtract this much per point of pixel defense. */
export const BOT_ATTACK_DEFENSE_WEIGHT = 6;
/**
 * Attacks may spend above this fraction of an aspiration save. Without this,
 * saving for expensive structures freezes expansion for minutes.
 */
export const BOT_ATTACK_SAVE_KEEP_FRACTION = 0.5;
export const BOT_ATTACK_SAVE_KEEP_FLOOR = 60;
/** The next-purchase buffer is capped for attacks so it cannot stack with saves. */
export const BOT_ATTACK_ECONOMIC_BUFFER_CAP = 40;
/** Boat speed in map pixels per second along its sea route. */
export const NAVAL_SPEED_PX_PER_SECOND = 80;
/** Bot naval planning: sample shores and only spend on a worthwhile landing. */
export const BOT_NAVAL_SEARCH_TRIES = 10;
export const BOT_NAVAL_MIN_SCORE = 38;
export const BOT_NAVAL_LAUNCH_CHANCE = 30;
export const BOT_NAVAL_DISTANCE_PENALTY_DIVISOR = 60;
/** Attack decision weights: target utility, not only a fixed aggression roll. */
export const BOT_ATTACK_BASE_CHANCE = 3;
export const BOT_ATTACK_SCORE_CENTER = 45;
export const BOT_ATTACK_SCORE_WEIGHT = 0.9;
export const BOT_ATTACK_AGGRESSION_WEIGHT = 0.4;
export const BOT_ATTACK_SUPPLY_PRESSURE_WEIGHT = 8;

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
export const BOT_DEFENSE_RESERVE_MAX = 60; // enough for a Fortification upgrade

/** The economy always values income, and values it more when neighbours earn more. */
export const BOT_INCOME_UTILITY = 10;
export const BOT_INCOME_GAP_COMMAND_POST_WEIGHT = 4;
export const BOT_INCOME_GAP_WAR_ACADEMY_WEIGHT = 1;
export const BOT_INCOME_GAP_ATTACK_PENALTY = 1;
export const BOT_INCOME_GAP_ATTACK_PENALTY_CAP = 30;

/** Strength advantage of a neighbouring state, in strength/100 units. */
export const BOT_DETERRENCE_STRENGTH_DIVISOR = 100;
export const BOT_THREAT_PER_DETERRENCE = 1;
export const BOT_THREAT_DETERRENCE_CAP = 10;
export const BOT_DETERRENCE_FORT_UTILITY = 2;
export const BOT_DETERRENCE_MAX_EXTRA_COPIES = 2;
export const BOT_DETERRENCE_MAX_EXTRA_LEVELS = 3;
export const BOT_DEFENSE_FIRST_UTILITY = 500;

/** A stronger neighbour caught with low supply is an opportunity, not a deterrent. */
export const BOT_OPPORTUNITY_LOW_SUPPLY_PERCENT = 25;
export const BOT_OPPORTUNITY_STRONGER_BONUS = 55;
export const BOT_OPPORTUNITY_CHANCE_BONUS = 25;
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
/** Team AI: reward joining a teammate's target; never attack teammates. */
export const BOT_TEAM_COORDINATION_BONUS = 30;

/** Strategic option commitments sit above tactical scoring. */
export const BOT_OPTION_MIN_TICKS = 50;
export const BOT_OPTION_MAX_TICKS = 90;
export const BOT_OPTION_SWITCH_MARGIN = 18;
export const BOT_THREAT_NEUTRAL_BIAS = 10;

export const PROTOCOL_VERSION = 41;

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
		{ length: MAX_PLAYER_COUNT - CORE_PLAYER_NAMES.length },
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
	for (let id = BASE_PALETTE.length; id <= MAX_PLAYER_COUNT; id++) {
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
