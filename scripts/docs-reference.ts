/**
 * Generates `docs/REFERENCE.md`, the single source of truth for Territory's
 * rules numbers.
 *
 * Version, core constants, supply economy, structure definitions, attack
 * formulas, and match setup are extracted from the game source modules. Only
 * the content between an `AUTOGEN` marker pair is rewritten; the hand-written
 * intro and update instructions are preserved, so prose can be edited freely.
 *
 * `--check` derives the same document without writing and exits non-zero when
 * the checked-in file is stale, which lets CI catch drift. Output is
 * deterministic: no timestamps, no locale-dependent formatting, and every
 * value comes from the source modules themselves.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	ATTACK_ATTRITION_BASE,
	ATTACK_ATTRITION_BONUS,
	ATTACK_DAMAGE_PER_TICK,
	ATTACK_IDLE_TICKS,
	ATTACK_ORDER_DAMAGE_BONUS,
	ATTACK_ORDER_DEFENSE_PIERCE,
	ATTACK_STRENGTH_BASE,
	ATTACK_STRENGTH_BONUS,
	ATTACK_SUPPLY_COST_BASE,
	ATTACK_SUPPLY_COST_BONUS,
	BASE_DEFENSE_OFFSET,
	BASE_GOLD_INCOME,
	LEAST_RESISTANCE_SAMPLE_SIZE,
	MAP_HEIGHT,
	MAP_WIDTH,
	MAP_VERSION,
	NAVAL_SPEED_PX_PER_SECOND,
	OCCUPIED_DEFENSE_BONUS,
	PLAYER_COUNT,
	PROTOCOL_VERSION,
	STARTING_GOLD,
	SUPPLY_CAP_BASE,
	SUPPLY_CAP_TERRITORY_DIVISOR,
	SUPPLY_INCOME_TERRITORY_DIVISOR,
	TICK_RATE
} from '../src/lib/game/constants';
import {
	DEFAULT_GROWTH_MODE,
	GROWTH_DESCRIPTIONS,
	GROWTH_LABELS,
	GROWTH_MODES
} from '../src/lib/game/growth';
import {
	BOT_DIFFICULTY_OPTIONS,
	DEFAULT_MATCH_SETTINGS,
	MAP_PRESETS,
	STATE_COUNT_OPTIONS,
	TIMER_OPTIONS
} from '../src/lib/game/match-config';
import { NET_PROTOCOL_VERSION } from '../src/lib/game/net/protocol';
import {
	STRUCTURE_DEFINITIONS,
	STRUCTURE_TYPES,
	type StructureEffect,
	type StructureType
} from '../src/lib/game/Structures';
import { COMMAND_POST_SUPPLY_PER_SECOND } from '../src/lib/game/Structures/command-post';

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = dirname(SCRIPT_DIRECTORY);
const DOC_PATH = join(REPOSITORY_ROOT, 'docs', 'REFERENCE.md');
const DOC_RELATIVE_PATH = 'docs/REFERENCE.md';
/** Highest effective Barracks level shown in the derived scaling table. */
const MAX_SCALING_LEVELS = 10;
const AUTOGEN_MARKER = /^<!-- AUTOGEN:([a-z-]+) (START|END) -->$/;

type SectionId = 'version' | 'constants' | 'economy' | 'structures' | 'formulas' | 'match';

type RunMode = 'write' | 'check';

interface RenderContext {
	readonly appVersion: string;
}

interface SectionDefinition {
	readonly id: SectionId;
	readonly title: string;
	readonly render: (context: RenderContext) => string;
}

interface GeneratedSection {
	readonly id: SectionId;
	readonly content: string;
}

interface MarkerSpan {
	readonly id: SectionId;
	readonly startLine: number;
	readonly endLine: number;
}

interface PositionedSection {
	readonly generated: GeneratedSection;
	readonly span: MarkerSpan;
}

interface CliOptions {
	readonly mode: RunMode;
	readonly help: boolean;
}

class UsageError extends Error {}

class DocsReferenceError extends Error {}

const USAGE = `Usage: pnpm exec tsx scripts/docs-reference.ts [--write | --check]

Derives ${DOC_RELATIVE_PATH} from the game source and rewrites only the marked
AUTOGEN blocks. Hand-written prose outside the markers is preserved.

Options:
  --write   Replace generated sections in ${DOC_RELATIVE_PATH} (default).
  --check   Exit non-zero if ${DOC_RELATIVE_PATH} is missing or stale; writes nothing.
  --help    Print this help text.`;

