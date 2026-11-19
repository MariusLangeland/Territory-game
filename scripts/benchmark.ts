import { performance } from 'node:perf_hooks';
import { generateMap } from '../src/lib/game/map';
import { TerritorySimulation } from '../src/lib/game/simulation';
import { MAP_HEIGHT, MAP_WIDTH } from '../src/lib/game/constants';

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
	`Map: ${MAP_WIDTH} x ${MAP_HEIGHT} pixels = ${(MAP_WIDTH * MAP_HEIGHT).toLocaleString()} cells\n`
);

const generation = measure('generate map', 5, () => {
	generateMap(0xbeefcafe);
});

const idle = new TerritorySimulation({ seed: 0x12345678 });
const idleStep = measure('idle simulation tick', 1000, () => idle.step());

const busy = new TerritorySimulation({ seed: 0x87654321 });
for (let i = 0; i < 100; i++) busy.step();
const busyStep = measure('mid-match simulation tick', 500, () => busy.step());

const checksum = measure('full-state checksum', 5, () => {
	busy.checksum();
});

const memory = process.memoryUsage();
console.log('');
console.log(`Map generation: ${generation.toFixed(1)} ms`);
console.log(
	`Idle tick: ${idleStep.toFixed(3)} ms (${((idleStep / 100) * 100).toFixed(2)}% of a 10 Hz tick budget)`
);
console.log(
	`Busy tick: ${busyStep.toFixed(3)} ms (${((busyStep / 100) * 100).toFixed(2)}% of a 10 Hz tick budget)`
);
console.log(`Checksum: ${checksum.toFixed(1)} ms`);
console.log(`Node RSS: ${(memory.rss / 1024 / 1024).toFixed(1)} MiB`);
