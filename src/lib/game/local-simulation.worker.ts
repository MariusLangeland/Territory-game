import { LocalWorkerHost } from './local-worker-host';
import type { LocalWorkerInbound, LocalWorkerOutbound } from './local-worker-protocol';

const TICK_MS = 100;
const TELEMETRY_INTERVAL_MS = 1000;

const scope = self as unknown as {
	postMessage(message: LocalWorkerOutbound, transfer?: Transferable[]): void;
	onmessage: ((event: MessageEvent<LocalWorkerInbound>) => void) | null;
};

let host: LocalWorkerHost | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let accumulator = 0;
let lastTickAt = 0;
let lastTelemetryAt = 0;
let finalTelemetrySent = false;

function postVisual(): void {
	if (!host) return;
	const visual = host.step();
	if (!visual) return;
	scope.postMessage(visual, [visual.changes.buffer]);
}

function schedule(): void {
	if (timer) return;
	const now = performance.now();
	if (lastTickAt === 0) {
		lastTickAt = now;
		accumulator = 0;
	}
	timer = setTimeout(() => {
		timer = null;
		if (!host) return;
		const current = performance.now();
		accumulator += current - lastTickAt;
		lastTickAt = current;
		let steps = 0;
		while (accumulator >= TICK_MS && steps < 4) {
			postVisual();
			accumulator -= TICK_MS;
			steps++;
			if (host.ended) break;
		}
		if (accumulator > TICK_MS * 4) accumulator = TICK_MS * 4;
		if (host.ended && !finalTelemetrySent) {
			finalTelemetrySent = true;
			scope.postMessage(host.telemetry());
		} else if (current - lastTelemetryAt >= TELEMETRY_INTERVAL_MS) {
			lastTelemetryAt = current;
			scope.postMessage(host.telemetry());
		}
		if (!host.ended) schedule();
	}, TICK_MS);
}

scope.onmessage = (event: MessageEvent<LocalWorkerInbound>) => {
	const message = event.data;
	if (!message || typeof message !== 'object') return;
	if (message.type === 'init') {
		host = new LocalWorkerHost(message.config);
		const init = host.initMessage();
		// Terrain arrays are still owned by the worker simulation; only the copied
		// owners/district buffers are transferred.
		scope.postMessage(init, [init.owners.buffer, init.districtColorCodes.buffer]);
		schedule();
		return;
	}
	if (!host) return;
	if (message.type === 'pause') {
		host.setPaused(true);
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
		accumulator = 0;
		return;
	}
	if (message.type === 'resume') {
		host.setPaused(false);
		lastTickAt = 0;
		accumulator = 0;
		schedule();
		return;
	}
	if (message.type === 'command') {
		const result = host.command(message);
		scope.postMessage(result);
	}
};
