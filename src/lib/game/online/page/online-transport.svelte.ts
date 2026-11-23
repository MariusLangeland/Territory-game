import { generateMap } from '#lib/game/map';
import {
	decodeByteRuns,
	decodeOwnerRuns,
	type OnlineBaseline,
	type OnlineRoomView,
	type OnlineTick
} from '#lib/game/net/online-protocol';
import type { WorkerMatchInit } from '#lib/game/worker/protocol';
import { RemoteSimulationView } from '#lib/game/worker/view';
import type { OnlinePageState } from './online-page-state.svelte';
import { loadOnlineSession } from './online-session';

interface ServerEventShape {
	type?: string;
	room?: OnlineRoomView;
	baseline?: OnlineBaseline;
	tick?: OnlineTick;
}

const MAX_PENDING_VISUALS = 8;

/**
 * Owns the room event stream. The server pushes a `room` view, a `welcome`
 * baseline (on subscribe/reconnect), authoritative `tick` deltas, and a final
 * `complete`; this module turns those into the page's render view.
 */
export function createOnlineTransport(state: OnlinePageState) {
	let eventSource: EventSource | null = null;
	let visualRevision = 0;

	function close(): void {
		eventSource?.close();
		eventSource = null;
		state.connected = false;
	}

	function subscribe(): void {
		const room = state.room;
		if (!room || !state.token) return;
		close();
		const source = new EventSource(
			`/api/online/rooms/${encodeURIComponent(room.roomId)}/events?token=${encodeURIComponent(
				state.token
			)}`
		);
		eventSource = source;
		source.onopen = () => {
			state.connected = true;
			state.status = 'Connected to the match server.';
		};
		source.onerror = () => {
			state.connected = false;
			state.status = 'Connection interrupted. Reconnecting…';
		};
		source.onmessage = (message) => {
			try {
				handleServerEvent(JSON.parse(message.data));
			} catch {
				// Ignore malformed events rather than desynchronising silently.
			}
		};
	}

	function handleServerEvent(event: unknown): void {
		if (!event || typeof event !== 'object') return;
		const typed = event as ServerEventShape;
		if (typed.type === 'room' && typed.room) {
			state.room = typed.room;
			return;
		}
		if (typed.type === 'welcome' && typed.baseline) {
			applyBaseline(typed.baseline);
			return;
		}
		if (typed.type === 'tick' && typed.tick) {
			applyTick(typed.tick);
			return;
		}
		if (typed.type === 'complete' && typed.room) {
			state.room = typed.room;
			state.status = 'Match complete.';
		}
	}

	function applyBaseline(baseline: OnlineBaseline): void {
		state.playerId = baseline.playerId;
		const map = generateMap(baseline.config.seed, {
			playerCount: baseline.config.totalStates,
			width: baseline.config.mapWidth ?? 1280,
			height: baseline.config.mapHeight ?? 720
		});
		const owners = decodeOwnerRuns(baseline.ownerRuns, map.width * map.height);
		const districtColorCodes = decodeByteRuns(baseline.districtColorRuns, map.width * map.height);
		const init: WorkerMatchInit = {
			width: map.width,
			height: map.height,
			starts: map.starts,
			terrain: map.land,
			terrainShade: map.shade,
			terrainElevation: map.elevation,
			owners,
			districtColorCodes,
			snapshot: baseline.snapshot
		};
		state.remoteView = new RemoteSimulationView(init);
		state.snapshot = baseline.snapshot;
		state.visuals = [];
		visualRevision = 0;
		const stored = state.room ? loadOnlineSession(state.room.roomId) : null;
		if (stored && stored.sequence > state.intentSequence) state.intentSequence = stored.sequence;
	}

	function applyTick(tick: OnlineTick): void {
		const view = state.remoteView;
		// A reconnect or an overflowed delta needs a fresh authoritative baseline,
		// so resubscribe instead of applying a partial owner map.
		if (!view || tick.changesOverflow) {
			subscribe();
			return;
		}
		const changes = Uint32Array.from(tick.changes);
		const districtTiles = tick.districtTiles;
		const districtTileColors =
			tick.districtTileColors.length > 0 ? Uint8Array.from(tick.districtTileColors) : null;
		view.applyVisual({
			matchId: 1,
			tick: tick.tick,
			snapshot: tick.snapshot,
			changes,
			changeCount: changes.length,
			overflow: false,
			owners: null,
			districtColorCodes: null,
			districtTiles,
			districtTileColors,
			markovStates: []
		});
		state.snapshot = tick.snapshot;
		visualRevision++;
		state.visuals = [
			...state.visuals,
			{
				revision: visualRevision,
				tick: tick.tick,
				snapshot: tick.snapshot,
				changes,
				changeCount: changes.length,
				overflow: false,
				districtTiles
			}
		].slice(-MAX_PENDING_VISUALS);
	}

	function acknowledgeVisuals(lastRevision: number): void {
		state.visuals = state.visuals.filter((visual) => visual.revision > lastRevision);
	}

	return {
		subscribe,
		close,
		handleServerEvent,
		applyBaseline,
		applyTick,
		acknowledgeVisuals
	};
}

export type OnlineTransport = ReturnType<typeof createOnlineTransport>;
