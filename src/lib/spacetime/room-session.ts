import { DbConnection, tables, type SubscriptionHandle } from './module_bindings';
import type { Identity } from 'spacetimedb';
import type { OnlineIntent } from '#lib/game/net/online-protocol';
import { SpacetimeLedgerSource } from '#lib/game/ledger/remote';
import type { AcceptedTransaction, LedgerSource, LedgerSubmitResult } from '#lib/game/ledger/types';
import type { RoomDefinition } from './room-definition';
import { SPACETIMEDB_URI } from './config';

export interface LobbySeat {
	playerId: number;
	name: string;
	isHost: boolean;
	connected: boolean;
	ready: boolean;
}

export interface LobbySnapshot {
	status: string;
	participationLocked: boolean;
	seats: LobbySeat[];
}

export type { AcceptedTransaction } from '#lib/game/ledger/types';

export interface RoomLobbySession {
	readonly databaseName: string;
	readonly playerId: number;
	readonly isHost: boolean;
	readonly ledger: LedgerSource;
	disconnect: () => void;
	setReady: (ready: boolean) => Promise<void>;
	startMatch: () => Promise<void>;
	finishMatch: () => Promise<void>;
	leaveRoom: () => Promise<void>;
	submitIntent: (intent: OnlineIntent) => Promise<LedgerSubmitResult>;
}

export interface RoomLobbyOptions {
	room: RoomDefinition;
	playerName?: string;
	timeoutMs?: number;
	onLobby?: (snapshot: LobbySnapshot) => void;
	onFirstTick?: () => void;
	onTransaction?: (transaction: AcceptedTransaction) => void;
	onAvailability?: (available: boolean, message?: string) => void;
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

/**
 * Connects to a room database, creates the room when empty, or joins it while it
 * is still waiting. This does not start the match; the host starts it from the
 * lobby after seats are ready.
 */
export function connectRoomLobby({
	room,
	playerName = HOST_NAME,
	timeoutMs = 12_000,
	onLobby,
	onFirstTick,
	onTransaction,
	onAvailability
}: RoomLobbyOptions): Promise<RoomLobbySession> {
	const databaseName = room.databaseName;
	return new Promise((resolve, reject) => {
		let settled = false;
		let joined = false;
		let closed = false;
		let identity: Identity | null = null;
		let connection: DbConnection | null = null;
		let subscription: SubscriptionHandle | null = null;
		let playerId = 1;
		let isHost = false;
		let ledger: SpacetimeLedgerSource | null = null;
		let availabilityTimer: ReturnType<typeof setInterval> | null = null;

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

		function emitLobby(): void {
			if (!connection || closed) return;
			const roomRow = [...connection.db.rooms.iter()][0];
			if (!roomRow) return;
			isHost = identity !== null && roomRow.host.isEqual(identity);
			onLobby?.({
				status: roomRow.status,
				participationLocked: roomRow.participationLocked,
				seats: [...connection.db.seats.iter()]
					.map((seat) => ({
						playerId: seat.playerId,
						name: seat.name,
						isHost: seat.isHost,
						connected: seat.connected,
						ready: seat.ready
					}))
					.sort((left, right) => left.playerId - right.playerId)
			});
		}

		const session: RoomLobbySession = {
			databaseName,
			get playerId() {
				return playerId;
			},
			get isHost() {
				return isHost;
			},
			get ledger(): LedgerSource {
				if (!ledger) throw new Error('Room ledger is not ready.');
				return ledger;
			},
			disconnect: () => {
				closed = true;
				if (availabilityTimer) clearInterval(availabilityTimer);
				availabilityTimer = null;
				ledger?.dispose();
				ledger = null;
				subscription?.unsubscribe();
				connection?.disconnect();
				connection = null;
			},
			setReady: async (ready) => {
				const active = connection;
				if (!active) throw new Error('Room connection is not ready.');
				await active.reducers.setReady({ ready });
				emitLobby();
			},
			startMatch: async () => {
				const active = connection;
				if (!active) throw new Error('Room connection is not ready.');
				await active.reducers.startMatch({});
			},
			finishMatch: async () => {
				const active = connection;
				if (!active) throw new Error('Room connection is not ready.');
				await active.reducers.finishMatch({});
			},
			leaveRoom: async () => {
				const active = connection;
				if (!active) throw new Error('Room connection is not ready.');
				await active.reducers.leaveRoom({});
			},
			submitIntent: async (intent) => {
				if (!ledger) return { ok: false, message: 'Room ledger is not ready.' };
				const result = await ledger.submitIntent(intent);
				if (!result.ok) onAvailability?.(false, result.message);
				return result;
			}
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
				if (!closed) {
					ledger?.setAvailable(true);
					onAvailability?.(true);
				}
			})
			.onConnectError((_ctx, error, nextAttempt) => {
				if (nextAttempt === undefined) {
					if (settled) {
						if (!closed) onAvailability?.(false, error.message);
					} else {
						fail(error);
					}
				}
			})
			.onDisconnect((_ctx, error, nextAttempt) => {
				if (!settled) {
					if (nextAttempt === undefined) fail(error ?? new Error('Room disconnected.'));
					return;
				}
				if (!closed) {
					const message = error?.message ?? 'Room connection lost.';
					ledger?.setAvailable(false, message);
					onAvailability?.(false, message);
				}
			})
			.build();
		connection = next;

		ledger = new SpacetimeLedgerSource(next, playerId);
		if (onTransaction) ledger.subscribe(onTransaction);
		next.db.firstTickEvent.onInsert((_ctx, event) => {
			if (event.tick === 0n) onFirstTick?.();
		});
		next.db.seats.onInsert(() => emitLobby());
		next.db.seats.onUpdate(() => emitLobby());
		next.db.seats.onDelete(() => emitLobby());
		next.db.rooms.onUpdate(() => emitLobby());

		subscription = next
			.subscriptionBuilder()
			.onApplied(() => {
				void prepareRoom();
			})
			.subscribe([tables.rooms, tables.seats, tables.firstTickEvent, tables.ledgerTransactions]);

		function refreshPlayerId(): void {
			const seat = [...next.db.seats.iter()].find(
				(candidate) => identity !== null && candidate.identity.isEqual(identity)
			);
			if (seat) {
				playerId = seat.playerId;
				if (ledger) ledger.playerId = playerId;
			}
		}

		async function prepareRoom(): Promise<void> {
			if (joined) return;
			try {
				const existing = [...next.db.rooms.iter()][0];
				if (!existing) {
					await next.reducers.createRoom({
						roomCode: room.databaseName,
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
				} else {
					if (existing.participationLocked || existing.status !== 'waiting') {
						throw new Error('Room participation is locked; late joining is disabled.');
					}
					const seated = [...next.db.seats.iter()].find(
						(candidate) => identity !== null && candidate.identity.isEqual(identity)
					);
					if (!seated) await next.reducers.joinRoom({ name: playerName });
				}
				refreshPlayerId();
				joined = true;
				settled = true;
				clearTimeout(timeout);
				availabilityTimer = setInterval(() => {
					if (closed) return;
					const available = connection?.isActive === true;
					onAvailability?.(available, available ? undefined : 'Room connection lost.');
				}, 1000);
				emitLobby();
				resolve(session);
			} catch (error) {
				fail(error);
			}
		}
	});
}