/**
 * The initial document. Only used when the file does not exist yet; once it
 * exists, `--write` preserves whatever prose sits outside the markers.
 */
const UPDATE_NOTE = [
	'Regenerate the marked blocks with `pnpm docs:reference` (wired to',
	'`scripts/docs-reference.ts`). The code and its tests are authoritative: change the',
	'source first, then regenerate. Do not hand-edit content between a',
	'`<!-- AUTOGEN:... START -->` marker and its matching `<!-- AUTOGEN:... END -->`',
	'marker; `--check` exists to catch drift, and a manual edit inside a block is',
	'overwritten on the next write.',
	'',
	'To verify without writing, run `pnpm exec tsx scripts/docs-reference.ts --check`.'
];

function startMarker(id: SectionId): string {
	return `<!-- AUTOGEN:${id} START -->`;
}

function endMarker(id: SectionId): string {
	return `<!-- AUTOGEN:${id} END -->`;
}

function renderBaseDocument(): string {
	const lines: string[] = [
		'# Territory Rules Reference',
		'',
		'This is the generated single source of truth for the rules numbers that live in',
		"Territory's game code. Version, constants, supply economy, structures, attack",
		'formulas, and match setup are extracted from the source; only the prose outside the',
		'`AUTOGEN` marker pairs is hand-written.',
		'',
		'## How to update docs',
		'',
		...UPDATE_NOTE
	];
	for (const section of SECTION_DEFINITIONS) {
		lines.push('', `## ${section.title}`, '', startMarker(section.id), endMarker(section.id));
	}
	return `${lines.join('\n')}\n`;
}

function constantLine(name: string, description: string, value: string | number): string {
	return `- \`${name}\` — ${description}: \`${value}\`.`;
}

function renderVersion(context: RenderContext): string {
	return `- App version: \`${context.appVersion}\` (from \`package.json\` \`version\`).`;
}

function renderConstants(): string {
	const lines: string[] = [
		'Values are read from `src/lib/game/constants.ts` and `src/lib/game/net/protocol.ts`.',
		'',
		constantLine('PROTOCOL_VERSION', 'simulation protocol revision', PROTOCOL_VERSION),
		constantLine('NET_PROTOCOL_VERSION', 'wire protocol revision', NET_PROTOCOL_VERSION),
		constantLine('MAP_VERSION', 'map generation revision', MAP_VERSION),
		constantLine('MAP_WIDTH', 'map width in pixels', MAP_WIDTH),
		constantLine('MAP_HEIGHT', 'map height in pixels', MAP_HEIGHT),
		constantLine('PLAYER_COUNT', 'maximum states per match', PLAYER_COUNT),
		constantLine(
			'NAVAL_SPEED_PX_PER_SECOND',
			'boat speed along a sea route',
			NAVAL_SPEED_PX_PER_SECOND
		),
		constantLine('TICK_RATE', 'simulation ticks per second', TICK_RATE)
	];
	return lines.join('\n');
}

/** War Academy has no exported constant for its cap, so read the definition. */
function warAcademySupplyCap(): number {
	return findEffect('war-academy', 'supply-cap').amount;
}

function renderEconomy(): string {
	const warAcademyCap = warAcademySupplyCap();
	const lines: string[] = [
		'Supply is the only resource; cards, upgrades, and front launches all spend it.',
		'',
		`- **Starting supply:** \`STARTING_GOLD\` = \`${STARTING_GOLD}\`.`,
		`- **Income per second:** \`BASE_GOLD_INCOME + floor(territory / SUPPLY_INCOME_TERRITORY_DIVISOR) + COMMAND_POST_SUPPLY_PER_SECOND × Command Post stacks\` = \`${BASE_GOLD_INCOME} + floor(territory / ${SUPPLY_INCOME_TERRITORY_DIVISOR}) + ${COMMAND_POST_SUPPLY_PER_SECOND} × Command Post stacks\`.`,
		`- **Cap:** \`SUPPLY_CAP_BASE + floor(territory / SUPPLY_CAP_TERRITORY_DIVISOR) + War Academy cap × War Academy stacks\` = \`${SUPPLY_CAP_BASE} + floor(territory / ${SUPPLY_CAP_TERRITORY_DIVISOR}) + ${warAcademyCap} × War Academy stacks\`.`,
		'- **No hard maximum:** neither income nor cap is globally capped; both grow with territory and structure stacks.'
	];
	return lines.join('\n');
}

