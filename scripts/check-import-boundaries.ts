import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SOURCE_ROOT = join(ROOT, 'src');

interface BoundaryRule {
	name: string;
	roots: string[];
	allow?: (specifier: string) => boolean;
	message: string;
}

const rules: BoundaryRule[] = [
	{
		name: 'renderer-is-simulation-agnostic',
		roots: ['lib/game/render'],
		allow: (specifier) => !/(^|\/)simulation($|\/|\.ts$)/.test(specifier),
		message:
			'Renderer modules must target SimulationView, not the concrete simulation or its internals.'
	},
	{
		name: 'ui-is-transport-agnostic',
		roots: ['lib/components'],
		allow: (specifier) =>
			!/(worker\/(local-host|local-simulation|local-protocol)|local-simulation)/.test(specifier),
		message:
			'UI components must consume SimulationView/props, not worker transport or host internals.'
	},
	{
		name: 'server-does-not-import-ui-routes',
		roots: ['lib/server', 'routes/api'],
		allow: (specifier) =>
			!specifier.startsWith('$app/') &&
			!specifier.includes('/routes/') &&
			!specifier.startsWith('src/routes'),
		message: 'Server modules must not import SvelteKit route or client-navigation modules.'
	}
];

const importPattern = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g;

function* walk(directory: string): Generator<string> {
	for (const entry of readdirSync(directory)) {
		const path = join(directory, entry);
		if (statSync(path).isDirectory()) yield* walk(path);
		else if (/\.(ts|svelte)$/.test(entry)) yield path;
	}
}

const violations: string[] = [];

for (const rule of rules) {
	for (const root of rule.roots) {
		const directory = join(SOURCE_ROOT, root);
		for (const file of walk(directory)) {
			const source = readFileSync(file, 'utf8');
			for (const match of source.matchAll(importPattern)) {
				const specifier = match[1];
				if (rule.allow?.(specifier) === false) {
					violations.push(
						`${rule.name}: ${relative(ROOT, file)} imports "${specifier}"\n  ${rule.message}`
					);
				}
			}
		}
	}
}

if (violations.length > 0) {
	console.error(`Import boundary violations: ${violations.length}\n`);
	for (const violation of violations) console.error(`- ${violation}`);
	process.exit(1);
}

console.log('Import boundaries are clean.');
