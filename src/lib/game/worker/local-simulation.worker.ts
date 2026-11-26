import { MatchViewHost } from '../view/worker-host';
import type { LocalWorkerInbound, LocalWorkerOutbound } from './local-protocol';

const TICK_MS = 100;
const TELEMETRY_INTERVAL_MS = 1000;

const scope = self as unknown as {
	postMessage(message: LocalWorkerOutbound, transfer?: Transferable[]): void;
	onmessage: ((event: MessageEvent<LocalWorkerInbound>) => void) | null;
};

let host: MatchViewHost | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let accumulator = 0;
let lastTickAt = 0;
let lastTelemetryAt = 0;
let finalTelemetrySent = false;

function postVisualMessage(visual: LocalWorkerOutbound | null): void {
	if (!visual || visual.type !== 'visual') return;
	const transfer: Transferable[] = [visual.changes.buffer];
	if (visual.owners) transfer.push(visual.owners.buffer);
	if (visual.changeDistrictColors) transfer.push(visual.changeDistrictColors.buffer);
	if (visual.districtTileColors) transfer.push(visual.districtTileColors.buffer);
	if (visual.districtColorCodes) transfer.push(visual.districtColorCodes.buffer);
	scope.postMessage(visual, transfer);
}

function postVisual(): void {
	if (!host) return;
	postVisualMessage(host.step());
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
		host = new MatchViewHost(message.config);
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
		scope.postMessage({ type: 'paused' });
		return;
	}
	if (message.type === 'resume') {
		host.setPaused(false);
		lastTickAt = 0;
		accumulator = 0;
		schedule();
		return;
	}
	if (message.type === 'apply-intent') {
		host.applyIntent(message.tick, message.playerId, message.intent);
		return;
	}
	if (message.type === 'command') {
		scope.postMessage(host.command(message));
	}
};