function findEffect<K extends StructureEffect['kind']>(
	type: StructureType,
	kind: K
): Extract<StructureEffect, { kind: K }> {
	const effect = STRUCTURE_DEFINITIONS[type].effects.find((entry) => entry.kind === kind);
	if (!effect) {
		throw new DocsReferenceError(
			`Structure "${type}" is missing the "${kind}" effect that docs-reference.ts expects.`
		);
	}
	return effect as Extract<StructureEffect, { kind: K }>;
}

function describeEffect(effect: StructureEffect): string {
	switch (effect.kind) {
		case 'defense-aura': {
			const coverage =
				effect.radius > 0 ? `radius ${effect.radius} px` : 'district-wide (radius ignored)';
			return `\`defense-aura\` — +${effect.defense} defense, ${coverage}, \`${effect.stacking}\` stacking.`;
		}
		case 'supply-income':
			return `\`supply-income\` — +${effect.perSecond} supply per second.`;
		case 'supply-cap':
			return `\`supply-cap\` — +${effect.amount} supply cap.`;
		case 'barracks-power':
			return `\`barracks-power\` — +${effect.amount} attack strength level per stack.`;
		case 'barracks-suppression':
			return `\`barracks-suppression\` — −${effect.amount} effective enemy Barracks level per stack.`;
		case 'artillery':
			return `\`artillery\` — range ${effect.range} px, cooldown ${effect.cooldownSeconds} s (${effect.cooldownTicks} ticks), ${effect.shellsPerLevel} shell per level, ${effect.supplyCostPerLevel} supply per level.`;
		default: {
			const exhaustive: never = effect;
			return String(exhaustive);
		}
	}
}

