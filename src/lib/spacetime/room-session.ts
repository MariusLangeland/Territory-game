import { DbConnection, tables, type SubscriptionHandle } from './module_bindings';
import type { Identity } from 'spacetimedb';
import type { OnlineIntent } from '#lib/game/net/online-protocol';
import { decodeOnlineIntent, encodeOnlineIntent } from './intent-codec';
import type { RoomDefinition } from './room-definition';
import { SPACETIMEDB_URI } from './config';

export interface AcceptedTransaction {
	rowIndex: bigint;
	tick: bigint;
	playerId: number;
	intent: OnlineIntent;
}

export interface RoomSession {
	readonly databaseName: string;
	readonly playerId: number;
	disconnect: () => void;
	submitIntent: (intent: OnlineIntent) => Promise<{ ok: boolean; message: string }>;
}

export interface RoomSessionOptions {
	room: RoomDefinition;
	playerName?: string;
	timeoutMs?: number;
	onTransaction?: (transaction: AcceptedTransaction) => void;
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

function roomCodeFor(room: RoomDefinition): string {
	return room.databaseName;
}

/**
 * Joins the selected room database and makes this client the host when the
 * database has no room row yet. The deterministic match still runs locally;
 * this connection owns the room's seat/presence and match lifecycle.
 */
export function connectRoomSession({
	room,
	playerName = HOST_NAME,
	timeoutMs = 12_000,
	onTransaction
}: RoomSessionOptions): Promise<RoomSession> {
	const databaseName = room.databaseName;
	return new Promise((resolve, reject) => {
		let settled = false;
		let identity: Identity | null = null;
		let connection: DbConnection | null = null;
		let playerId = 1;
		let clientSequence = 0n;
		let lastRowIndex = 0n;
		let resolveFirstTick!: () => void;
		const firstTick = new Promise<void>((resolve) => {
			resolveFirstTick = resolve;
		});
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
				playerId,
				disconnect: () => {
					subscription?.unsubscribe();
					connection?.disconnect();
					connection = null;
				},
				submitIntent: async (intent) => {
					const active = connection;
					if (!active) return { ok: false, message: 'Room connection is not ready.' };
					try {
						await active.reducers.submitTransaction({
							clientSequence: ++clientSequence,
							type: 'intent',
							data: encodeOnlineIntent(intent)
						});
						return { ok: true, message: 'Transaction submitted.' };
					} catch (error) {
						return {
							ok: false,
							message: error instanceof Error ? error.message : 'Transaction rejected.'
						};
					}
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

		next.db.firstTickEvent.onInsert((_ctx, event) => {
			if (event.tick === 0n) resolveFirstTick();
		});
		next.db.ledgerTransactions.onInsert((_ctx, row) => {
			if (row.type !== 'intent' || row.rowIndex <= lastRowIndex) return;
			lastRowIndex = row.rowIndex;
			const intent = decodeOnlineIntent(row.data);
			if (!intent) return;
			onTransaction?.({
				rowIndex: row.rowIndex,
				tick: row.tick,
				playerId: row.playerId,
				intent
			});
		});

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
			if (seat) playerId = seat.playerId;
		}

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
					refreshPlayerId();
					await next.reducers.startMatch({});
					await firstTick;
					succeed();
					return;
				}

				if (existing.participationLocked || existing.status !== 'waiting') {
					throw new Error('Room participation is locked; late joining is disabled.');
				}

				if (existing.status === 'waiting') {
					const seated = [...next.db.seats.iter()].find(
						(seat) => identity !== null && seat.identity.isEqual(identity)
					);
					if (!seated) await next.reducers.joinRoom({ name: playerName });
					await next.reducers.setReady({ ready: true });
					refreshPlayerId();
					if (identity !== null && existing.host.isEqual(identity)) {
						await next.reducers.startMatch({});
						await firstTick;
					}
					succeed();
					return;
				}
			} catch (error) {
				fail(error);
			}
		}
	});
}
