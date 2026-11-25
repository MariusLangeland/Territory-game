import { DbConnection, tables, type SubscriptionHandle } from './lobby_bindings';
import type { RoomDirectory } from './lobby_bindings/types';
import { LOBBY_DATABASE, SPACETIMEDB_URI } from './config';
import type { LocalRoomDefinition } from '#lib/game/multiplayer/rooms';

export type DirectoryConnectionState = 'connecting' | 'ready' | 'error';

export interface RoomDirectoryHandlers {
	onRooms: (rooms: readonly RoomDirectory[]) => void;
	onState: (state: DirectoryConnectionState, error?: string) => void;
}

export interface RoomDirectoryConnection {
	disconnect: () => void;
}

const TOKEN_KEY = `spacetime:${SPACETIMEDB_URI}/${LOBBY_DATABASE}/auth_token`;

function readToken(): string | null {
	try {
		return localStorage.getItem(TOKEN_KEY);
	} catch {
		return null;
	}
}

function saveToken(token: string): void {
	try {
		localStorage.setItem(TOKEN_KEY, token);
	} catch {
		// Storage can be unavailable in private contexts; the session still works.
	}
}

export function roomDefinitionFromDirectory(row: RoomDirectory): LocalRoomDefinition {
	const status = row.status === 'running' || row.status === 'closed' ? row.status : 'open';
	return {
		id: row.databaseName,
		databaseName: row.databaseName,
		name: row.name,
		classification: row.classification,
		description: row.description,
		rules: [...row.rules],
		seed: row.seed,
		humans: 1,
		accent: row.accent,
		status,
		settings: {
			states: row.playerCount,
			mapPreset: 'standard',
			mapWidth: row.width,
			mapHeight: row.height,
			difficulty: row.botDifficulty as LocalRoomDefinition['settings']['difficulty'],
			timerMinutes: row.timerMinutes,
			botCommandPostStacks: row.botCommandPostStacks
		}
	};
}

function sortRooms(rooms: Iterable<RoomDirectory>): RoomDirectory[] {
	const priority = (status: string): number =>
		status === 'open' ? 0 : status === 'running' ? 1 : 2;
	return [...rooms]
		.filter((room) => room.status !== 'closed')
		.sort(
			(left, right) =>
				priority(left.status) - priority(right.status) || left.name.localeCompare(right.name)
		);
}

export function connectRoomDirectory(handlers: RoomDirectoryHandlers): RoomDirectoryConnection {
	const rooms = new Map<string, RoomDirectory>();
	let connection: DbConnection | null = null;
	let subscription: SubscriptionHandle | null = null;
	let disconnected = false;

	const publish = (): void => {
		if (!disconnected) handlers.onRooms(sortRooms(rooms.values()));
	};

	handlers.onState('connecting');
	const builder = DbConnection.builder()
		.withUri(SPACETIMEDB_URI)
		.withDatabaseName(LOBBY_DATABASE)
		.withAutomaticReconnect();

	const token = readToken();
	if (token) builder.withToken(token);

	const next = builder
		.onConnect((_ctx, _identity, newToken) => {
			saveToken(newToken);
		})
		.onAutomaticReconnect((_ctx, _identity, newToken) => {
			saveToken(newToken);
		})
		.onConnectError((_ctx, error, nextAttempt) => {
			if (nextAttempt === undefined) {
				handlers.onState('error', error.message);
			}
		})
		.onDisconnect((_ctx, error, nextAttempt) => {
			if (nextAttempt === undefined) {
				handlers.onState('error', error?.message ?? 'room directory disconnected');
			}
		})
		.build();

	connection = next;
	subscription = next
		.subscriptionBuilder()
		.onApplied(() => handlers.onState('ready'))
		.subscribe([tables.roomDirectory]);

	next.db.roomDirectory.onInsert((_ctx, room) => {
		rooms.set(room.databaseName, room);
		publish();
	});
	next.db.roomDirectory.onUpdate((_ctx, _oldRoom, room) => {
		rooms.set(room.databaseName, room);
		publish();
	});
	next.db.roomDirectory.onDelete((_ctx, room) => {
		rooms.delete(room.databaseName);
		publish();
	});

	return {
		disconnect: () => {
			disconnected = true;
			subscription?.unsubscribe();
			connection?.disconnect();
			connection = null;
			subscription = null;
			rooms.clear();
		}
	};
}