function renderStructures(): string {
	const lines: string[] = [
		'Definitions come from `src/lib/game/Structures/`. A buildable defense aura covers its whole district; State auras use their radius.'
	];
	for (const type of STRUCTURE_TYPES) {
		const definition = STRUCTURE_DEFINITIONS[type];
		lines.push('', `### \`${type}\` — ${definition.label}`, '');
		lines.push(
			`- **Cost:** ${definition.buildable ? `\`${definition.cost}\` supply (buildable)` : 'none (not buildable)'}.`
		);
		lines.push(
			`- **District range:** ${definition.buildable ? `\`${definition.districtRange}\` px` : 'none (aura anchor)'}.`
		);
		lines.push(`- **Description:** ${definition.description}`);
		lines.push('- **Effects:**');
		for (const effect of definition.effects) {
			lines.push(`  - ${describeEffect(effect)}`);
		}
	}
	return lines.join('\n');
}

function formatColumns(rows: readonly (readonly string[])[]): readonly string[] {
	const firstRow = rows[0];
	if (!firstRow) return [];
	const columnCount = firstRow.length;
	const widths: number[] = [];
	for (let column = 0; column < columnCount; column++) {
		let width = 0;
		for (const row of rows) width = Math.max(width, (row[column] ?? '').length);
		widths.push(width);
	}
	return rows.map((row) => {
		const cells: string[] = [];
		for (let column = 0; column < columnCount; column++) {
			const cell = row[column] ?? '';
			cells.push(column === columnCount - 1 ? cell : cell.padEnd(widths[column] ?? 0));
		}
		return cells.join(' ').trimEnd();
	});
}

function renderFormulas(): string {
	const lines: string[] = [
		'Derived from `src/lib/game/constants.ts`; `src/lib/game/simulation.ts` applies them every tick.',
		'',
		`- **Pixel defense:** \`defense = BASE_DEFENSE_OFFSET + elevation + OCCUPIED_DEFENSE_BONUS + auraDefense\` = \`${BASE_DEFENSE_OFFSET} + elevation + ${OCCUPIED_DEFENSE_BONUS} (owned) + auraDefense\`.`,
		'- **Effective levels:** `effectiveLevels = max(0, attacker Barracks stacks − defender Jammer stacks)`.',
		'- **Log tier:** `logTier = 31 − clz32(effectiveLevels + 1)` for positive levels, otherwise `0`; equal to `floor(log2(effectiveLevels + 1))`.',
		`- **Attack power:** \`power = ATTACK_DAMAGE_PER_TICK + logTier × ATTACK_ORDER_DAMAGE_BONUS\` = \`${ATTACK_DAMAGE_PER_TICK} + ${ATTACK_ORDER_DAMAGE_BONUS} × logTier\`.`,
		`- **Defense piercing:** \`pierce = logTier × ATTACK_ORDER_DEFENSE_PIERCE\` = \`logTier × ${ATTACK_ORDER_DEFENSE_PIERCE}\`.`,
		`- **Durable strength:** \`strength = ATTACK_STRENGTH_BASE + effectiveLevels × ATTACK_STRENGTH_BONUS\` = \`${ATTACK_STRENGTH_BASE} + ${ATTACK_STRENGTH_BONUS} × effectiveLevels\`.`,
		`- **Launch cost:** \`cost = ATTACK_SUPPLY_COST_BASE + effectiveLevels × ATTACK_SUPPLY_COST_BONUS\` = \`${ATTACK_SUPPLY_COST_BASE} + ${ATTACK_SUPPLY_COST_BONUS} × effectiveLevels\`.`,
		'- **Capture cost:** each captured cell spends `max(1, defense − pierce)` attack points and the same amount of durable strength.',
		`- **Per-tick budget:** a front spends up to \`power\` attack points per tick and samples \`LEAST_RESISTANCE_SAMPLE_SIZE\` = \`${LEAST_RESISTANCE_SAMPLE_SIZE}\` frontier cells, capturing the cheapest affordable one.`,
		`- **Contact damage:** mutual fronts trade \`ATTACK_ATTRITION_BASE + opponentLogTier × ATTACK_ATTRITION_BONUS\` = \`${ATTACK_ATTRITION_BASE} + ${ATTACK_ATTRITION_BONUS} × opponentLogTier\` durable strength once per pair per tick.`,
		`- **Idle timeout:** a front that captures nothing for \`ATTACK_IDLE_TICKS\` = \`${ATTACK_IDLE_TICKS}\` ticks dies.`,
		'- **Cancellation refund:** `refund = floor(cost × remainingStrength / initialStrength)`.',
		'',
		'#### Effective-level scaling',
		'',
		'```text'
	];
	const scalingRows: string[][] = [['levels', 'logTier', 'power', 'pierce', 'strength', 'cost']];
	for (let levels = 0; levels <= MAX_SCALING_LEVELS; levels++) {
		const logTier = levels > 0 ? 31 - Math.clz32(levels + 1) : 0;
		scalingRows.push([
			String(levels),
			String(logTier),
			String(ATTACK_DAMAGE_PER_TICK + logTier * ATTACK_ORDER_DAMAGE_BONUS),
			String(logTier * ATTACK_ORDER_DEFENSE_PIERCE),
			String(ATTACK_STRENGTH_BASE + levels * ATTACK_STRENGTH_BONUS),
			String(ATTACK_SUPPLY_COST_BASE + levels * ATTACK_SUPPLY_COST_BONUS)
		]);
	}
	lines.push(...formatColumns(scalingRows), '```');
	return lines.join('\n');
}

function timerLabel(minutes: number): string {
	return minutes === 0 ? 'no timer' : `${minutes}-minute timer`;
}

function renderMatch(): string {
	const lines: string[] = [
		'Presets come from `src/lib/game/match-config.ts`; growth layers come from `src/lib/game/growth/`.',
		'',
		'### Map presets',
		''
	];
	for (const preset of MAP_PRESETS) {
		lines.push(
			`- \`${preset.id}\` — ${preset.label} (width ${preset.width} px, height ${preset.height} px).`
		);
	}
	lines.push('', '### State count', '');
	lines.push(
		`Allowed: ${STATE_COUNT_OPTIONS.map((count) => `\`${count}\``).join(', ')}. Default: \`${DEFAULT_MATCH_SETTINGS.states}\`.`
	);
	lines.push('', '### Bot difficulty', '');
	for (const option of BOT_DIFFICULTY_OPTIONS) {
		lines.push(`- \`${option.id}\` — ${option.label}: ${option.detail}.`);
	}
	lines.push('', '### Match timer', '');
	for (const minutes of TIMER_OPTIONS) {
		lines.push(`- \`${minutes}\` — ${timerLabel(minutes)}.`);
	}
	const defaultTimer = DEFAULT_MATCH_SETTINGS.timerMinutes;
	lines.push('', `Default: \`${defaultTimer}\` (${timerLabel(defaultTimer)}).`);
	lines.push('', '### Growth layer', '');
	for (const mode of GROWTH_MODES) {
		lines.push(`- \`${mode}\` — ${GROWTH_LABELS[mode]}: ${GROWTH_DESCRIPTIONS[mode]}`);
	}
	lines.push('', `Default: \`${DEFAULT_GROWTH_MODE}\`.`);
	lines.push('', '### Default match settings', '');
	lines.push(
		`\`states\` = \`${DEFAULT_MATCH_SETTINGS.states}\`, \`mapPreset\` = \`${DEFAULT_MATCH_SETTINGS.mapPreset}\`, \`difficulty\` = \`${DEFAULT_MATCH_SETTINGS.difficulty}\`, \`growthMode\` = \`${DEFAULT_MATCH_SETTINGS.growthMode}\`, \`timerMinutes\` = \`${DEFAULT_MATCH_SETTINGS.timerMinutes}\`.`
	);
	return lines.join('\n');
}

