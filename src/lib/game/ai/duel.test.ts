import { describe, expect, it } from 'vitest';
import { DuelLab, normalizeDuelConfig } from './duel';

function playToEnd(lab: DuelLab): void {
	let guard = 0;
	while (lab.phase !== 'finished' && guard++ < 500) {
		if (lab.phase === 'idle') lab.begin();
		if (lab.phase === 'match') {
			while (!lab.step(500)) {
				// Run the current round to completion.
			}
			lab.finishRound();
			continue;
		}
		if (lab.phase === 'round-complete') lab.nextRound();
	}
}

describe('explicit 1v1 duel mode', () => {
	it('keeps both named characters and mutates the least fit every block', () => {
		const lab = new DuelLab({
			seed: 11,
			rounds: 4,
			roundsPerMutation: 2,
			ticks: 200,
			width: 640,
			height: 360,
			names: ['ALPHA', 'BETA']
		});
		lab.begin();
		playToEnd(lab);
		expect(lab.characters.map((character) => character.name)).toEqual(['ALPHA', 'BETA']);
		expect(lab.rounds).toHaveLength(4);
		expect(lab.mutations).toHaveLength(2);
		expect(lab.nodes).toHaveLength(4);
		expect(lab.characters.reduce((total, character) => total + character.mutations, 0)).toBe(2);
		expect(
			lab.characters.every(
				(character) =>
					character.currentNodeId ===
					lab.nodes.find((node) => node.id === character.currentNodeId)?.id
			)
		).toBe(true);
		for (const mutation of lab.mutations) {
			const from = lab.nodes.find((node) => node.id === mutation.fromNodeId);
			const to = lab.nodes.find((node) => node.id === mutation.toNodeId);
			expect(from).toBeDefined();
			expect(to).toBeDefined();
			expect(to?.parentId).toBe(from?.id);
			expect(to?.characterIndex).toBe(mutation.characterIndex);
		}
		const firstBlock = lab.rounds.slice(0, 2);
		const blockFitness = [0, 1].map((character) =>
			firstBlock.reduce((total, round) => total + round.fitness[character], 0)
		);
		// The first mutation must target the lower-fitness side (or its
		// deterministic tie-break when the scores are exactly equal).
		if (blockFitness[0] !== blockFitness[1]) {
			expect(lab.mutations[0].characterIndex).toBe(blockFitness[0] < blockFitness[1] ? 0 : 1);
		}
	});

	it('starts both duel characters close together near the map centre', () => {
		const lab = new DuelLab({
			seed: 11,
			rounds: 2,
			roundsPerMutation: 1,
			ticks: 200,
			width: 640,
			height: 360
		});
		lab.begin();
		const simulation = lab.currentSimulation;
		expect(simulation).not.toBeNull();
		if (!simulation) return;
		const [first, second] = simulation.map.starts;
		const cx = simulation.width / 2;
		const cy = simulation.height / 2;
		const centreDistance = (point: { x: number; y: number }): number =>
			Math.hypot(point.x + 0.5 - cx, point.y + 0.5 - cy);
		const separation = Math.hypot(first.x - second.x, first.y - second.y);
		expect(centreDistance(first)).toBeLessThan(
			Math.min(simulation.width, simulation.height) * 0.32
		);
		expect(centreDistance(second)).toBeLessThan(
			Math.min(simulation.width, simulation.height) * 0.32
		);
		expect(separation).toBeGreaterThanOrEqual(48);
		expect(separation).toBeLessThanOrEqual(176);
	});

	it('is deterministic and persists both characters without culling', () => {
		const config = {
			seed: 44,
			rounds: 4,
			roundsPerMutation: 2,
			ticks: 200,
			width: 640,
			height: 360,
			names: ['RED', 'BLUE'] as [string, string]
		};
		const left = new DuelLab(config);
		const right = new DuelLab(config);
		left.begin();
		right.begin();
		playToEnd(left);
		playToEnd(right);
		expect(left.nodes.map((node) => node.id)).toEqual(right.nodes.map((node) => node.id));
		expect(left.mutations).toEqual(right.mutations);
		expect(left.rounds.map((round) => round.checksum)).toEqual(
			right.rounds.map((round) => round.checksum)
		);
		expect(left.characters.every((character) => character.matches === 4)).toBe(true);
	});

	it('normalizes names, round counts, and mutation cadence', () => {
		const config = normalizeDuelConfig({
			names: ['', '   '],
			rounds: 1,
			roundsPerMutation: 100,
			ticks: 10
		});
		expect(config.names).toEqual(['ALPHA', 'BETA']);
		expect(config.rounds).toBe(2);
		expect(config.roundsPerMutation).toBe(20);
		expect(config.ticks).toBe(200);
	});
});
