'use strict';
/**
 * End-to-end smoke test for the built local-simulation Web Worker.
 *
 * The worker bundle is a browser IIFE; this harness runs it in a Node worker
 * with a minimal `self` shim. It verifies structured-clone init transfer, owner
 * delta transfer, command round-trips, merged-district payloads, and that pause
 * actually stops the tick stream after its pause acknowledgment.
 *
 * Optional atlas override:
 *   WORKER_SMOKE_WIDTH=4096 WORKER_SMOKE_HEIGHT=2048 WORKER_SMOKE_PLAYERS=51 pnpm test:worker
 */
const fs = require('node:fs');
const path = require('node:path');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');

const WORKER_DIR = path.resolve(__dirname, '../build/client/_app/immutable/workers');

if (!isMainThread) {
	globalThis.self = {
		postMessage(message, transfer) {
			parentPort.postMessage(message, transfer);
		},
		onmessage: null
	};
	const source = fs.readFileSync(workerData.workerPath, 'utf8');
	new Function(source)();
	parentPort.on('message', (message) => {
		globalThis.self.onmessage?.({ data: message });
	});
	return;
}

const workerFile = fs
	.readdirSync(WORKER_DIR)
	.find((entry) => entry.startsWith('local-simulation.worker-') && entry.endsWith('.js'));
if (!workerFile) {
	console.error(`No built local worker found in ${WORKER_DIR}; run pnpm build first.`);
	process.exit(1);
}

const width = Number(process.env.WORKER_SMOKE_WIDTH ?? 512);
const height = Number(process.env.WORKER_SMOKE_HEIGHT ?? 256);
const playerCount = Number(process.env.WORKER_SMOKE_PLAYERS ?? 8);
const seed = Number(process.env.WORKER_SMOKE_SEED ?? 1234);
const startedAt = Date.now();
const worker = new Worker(__filename, {
	workerData: { workerPath: path.join(WORKER_DIR, workerFile) }
});
worker.postMessage({
	type: 'init',
	config: {
		seed,
		width,
		height,
		playerCount,
		growthMode: 'organic',
		botDifficulty: 'standard',
		matchDurationTicks: 0,
		botCommandPostStacks: 0
	}
});

let init = null;
let initMs = 0;
let ticks = 0;
let ticksAtPause = 0;
let commandResult = null;
let failures = [];
let phase = 'init';

const timeout = setTimeout(() => {
	console.error('WORKER SMOKE TIMEOUT', { phase, ticks, failures });
	worker.terminate();
	process.exit(1);
}, 20_000);

worker.on('error', (error) => {
	console.error('WORKER SMOKE ERROR', error);
	process.exit(1);
});

worker.on('message', (message) => {
	if (message.type === 'init') {
		init = message;
		initMs = Date.now() - startedAt;
		if (init.width !== width || init.height !== height) failures.push('dimensions');
		if (init.starts.length !== playerCount) failures.push('starts');
		if (init.owners.length !== width * height) failures.push('owners');
		if (!Array.isArray(init.mergedDistricts)) failures.push('merged init');
		phase = 'running';
		worker.postMessage({
			type: 'command',
			id: 1,
			command: { type: 'alliance-request', targetPlayerId: 2 }
		});
		worker.postMessage({ type: 'resume' });
		return;
	}
	if (message.type === 'visual') {
		ticks++;
		if (!(message.changes instanceof Uint32Array)) failures.push('changes type');
		if (!message.snapshot || message.snapshot.tick !== message.tick) failures.push('tick mismatch');
		if (!Array.isArray(message.mergedDistricts)) failures.push('merged visual');
		if (ticks >= 5 && phase === 'running') {
			phase = 'pausing';
			worker.postMessage({ type: 'pause' });
		}
		return;
	}
	if (message.type === 'paused') {
		if (phase === 'pausing') {
			phase = 'paused';
			ticksAtPause = ticks;
			setTimeout(finish, 400);
		}
		return;
	}
	if (message.type === 'command-result') {
		commandResult = { ok: message.ok, id: message.id, message: message.message };
		if (message.id !== 1) failures.push('command id');
	}
});

function finish() {
	clearTimeout(timeout);
	if (ticks !== ticksAtPause) failures.push('ticks advanced while paused');
	phase = 'done';
	console.log(
		JSON.stringify({
			workerFile,
			width,
			height,
			playerCount,
			init: Boolean(init),
			initMs,
			elapsedMs: Date.now() - startedAt,
			ticks,
			commandResult,
			failures
		})
	);
	worker.terminate();
	process.exit(failures.length > 0 || ticks < 5 || !commandResult ? 1 : 0);
}