/** Section order is the document order; markers are matched by id, not position. */
const SECTION_DEFINITIONS: readonly SectionDefinition[] = [
	{ id: 'version', title: 'Version', render: renderVersion },
	{ id: 'constants', title: 'Core constants', render: renderConstants },
	{ id: 'economy', title: 'Supply economy', render: renderEconomy },
	{ id: 'structures', title: 'Structures', render: renderStructures },
	{ id: 'formulas', title: 'Attack formulas', render: renderFormulas },
	{ id: 'match', title: 'Match setup', render: renderMatch }
];

function generateSections(appVersion: string): readonly GeneratedSection[] {
	const context: RenderContext = { appVersion };
	return SECTION_DEFINITIONS.map((section) => ({
		id: section.id,
		content: section.render(context)
	}));
}

function readAppVersion(): string {
	const raw = readFileSync(join(REPOSITORY_ROOT, 'package.json'), 'utf8');
	const parsed: unknown = JSON.parse(raw);
	if (typeof parsed !== 'object' || parsed === null) {
		throw new DocsReferenceError('package.json did not parse to an object.');
	}
	const version = (parsed as { version?: unknown }).version;
	if (typeof version !== 'string' || version.length === 0) {
		throw new DocsReferenceError('package.json is missing a string "version" field.');
	}
	return version;
}

function findUniqueLine(
	lines: readonly string[],
	marker: string,
	id: SectionId,
	kind: 'START' | 'END'
): number {
	let found = -1;
	let count = 0;
	for (const [index, line] of lines.entries()) {
		if (line !== marker) continue;
		found = index;
		count += 1;
	}
	if (count === 0) {
		throw new DocsReferenceError(
			`${DOC_RELATIVE_PATH} is missing the "${id}" ${kind} AUTOGEN marker.`
		);
	}
	if (count > 1) {
		throw new DocsReferenceError(
			`${DOC_RELATIVE_PATH} has ${count} "${id}" ${kind} AUTOGEN markers; expected one.`
		);
	}
	return found;
}

/**
 * Locate every section marker exactly once and reject stale or overlapping
 * markers. A malformed document fails loudly instead of being half-rewritten.
 */
function positionSections(
	lines: readonly string[],
	generated: readonly GeneratedSection[]
): readonly PositionedSection[] {
	const knownIds: ReadonlySet<string> = new Set(generated.map((section) => section.id));
	for (const [index, line] of lines.entries()) {
		const match = AUTOGEN_MARKER.exec(line);
		if (!match) continue;
		const id = match[1] ?? '';
		if (!knownIds.has(id)) {
			throw new DocsReferenceError(
				`${DOC_RELATIVE_PATH}:${index + 1} has unknown AUTOGEN marker "${id}".`
			);
		}
	}

	const positioned: PositionedSection[] = [];
	for (const section of generated) {
		const startLine = findUniqueLine(lines, startMarker(section.id), section.id, 'START');
		const endLine = findUniqueLine(lines, endMarker(section.id), section.id, 'END');
		if (startLine > endLine) {
			throw new DocsReferenceError(
				`${DOC_RELATIVE_PATH} has the "${section.id}" END marker before its START marker.`
			);
		}
		positioned.push({ generated: section, span: { id: section.id, startLine, endLine } });
	}

	positioned.sort((left, right) => left.span.startLine - right.span.startLine);
	for (let index = 1; index < positioned.length; index++) {
		const previous = positioned[index - 1];
		const current = positioned[index];
		if (!previous || !current) continue;
		if (previous.span.endLine >= current.span.startLine) {
			throw new DocsReferenceError(
				`${DOC_RELATIVE_PATH} has overlapping "${previous.generated.id}" and "${current.generated.id}" AUTOGEN markers.`
			);
		}
	}
	return positioned;
}

