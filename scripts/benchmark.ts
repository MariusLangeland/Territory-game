import { performance } from 'node:perf_hooks';
import { generateMap } from '../src/lib/game/map';
import { GROWTH_MODES } from '../src/lib/game/growth';
import { TerritorySimulation } from '../src/lib/game/simulation';
import { MAP_HEIGHT, MAP_WIDTH, PLAYER_COUNT } from '../src/lib/game/constants';

function measure(label: string, iterations: number, fn: () => void): number {
	// Warm up the JIT before recording.
	for (let i = 0; i < Math.min(5, iterations); i++) fn();
	const started = performance.now();
	for (let i = 0; i < iterations; i++) fn();
	const elapsed = performance.now() - started;
	const average = elapsed / iterations;
	console.log(
		`${label.padEnd(36)} ${average.toFixed(3).padStart(8)} ms/op   (${iterations} ops in ${elapsed.toFixed(0)} ms)`
	);
	return average;
}

console.log(
	`Map: ${MAP_WIDTH} x ${MAP_HEIGHT} pixels = ${(MAP_WIDTH * MAP_HEIGHT).toLocaleString()} cells`
);
console.log(`States: ${PLAYER_COUNT} (1 human + ${PLAYER_COUNT - 1} attacking AI)\n`);

const generation = measure('generate map + starts', 5, () => {
	generateMap(0xbeefcafe);
});

const sustained = new TerritorySimulation({ seed: 0x12345678 });
const sustainedStep = measure('all-bot attack tick (sustained)', 1000, () => sustained.step());
const sustainedSnapshot = sustained.getSnapshot();

const busy = new TerritorySimulation({ seed: 0x87654321 });
for (let i = 0; i < 100; i++) busy.step();
const busyStep = measure('all-bot attack tick (collision-heavy)', 500, () => busy.step());
const busySnapshot = busy.getSnapshot();

console.log('');
for (const mode of GROWTH_MODES) {
	const sim = new TerritorySimulation({ seed: 0x13572468, growthMode: mode });
	for (let i = 0; i < 100; i++) sim.step();
	measure(`growth=${mode.padEnd(9)} tick`, 300, () => sim.step());
	console.log(`  active fronts: ${sim.getSnapshot().attacks.length}`);
}

const checksum = measure('full-state checksum', 5, () => {
	busy.checksum();
});

const memory = process.memoryUsage();
console.log('');
console.log(`Map generation: ${generation.toFixed(1)} ms`);
console.log(
	`Sustained stress tick: ${sustainedStep.toFixed(3)} ms (${sustainedStep.toFixed(2)}% of a 10 Hz tick budget)`
);
console.log(
	`Collision-heavy tick: ${busyStep.toFixed(3)} ms (${busyStep.toFixed(2)}% of a 10 Hz tick budget)`
);
console.log(
	`Active attacks after run: ${sustainedSnapshot.attacks.length} / ${busySnapshot.attacks.length}`
);
console.log(`Checksum: ${checksum.toFixed(1)} ms`);
console.log(`Node RSS: ${(memory.rss / 1024 / 1024).toFixed(1)} MiB`);
