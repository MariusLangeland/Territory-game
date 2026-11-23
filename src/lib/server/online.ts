import { randomBytes, randomUUID } from 'node:crypto';
import { OnlineRoom } from '../game/net/online-room';
import type {
	OnlineBaseline,
	OnlineIntentEnvelope,
	OnlineIntentResult,
	OnlineJoinResponse,
	OnlineRoomConfig,
	OnlineRoomListEntry,
	OnlineRoomView,
	OnlineTick
} from '../game/net/online-protocol';

const TICK_INTERVAL_MS = 100;
const ROOM_IDLE_MS = 30 * 60 * 1000;

export type OnlineServerEvent =
	| { type: 'room'; room: OnlineRoomView }
	| { type: 'welcome'; baseline: OnlineBaseline }
	| { type: 'tick'; tick: OnlineTick }
	| { type: 'complete'; room: OnlineRoomView };

interface Subscriber {
	token: string;
	send: (event: OnlineServerEvent) => void;
}

interface ManagedRoom {
	room: OnlineRoom;
	createdAt: number;
	lastActivityAt: number;
	subscribers: Set<Subscriber>;
}

const rooms = new Map<string, ManagedRoom>();
let tickTimer: ReturnType<typeof setInterval> | null = null;

function roomId(): string {
	for (let attempt = 0; attempt < 20; attempt++) {
		const id = randomBytes(4).toString('hex');
		if (!rooms.has(id)) return id;
	}
	throw new Error('Could not allocate a room id.');
}

function ensureTickLoop(): void {
	if (tickTimer) return;
	tickTimer = setInterval(() => {
		runTick();
		cleanupIdleRooms();
	}, TICK_INTERVAL_MS);
	tickTimer.unref?.();
}

function runTick(): void {
	for (const managed of rooms.values()) {
		if (managed.room.currentPhase !== 'running') continue;
		const tick = managed.room.tickOnce();
		if (!tick) continue;
		for (const subscriber of managed.subscribers) {
			try {
				subscriber.send({
					type: 'tick',
					tick: managed.room.tickFor(subscriber.token)
				});
			} catch {
				managed.subscribers.delete(subscriber);
			}
		}
		if (managed.room.completed) {
			for (const subscriber of managed.subscribers) {
				subscriber.send({ type: 'complete', room: managed.room.view() });
			}
		}
	}
}

function cleanupIdleRooms(): void {
	const now = Date.now();
	for (const [id, managed] of rooms) {
		if (managed.subscribers.size > 0) continue;
		if (now - managed.lastActivityAt < ROOM_IDLE_MS) continue;
		rooms.delete(id);
	}
	if (rooms.size === 0 && tickTimer) {
		clearInterval(tickTimer);
		tickTimer = null;
	}
}

function broadcastRoom(managed: ManagedRoom): void {
	for (const subscriber of managed.subscribers) {
		subscriber.send({ type: 'room', room: managed.room.view() });
	}
}

export function createRoom(displayName: string, config: OnlineRoomConfig): OnlineJoinResponse {
	const id = roomId();
	const room = new OnlineRoom(id, config);
	const token = randomUUID();
	const joined = room.join(displayName, token);
	const managed: ManagedRoom = {
		room,
		createdAt: Date.now(),
		lastActivityAt: Date.now(),
		subscribers: new Set()
	};
	rooms.set(id, managed);
	ensureTickLoop();
	return { roomId: id, playerId: joined.playerId, token, room: room.view() };
}

export function joinRoom(roomIdValue: string, displayName: string): OnlineJoinResponse {
	const managed = rooms.get(roomIdValue);
	if (!managed) throw new Error('Match not found.');
	const token = randomUUID();
	const joined = managed.room.join(displayName, token);
	managed.lastActivityAt = Date.now();
	broadcastRoom(managed);
	return {
		roomId: managed.room.roomId,
		playerId: joined.playerId,
		token,
		room: managed.room.view()
	};
}

export function startRoom(roomIdValue: string, token: string): OnlineRoomView {
	const managed = rooms.get(roomIdValue);
	if (!managed) throw new Error('Match not found.');
	const result = managed.room.start(token);
	if (!result.ok) throw new Error(result.message);
	managed.lastActivityAt = Date.now();
	ensureTickLoop();
	broadcastRoom(managed);
	for (const subscriber of managed.subscribers) {
		subscriber.send({
			type: 'welcome',
			baseline: managed.room.baselineFor(subscriber.token)
		});
	}
	return managed.room.view();
}

export function validateSession(roomIdValue: string, token: string): boolean {
	const managed = rooms.get(roomIdValue);
	return managed?.room.hasToken(token) === true;
}

export function roomView(roomIdValue: string): OnlineRoomView {
	const managed = rooms.get(roomIdValue);
	if (!managed) throw new Error('Match not found.');
	return managed.room.view();
}

export function submitIntent(
	roomIdValue: string,
	token: string,
	envelope: OnlineIntentEnvelope
): OnlineIntentResult {
	const managed = rooms.get(roomIdValue);
	if (!managed) throw new Error('Match not found.');
	managed.lastActivityAt = Date.now();
	return managed.room.submit(token, envelope);
}

export function subscribeRoom(
	roomIdValue: string,
	token: string,
	send: (event: OnlineServerEvent) => void
): () => void {
	const managed = rooms.get(roomIdValue);
	if (!managed) throw new Error('Match not found.');
	if (!managed.room.hasToken(token)) throw new Error('Unknown player session.');
	managed.lastActivityAt = Date.now();
	const subscriber: Subscriber = { token, send };
	managed.subscribers.add(subscriber);
	send({ type: 'room', room: managed.room.view() });
	if (managed.room.currentPhase !== 'waiting') {
		send({ type: 'welcome', baseline: managed.room.baselineFor(token) });
	}
	return () => {
		managed.subscribers.delete(subscriber);
		managed.lastActivityAt = Date.now();
	};
}

export function listRooms(): OnlineRoomListEntry[] {
	return [...rooms.values()]
		.filter((managed) => managed.room.currentPhase === 'waiting')
		.map((managed) => {
			const view = managed.room.view();
			return {
				roomId: view.roomId,
				phase: view.phase,
				humanCount: view.seats.length,
				maxHumans: view.config.maxHumans,
				totalStates: view.config.totalStates
			};
		})
		.sort((left, right) => left.roomId.localeCompare(right.roomId));
}
