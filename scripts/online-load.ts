import { performance } from 'node:perf_hooks';
import { OnlineRoom } from '../src/lib/game/net/online-room';

/**
 * Support target: 200 concurrent humans at 10 Hz on one process.
 * Packing: 25 rooms x 8 humans, 8 states per room, compact 1280x720 arena.
 */
const ROOMS = 25;
const HUMANS_PER_ROOM = 8;
const STATES = 8;
const WARMUP_TICKS = 50;
const MEASURED_TICKS = 300;

const TARGET = {
	p95TickMs: 50,
	p99TickMs: 300,
	maxRssMiB: 1536,
	tickRate: 10
};

interface LoadRoom {
	room: OnlineRoom;
	tokens: string[];
}

function buildRooms(): LoadRoom[] {
	const rooms: LoadRoom[] = [];
	for (let index = 0; index < ROOMS; index++) {
		const room = new OnlineRoom(`load-${index}`, {
			totalStates: STATES,
			maxHumans: HUMANS_PER_ROOM,
			seed: 10_000 + index,
			mapWidth: 1280,
			mapHeight: 720,
			botDifficulty: 'standard',
			timerMinutes: 0,
			botCommandPostStacks: 0
		});
		const tokens: string[] = [];
		for (let seat = 0; seat < HUMANS_PER_ROOM; seat++) {
			const token = `load-${index}-seat-${seat}`;
			room.join(`PLAYER ${seat + 1}`, token);
			tokens.push(token);
		}
		room.start(tokens[0]);
		rooms.push({ room, tokens });
	}
	return rooms;
}

function percentile(sorted: readonly number[], fraction: number): number {
	const index = Math.min(
		sorted.length - 1,
		Math.max(0, Math.floor((sorted.length - 1) * fraction))
	);
	return sorted[index] ?? 0;
}

const rooms = buildRooms();
const cpuStart = process.cpuUsage();
for (let tick = 0; tick < WARMUP_TICKS; tick++) {
	for (const { room, tokens } of rooms) {
		room.tickOnce();
		for (const token of tokens) room.tickFor(token);
	}
}

const tickTimes: number[] = [];
let payloadBytes = 0;
const started = performance.now();
for (let tick = 0; tick < MEASURED_TICKS; tick++) {
	const tickStart = performance.now();
	for (const { room, tokens } of rooms) {
		room.tickOnce();
		for (const token of tokens) {
			const payload = room.tickFor(token);
			payloadBytes += JSON.stringify(payload).length;
		}
	}
	tickTimes.push(performance.now() - tickStart);
}
const elapsedMs = performance.now() - started;
const cpu = process.cpuUsage(cpuStart);
const sorted = [...tickTimes].sort((left, right) => left - right);
const average =
	tickTimes.reduce((total, value) => total + value, 0) / Math.max(1, tickTimes.length);
const result = {
	players: ROOMS * HUMANS_PER_ROOM,
	rooms: ROOMS,
	humansPerRoom: HUMANS_PER_ROOM,
	states: STATES,
	tickRate: TARGET.tickRate,
	tickAvgMs: Number(average.toFixed(2)),
	tickP50Ms: Number(percentile(sorted, 0.5).toFixed(2)),
	tickP95Ms: Number(percentile(sorted, 0.95).toFixed(2)),
	tickP99Ms: Number(percentile(sorted, 0.99).toFixed(2)),
	tickMaxMs: Number((sorted[sorted.length - 1] ?? 0).toFixed(2)),
	ticksPerSecondAchievable: Number((1000 / Math.max(0.001, average)).toFixed(1)),
	payloadMiBPerSecondAt10Hz: Number(
		(payloadBytes / (MEASURED_TICKS / TARGET.tickRate) / 1024 / 1024).toFixed(2)
	),
	averagePayloadBytes: Math.round(payloadBytes / (ROOMS * HUMANS_PER_ROOM * MEASURED_TICKS)),
	cpuUserSeconds: Number((cpu.user / 1_000_000).toFixed(2)),
	cpuSystemSeconds: Number((cpu.system / 1_000_000).toFixed(2)),
	wallSeconds: Number((elapsedMs / 1000).toFixed(2)),
	rssMiB: Number((process.memoryUsage().rss / 1024 / 1024).toFixed(0)),
	target: TARGET
};
console.log(JSON.stringify(result, null, 2));

const failures: string[] = [];
if (result.tickP95Ms > TARGET.p95TickMs) failures.push(`p95 ${result.tickP95Ms}ms`);
if (result.tickP99Ms > TARGET.p99TickMs) failures.push(`p99 ${result.tickP99Ms}ms`);
if (result.rssMiB > TARGET.maxRssMiB) failures.push(`RSS ${result.rssMiB}MiB`);
if (failures.length > 0) {
	console.error(`ONLINE LOAD TARGET FAILED: ${failures.join(', ')}`);
	process.exitCode = 1;
} else {
	console.log(
		`ONLINE TARGET PASS: 200 players, p95 ${result.tickP95Ms}ms, p99 ${result.tickP99Ms}ms, RSS ${result.rssMiB}MiB`
	);
}
