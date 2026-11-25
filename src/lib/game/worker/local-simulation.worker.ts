import { LocalWorkerHost } from './local-host';
import type { LocalWorkerInbound, LocalWorkerOutbound } from './local-protocol';

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

function postReplayStatus(): void {
	if (host?.config.replay) scope.postMessage(host.replayStatus());
}

let pendingSeekTick: number | null = null;
let seekTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Coalesce scrub messages so a burst only replays to the final requested tick.
 * The worker is single-threaded, so this also avoids queuing every intermediate
 * prefix seek behind a long replay.
 */
function performPendingSeek(): void {
	if (seekTimer) {
		clearTimeout(seekTimer);
		seekTimer = null;
	}
	const tick = pendingSeekTick;
	pendingSeekTick = null;
	if (!host || tick === null) return;
	const visual = host.seekReplay(tick);
	postVisualMessage(visual);
	postReplayStatus();
	if (!host.ended && !host.isPaused) {
		lastTickAt = 0;
		accumulator = 0;
		schedule();
	}
}

function scheduleSeek(tick: number): void {
	pendingSeekTick = tick;
	if (seekTimer) return;
	seekTimer = setTimeout(() => {
		seekTimer = null;
		performPendingSeek();
	}, 0);
}

function flushPendingSeek(): void {
	if (pendingSeekTick === null) return;
	performPendingSeek();
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
		const stepMs = TICK_MS / host.speed;
		accumulator += current - lastTickAt;
		lastTickAt = current;
		let steps = 0;
		const maxSteps = host.config.replay ? 16 : 4;
		while (accumulator >= stepMs && steps < maxSteps) {
			postVisual();
			accumulator -= stepMs;
			steps++;
			if (host.ended) break;
		}
		if (accumulator > stepMs * maxSteps) accumulator = stepMs * maxSteps;
		if (host.config.replay) postReplayStatus();
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
		pendingSeekTick = null;
		if (seekTimer) {
			clearTimeout(seekTimer);
			seekTimer = null;
		}
		host = new LocalWorkerHost(message.config);
		const init = host.initMessage();
		// Terrain arrays are still owned by the worker simulation; only the copied
		// owners/district buffers are transferred.
		scope.postMessage(init, [init.owners.buffer, init.districtColorCodes.buffer]);
		if (host.config.replay) postReplayStatus();
		schedule();
		return;
	}
	if (!host) return;
	if (message.type === 'replay-control') {
		if (!host.config.replay) return;
		switch (message.action) {
			case 'play':
				flushPendingSeek();
				host.setPaused(false);
				lastTickAt = 0;
				accumulator = 0;
				postReplayStatus();
				schedule();
				return;
			case 'pause':
				flushPendingSeek();
				host.setPaused(true);
				if (timer) {
					clearTimeout(timer);
					timer = null;
				}
				accumulator = 0;
				postReplayStatus();
				return;
			case 'seek':
				scheduleSeek(message.tick ?? 0);
				return;
			case 'step': {
				flushPendingSeek();
				const target = host.tick + (message.delta ?? 1);
				const visual = host.seekReplay(target);
				postVisualMessage(visual);
				postReplayStatus();
				return;
			}
			case 'speed':
				host.setReplaySpeed(message.speed ?? 1);
				lastTickAt = 0;
				accumulator = 0;
				postReplayStatus();
				return;
		}
	}
	if (message.type === 'pause') {
		host.setPaused(true);
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
		accumulator = 0;
		scope.postMessage({ type: 'paused' });
		if (host.config.replay) postReplayStatus();
		return;
	}
	if (message.type === 'resume') {
		host.setPaused(false);
		lastTickAt = 0;
		accumulator = 0;
		if (host.config.replay) postReplayStatus();
		schedule();
		return;
	}
	if (message.type === 'apply-intent') {
		host.applyIntent(message.tick, message.playerId, message.intent);
		return;
	}
	if (message.type === 'command') {
		const result = host.command(message);
		scope.postMessage(result);
	}
};
