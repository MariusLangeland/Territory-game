import type {
	OnlineIntent,
	OnlineIntentResult,
	OnlineJoinResponse,
	OnlineRoomListEntry,
	OnlineRoomView
} from '#lib/game/net/online-protocol';
import type { BotDifficulty } from '#lib/game/simulation';

/** Lobby settings sent when creating a room; the server fills the seed. */
export interface OnlineCreateRoomConfig {
	totalStates: number;
	maxHumans: number;
	botDifficulty: BotDifficulty;
	timerMinutes: number;
	botCommandPostStacks: number;
}

export interface OnlineApi {
	listRooms(): Promise<OnlineRoomListEntry[]>;
	createRoom(displayName: string, config: OnlineCreateRoomConfig): Promise<OnlineJoinResponse>;
	joinRoom(roomId: string, displayName: string): Promise<OnlineJoinResponse>;
	getRoom(roomId: string): Promise<OnlineRoomView>;
	startRoom(roomId: string): Promise<OnlineRoomView>;
	sendIntent(roomId: string, sequence: number, intent: OnlineIntent): Promise<OnlineIntentResult>;
}

function roomPath(roomId: string, suffix = ''): string {
	return `/api/online/rooms/${encodeURIComponent(roomId)}${suffix}`;
}

/**
 * Thin typed wrapper over the room HTTP surface. The token is read lazily so a
 * create/join response can update the session before later commands fire.
 */
export function createOnlineApi(getToken: () => string): OnlineApi {
	async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
		const token = getToken();
		const response = await fetch(path, {
			...options,
			headers: {
				'content-type': 'application/json',
				...(token ? { 'x-online-token': token } : {}),
				...options.headers
			}
		});
		const body: unknown = await response.json();
		if (!response.ok) {
			const message =
				typeof body === 'object' &&
				body !== null &&
				'error' in body &&
				typeof body.error === 'string'
					? body.error
					: 'Request failed.';
			throw new Error(message);
		}
		return body as T;
	}

	return {
		async listRooms() {
			const body = await request<{ rooms: OnlineRoomListEntry[] }>('/api/online/rooms');
			return body.rooms;
		},
		createRoom(displayName, config) {
			return request<OnlineJoinResponse>('/api/online/rooms', {
				method: 'POST',
				body: JSON.stringify({ displayName, config })
			});
		},
		joinRoom(roomId, displayName) {
			return request<OnlineJoinResponse>(roomPath(roomId, '/join'), {
				method: 'POST',
				body: JSON.stringify({ displayName })
			});
		},
		async getRoom(roomId) {
			const body = await request<{ room: OnlineRoomView }>(roomPath(roomId));
			return body.room;
		},
		async startRoom(roomId) {
			const body = await request<{ room: OnlineRoomView }>(roomPath(roomId, '/start'), {
				method: 'POST'
			});
			return body.room;
		},
		sendIntent(roomId, sequence, intent) {
			return request<OnlineIntentResult>(roomPath(roomId, '/intent'), {
				method: 'POST',
				body: JSON.stringify({ sequence, intent })
			});
		}
	};
}
