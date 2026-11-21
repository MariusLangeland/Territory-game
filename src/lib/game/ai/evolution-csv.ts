import { BUILDABLE_STRUCTURE_TYPES } from '../Structures';
import {
	BOT_GENOME_VERSION,
	BOT_MODULE_IDS,
	clampModule,
	clampTrait,
	type BotGenome,
	type BotModules
} from './genome';
import type { EvolutionReport, GenomePerformance } from './evolution';

const TRAIT_COLUMNS = [
	'aggression',
	'economy',
	'fortification',
	'command',
	'vengeful',
	'cautious',
	'conciliatory',
	'opportunist'
] as const;

export function evolutionCsvHeader(): string[] {
	return [
		'id',
		'generation',
		'bucket',
		'fitness',
		'matches',
		'wins',
		'landShare',
		'income',
		'attackStrength',
		...TRAIT_COLUMNS,
		...BOT_MODULE_IDS.map((id) => `module_${id}`),
		...BUILDABLE_STRUCTURE_TYPES.map((type) => `bias_${type}`)
	];
}

function csvCell(value: string | number): string {
	const text = String(value);
	return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function serializeGenomeRow(row: GenomePerformance): string {
	const genome = row.genome;
	const values: Array<string | number> = [
		genome.id,
		genome.generation,
		row.bucket,
		row.fitness,
		row.matches,
		row.wins,
		row.landShare.toFixed(6),
		row.income.toFixed(2),
		row.attackStrength.toFixed(2),
		...TRAIT_COLUMNS.map((column) => genome[column]),
		...BOT_MODULE_IDS.map((id) => genome.modules[id]),
		...BUILDABLE_STRUCTURE_TYPES.map((type) => genome.structureBias[type])
	];
	return values.map(csvCell).join(',');
}

export function serializeEvolutionCsv(report: EvolutionReport): string {
	const lines = [evolutionCsvHeader().join(',')];
	const seen = new Set<string>();
	const generations = report.final
		? [report.final, ...report.generations.filter((entry) => entry !== report.final)]
		: report.generations;
	for (const generation of generations) {
		for (const row of generation.rows) {
			if (seen.has(row.genome.id)) continue;
			seen.add(row.genome.id);
			lines.push(serializeGenomeRow(row));
		}
	}
	return `${lines.join('\r\n')}\r\n`;
}

/** Minimal RFC-4180 parser; enough for exported spreadsheet CSV. */
export function parseCsvRows(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let value = '';
	let quoted = false;
	for (let index = 0; index < text.length; index++) {
		const char = text[index];
		if (quoted) {
			if (char === '"' && text[index + 1] === '"') {
				value += '"';
				index++;
			} else if (char === '"') {
				quoted = false;
			} else {
				value += char;
			}
		} else if (char === '"') {
			quoted = true;
		} else if (char === ',') {
			row.push(value);
			value = '';
		} else if (char === '\n' || char === '\r') {
			if (char === '\r' && text[index + 1] === '\n') index++;
			row.push(value);
			value = '';
			if (row.some((cell) => cell.length > 0)) rows.push(row);
			row = [];
		} else {
			value += char;
		}
	}
	if (value.length > 0 || row.length > 0) {
		row.push(value);
		if (row.some((cell) => cell.length > 0)) rows.push(row);
	}
	return rows;
}

export function parseEvolutionCsv(text: string): BotGenome[] {
	const rows = parseCsvRows(text);
	if (rows.length < 2) return [];
	const header = rows[0].map((entry) => entry.trim());
	const indexOf = (name: string): number => header.indexOf(name);
	const idColumn = indexOf('id');
	if (idColumn < 0) return [];
	const genomes: BotGenome[] = [];
	const seen = new Set<string>();
	for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
		const cells = rows[rowIndex];
		const id = cells[idColumn]?.trim() ?? '';
		if (id.length === 0 || seen.has(id)) continue;
		const numeric = (column: string, fallback: number): number => {
			const index = indexOf(column);
			const value = index >= 0 ? Number(cells[index]) : Number.NaN;
			return Number.isFinite(value) ? value : fallback;
		};
		const modules = {} as BotModules;
		for (const moduleId of BOT_MODULE_IDS) {
			modules[moduleId] = clampModule(numeric(`module_${moduleId}`, 50));
		}
		const structureBias = {} as BotGenome['structureBias'];
		for (const type of BUILDABLE_STRUCTURE_TYPES) {
			structureBias[type] = clampTrait(numeric(`bias_${type}`, 20));
		}
		seen.add(id);
		genomes.push({
			version: BOT_GENOME_VERSION,
			id,
			generation: Math.max(0, Math.trunc(numeric('generation', 0))),
			parents: [],
			aggression: clampTrait(numeric('aggression', 50)),
			economy: clampTrait(numeric('economy', 50)),
			fortification: clampTrait(numeric('fortification', 50)),
			command: clampTrait(numeric('command', 50)),
			vengeful: clampTrait(numeric('vengeful', 30)),
			cautious: clampTrait(numeric('cautious', 30)),
			conciliatory: clampTrait(numeric('conciliatory', 30)),
			opportunist: clampTrait(numeric('opportunist', 30)),
			modules,
			structureBias
		});
	}
	return genomes;
}