/** Expected text between a START and END marker, including the blank padding. */
function sectionBody(content: string): string {
	return ['', ...content.split('\n'), ''].join('\n');
}

function applySections(lines: readonly string[], positioned: readonly PositionedSection[]): string {
	const output: string[] = [];
	let cursor = 0;
	for (const section of positioned) {
		for (; cursor < section.span.startLine; cursor++) output.push(lines[cursor] ?? '');
		output.push(lines[section.span.startLine] ?? '');
		output.push(...sectionBody(section.generated.content).split('\n'));
		output.push(lines[section.span.endLine] ?? '');
		cursor = section.span.endLine + 1;
	}
	for (; cursor < lines.length; cursor++) output.push(lines[cursor] ?? '');
	return output.join('\n');
}

function changedSectionIds(
	lines: readonly string[],
	positioned: readonly PositionedSection[]
): readonly SectionId[] {
	const changed: SectionId[] = [];
	for (const section of positioned) {
		const currentBody = lines.slice(section.span.startLine + 1, section.span.endLine).join('\n');
		if (currentBody !== sectionBody(section.generated.content)) changed.push(section.generated.id);
	}
	return changed;
}

function writeDocument(text: string): void {
	mkdirSync(dirname(DOC_PATH), { recursive: true });
	writeFileSync(DOC_PATH, text, 'utf8');
}

function run(argv: readonly string[]): void {
	const options = parseArgs(argv);
	if (options.help) {
		console.log(USAGE);
		return;
	}

	const generated = generateSections(readAppVersion());
	const current = existsSync(DOC_PATH) ? readFileSync(DOC_PATH, 'utf8') : null;
	if (current === null) {
		if (options.mode === 'check') {
			throw new DocsReferenceError(
				`${DOC_RELATIVE_PATH} does not exist; run \`pnpm docs:reference\` to create it.`
			);
		}
		const baseLines = renderBaseDocument().split('\n');
		writeDocument(applySections(baseLines, positionSections(baseLines, generated)));
		console.log(`Created ${DOC_RELATIVE_PATH} with ${generated.length} generated sections.`);
		return;
	}

	const lines = current.split('\n');
	const positioned = positionSections(lines, generated);
	const expected = applySections(lines, positioned);
	if (expected === current) {
		console.log(`${DOC_RELATIVE_PATH} is up to date.`);
		return;
	}

	const changed = changedSectionIds(lines, positioned);
	if (options.mode === 'check') {
		throw new DocsReferenceError(
			[
				`${DOC_RELATIVE_PATH} is out of date: ${changed.join(', ')}.`,
				'Run `pnpm docs:reference` (or `pnpm exec tsx scripts/docs-reference.ts --write`) to regenerate it.'
			].join('\n')
		);
	}

	writeDocument(expected);
	const suffix = changed.length === 1 ? '' : 's';
	console.log(
		`Updated ${DOC_RELATIVE_PATH} (${changed.length} changed section${suffix}: ${changed.join(', ')}).`
	);
}

function parseArgs(argv: readonly string[]): CliOptions {
	let mode: RunMode = 'write';
	let modeSet = false;
	let help = false;
	for (const arg of argv) {
		switch (arg) {
			case '--write':
				if (modeSet && mode !== 'write') {
					throw new UsageError('Choose only one of --write and --check.');
				}
				mode = 'write';
				modeSet = true;
				break;
			case '--check':
				if (modeSet && mode !== 'check') {
					throw new UsageError('Choose only one of --write and --check.');
				}
				mode = 'check';
				modeSet = true;
				break;
			case '--help':
			case '-h':
				help = true;
				break;
			default:
				throw new UsageError(`Unknown argument "${arg}".`);
		}
	}
	return { mode, help };
}

function main(argv: readonly string[]): void {
	try {
		run(argv);
	} catch (error) {
		if (error instanceof UsageError) {
			console.error(error.message);
			console.error('');
			console.error(USAGE);
			process.exitCode = 1;
			return;
		}
		if (error instanceof DocsReferenceError) {
			console.error(error.message);
			process.exitCode = 1;
			return;
		}
		throw error;
	}
}

main(process.argv.slice(2));
