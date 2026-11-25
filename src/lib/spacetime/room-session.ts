import { DbConnection, tables, type SubscriptionHandle } from './module_bindings';
import type { Identity } from 'spacetimedb';
import type { LocalRoomDefinition } from '#lib/game/multiplayer/rooms';
import { SPACETIMEDB_URI } from './config';

export interface RoomSession {
	readonly databaseName: string;
	disconnect: () => void;
}

export interface RoomSessionOptions {
	room: LocalRoomDefinition;
	playerName?: string;
	timeoutMs?: number;
}

const HOST_NAME = 'SABLE';
const ROOM_VERSION = 'territory-room/1';

function tokenKey(databaseName: string): string {
	return `spacetime:${SPACETIMEDB_URI}/${databaseName}/auth_token`;
}

function readToken(databaseName: string): string | null {
	try {
		return localStorage.getItem(tokenKey(databaseName));
	} catch {
		return null;
	}
}

function saveToken(databaseName: string, token: string): void {
	try {
		localStorage.setItem(tokenKey(databaseName), token);
	} catch {
		// Storage can be unavailable in private contexts; the session still works.
	}
}

function roomCodeFor(room: LocalRoomDefinition): string {
	return room.databaseName ?? room.id;
}

/**
 * Joins the selected room database and makes this client the host when the
 * database has no room row yet. The deterministic match still runs locally;
 * this connection owns the room's seat/presence and match lifecycle.
 */
export function connectRoomSession({
	room,
	playerName = HOST_NAME,
	timeoutMs = 12_000
}: RoomSessionOptions): Promise<RoomSession> {
	if (!room.databaseName) {
		return Promise.reject(new Error('Selected room has no Spacetime database.'));
	}

	const databaseName = room.databaseName;
	return new Promise((resolve, reject) => {
		let settled = false;
		let identity: Identity | null = null;
		let connection: DbConnection | null = null;
		const timeout = setTimeout(() => {
			if (settled) return;
			settled = true;
			connection?.disconnect();
			reject(new Error(`Timed out connecting to ${databaseName}.`));
		}, timeoutMs);

		const fail = (error: unknown): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			connection?.disconnect();
			reject(error instanceof Error ? error : new Error(String(error)));
		};

		const succeed = (): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			resolve({
				databaseName,
				disconnect: () => {
					subscription?.unsubscribe();
					connection?.disconnect();
					connection = null;
				}
			});
		};

		const builder = DbConnection.builder()
			.withUri(SPACETIMEDB_URI)
			.withDatabaseName(databaseName)
			.withAutomaticReconnect();

		const token = readToken(databaseName);
		if (token) builder.withToken(token);

		const next = builder
			.onConnect((_ctx, nextIdentity, newToken) => {
				identity = nextIdentity;
				saveToken(databaseName, newToken);
			})
			.onAutomaticReconnect((_ctx, _identity, newToken) => {
				saveToken(databaseName, newToken);
			})
			.onConnectError((_ctx, error, nextAttempt) => {
				if (nextAttempt === undefined) fail(error);
			})
			.onDisconnect((_ctx, error, nextAttempt) => {
				if (nextAttempt === undefined && !settled) fail(error ?? new Error('Room disconnected.'));
			})
			.build();
		connection = next;

		let subscription: SubscriptionHandle | null = null;

		subscription = next
			.subscriptionBuilder()
			.onApplied(() => {
				void prepareRoom();
			})
			.subscribe([tables.rooms, tables.seats]);

		async function prepareRoom(): Promise<void> {
			if (settled) return;
			try {
				const existing = [...next.db.rooms.iter()][0];
				if (!existing) {
					await next.reducers.createRoom({
						roomCode: roomCodeFor(room),
						hostName: playerName,
						seed: room.seed,
						width: room.settings.mapWidth,
						height: room.settings.mapHeight,
						playerCount: room.settings.states,
						botDifficulty: room.settings.difficulty,
						timerMinutes: room.settings.timerMinutes,
						botCommandPostStacks: room.settings.botCommandPostStacks,
						version: ROOM_VERSION
					});
					await next.reducers.setReady({ ready: true });
					await next.reducers.startMatch({});
					succeed();
					return;
				}

				if (existing.status === 'waiting') {
					const seated = [...next.db.seats.iter()].find(
						(seat) => identity !== null && seat.identity.isEqual(identity)
					);
					if (!seated) await next.reducers.joinRoom({ name: playerName });
					await next.reducers.setReady({ ready: true });
					if (identity !== null && existing.host.isEqual(identity)) {
						await next.reducers.startMatch({});
					}
					succeed();
					return;
				}

				// A running room is still a valid live connection for this prototype.
				succeed();
			} catch (error) {
				fail(error);
			}
		}
	});
}
