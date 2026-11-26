import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';

const packageJson = JSON.parse(
	readFileSync(new URL('./package.json', import.meta.url), 'utf8')
) as { version: string };

export default defineConfig({
	define: {
		__APP_VERSION__: JSON.stringify(packageJson.version)
	},
	// GitHub Pages project sites are served from /<repository>/.
	// Set BASE_PATH="/repo" at build time; leave empty for a user site.
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter({ fallback: 'index.html' }),
			paths: {
				base: (process.env.BASE_PATH ?? '') as '' | `/${string}`
			}
		})
	],
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'fast',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}', 'src/lib/game/simulation.*.test.ts']
				}
			},
			{
				extends: './vite.config.ts',
				test: {
					name: 'stress',
					environment: 'node',
					include: ['src/lib/game/simulation.*.test.ts']
				}
			}
		]
	}
});
