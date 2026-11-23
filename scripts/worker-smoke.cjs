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
const commandResults = new Map();
let expectedCommandCount = 0;
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
		const start = init.starts[0];
		const cardId = init.snapshot.hand[0]?.id ?? 0;
		const ownStructure = init.snapshot.structures.find(
			(structure) => structure.ownerId === init.snapshot.humanId && structure.type !== 'state'
		);
		const commands = [
			{ type: 'alliance-request', targetPlayerId: 2 },
			{ type: 'build', cardId, x: start.x, y: start.y },
			{ type: 'attack', x: start.x + 10, y: start.y },
			{ type: 'artillery', x: start.x, y: start.y },
			{ type: 'demolish', structureId: ownStructure?.id ?? 0 },
			{ type: 'upgrade', x: start.x, y: start.y, levels: 1, merged: true },
			{ type: 'naval', x: start.x + 50, y: start.y },
			{ type: 'cancel-attack' },
			{ type: 'alliance-break', targetPlayerId: 2 }
		];
		expectedCommandCount = commands.length;
		for (let index = 0; index < commands.length; index++) {
			worker.postMessage({
				type: 'command',
				id: index + 1,
				command: commands[index]
			});
		}
		worker.postMessage({ type: 'resume' });
		return;
	}
	if (message.type === 'visual') {
		ticks++;
		if (!(message.changes instanceof Uint32Array)) failures.push('changes type');
		if (!message.snapshot || message.snapshot.tick !== message.tick) failures.push('tick mismatch');
		if (!Array.isArray(message.mergedDistricts)) failures.push('merged visual');
		if (message.districtTiles.length > 0 && !(message.districtTileColors instanceof Uint8Array)) {
			failures.push('district colors');
		}
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
			scheduleFinish();
		}
		return;
	}
	if (message.type === 'command-result') {
		if (message.id < 1 || message.id > expectedCommandCount) failures.push('command id');
		if (commandResults.has(message.id)) failures.push('duplicate command id');
		commandResults.set(message.id, { ok: message.ok, message: message.message });
		if (phase === 'paused' && commandResults.size === expectedCommandCount) scheduleFinish();
	}
});

let finishTimer = null;
function scheduleFinish() {
	if (finishTimer) return;
	finishTimer = setTimeout(finish, 400);
}

function finish() {
	clearTimeout(timeout);
	if (ticks !== ticksAtPause) failures.push('ticks advanced while paused');
	if (commandResults.size !== expectedCommandCount) failures.push('missing command results');
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
			commandResults: [...commandResults.entries()],
			failures
		})
	);
	worker.terminate();
	process.exit(
		failures.length > 0 || ticks < 5 || commandResults.size !== expectedCommandCount ? 1 : 0
	);
}
