import {
	parseEvolutionCsv,
	serializeEvolutionCsv,
	type BotGenome,
	type EvolutionReport,
	type EvolutionSessionSnapshot
} from '#lib/game/ai';

/** Browser-only file helpers for the Evolution Lab export/import controls. */

function downloadText(contents: string, mimeType: string, filename: string): void {
	const blob = new Blob([contents], { type: mimeType });
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = filename;
	link.click();
	URL.revokeObjectURL(url);
}

export function downloadEvolutionCsv(report: EvolutionReport): void {
	downloadText(
		serializeEvolutionCsv(report),
		'text/csv;charset=utf-8',
		`territory-evolution-${report.config.seed}.csv`
	);
}

export function downloadGauntletState(snapshot: EvolutionSessionSnapshot): void {
	downloadText(
		JSON.stringify(snapshot, null, 2),
		'application/json;charset=utf-8',
		`territory-gauntlet-${snapshot.config.seed}-run-${snapshot.generation}.json`
	);
}

export async function readCsvGenomes(file: File): Promise<BotGenome[]> {
	return parseEvolutionCsv(await file.text());
}

export type GauntletStateReadResult =
	| { ok: true; snapshot: EvolutionSessionSnapshot }
	| { ok: false; reason: 'invalid' | 'unreadable' };

/**
 * Validates an imported gauntlet snapshot before it reaches the worker. The
 * worker restores only completed run boundaries, so active-simulation exports
 * are rejected here and never offered.
 */
export async function readGauntletState(file: File): Promise<GauntletStateReadResult> {
	try {
		const parsed = JSON.parse(await file.text()) as Partial<EvolutionSessionSnapshot>;
		if (
			parsed.version !== 1 ||
			parsed.config?.mode !== 'gauntlet' ||
			!Array.isArray(parsed.population) ||
			!Array.isArray(parsed.reports) ||
			parsed.reports.length === 0 ||
			!Array.isArray(parsed.archive) ||
			typeof parsed.gauntletLives !== 'object' ||
			parsed.gauntletLives === null ||
			(parsed.phase !== 'finished' && parsed.phase !== 'generation-complete')
		) {
			return { ok: false, reason: 'invalid' };
		}
		return { ok: true, snapshot: parsed as EvolutionSessionSnapshot };
	} catch {
		return { ok: false, reason: 'unreadable' };
	}
}
