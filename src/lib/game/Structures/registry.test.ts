import { describe, expect, it } from 'vitest';
import { StructureRegistry } from './registry';

describe('structure registry spacing index', () => {
	it('finds nearby structures across bucket boundaries', () => {
		const registry = new StructureRegistry();
		const structure = registry.create('barracks', 1, 31, 31, 64);
		expect(registry.hasWithinRadius(30, 30, 8)).toBe(true);
		expect(registry.hasWithinRadius(39, 39, 8)).toBe(false);
		registry.destroy(structure);
		expect(registry.hasWithinRadius(30, 30, 8)).toBe(false);
	});

	it('keeps the index in sync after destruction and recreation', () => {
		const registry = new StructureRegistry();
		const first = registry.create('command-post', 1, 10, 10, 64);
		expect(registry.hasWithinRadius(11, 10, 3)).toBe(true);
		registry.destroy(first);
		expect(registry.hasWithinRadius(11, 10, 3)).toBe(false);
		const replacement = registry.create('command-post', 1, 11, 10, 64);
		expect(registry.hasWithinRadius(11, 10, 3)).toBe(true);
		registry.destroy(replacement);
	});
});
