import type { OnlineApi } from './online-api';
import type { OnlinePageState } from './online-page-state.svelte';
import { loadOnlineSession, publishRoomUrl, saveOnlineSession } from './online-session';
import type { OnlineTransport } from './online-transport.svelte';

export interface OnlineLobbyDeps {
	api: OnlineApi;
	transport: OnlineTransport;
}

/**
 * Pre-match flow: open-room listing, room creation/join, host start, and the
 * reload reconnect path that adopts a stored session before resubscribing.
 */
export function createOnlineLobbyController(state: OnlinePageState, deps: OnlineLobbyDeps) {
	async function refreshRooms(): Promise<void> {
		try {
			state.roomList = await deps.api.listRooms();
		} catch {
			state.roomList = [];
		}
	}

	function adoptSession(roomId: string, playerId: number, token: string): void {
		state.playerId = playerId;
		state.token = token;
		state.intentSequence = 0;
		saveOnlineSession(roomId, { playerId, token, sequence: state.intentSequence });
		state.shareUrl = publishRoomUrl(roomId);
		deps.transport.subscribe();
	}

	async function createRoom(): Promise<void> {
		state.busy = true;
		try {
			const body = await deps.api.createRoom(state.displayName, {
				totalStates: state.config.totalStates,
				maxHumans: state.config.maxHumans,
				botDifficulty: state.config.botDifficulty,
				timerMinutes: state.config.timerMinutes,
				botCommandPostStacks: state.config.botCommandPostStacks
			});
			state.room = body.room;
			adoptSession(body.roomId, body.playerId, body.token);
		} catch (error) {
			state.status = error instanceof Error ? error.message : 'Could not create the room.';
		} finally {
			state.busy = false;
		}
	}

	async function joinRoomWithCode(code: string = state.roomCodeInput): Promise<void> {
		const value = code.trim();
		if (!value) return;
		state.busy = true;
		try {
			const body = await deps.api.joinRoom(value, state.displayName);
			state.room = body.room;
			adoptSession(body.roomId, body.playerId, body.token);
		} catch (error) {
			state.status = error instanceof Error ? error.message : 'Could not join the room.';
		} finally {
			state.busy = false;
		}
	}

	async function startMatch(): Promise<void> {
		const room = state.room;
		if (!room || !state.isHost) return;
		state.busy = true;
		try {
			state.room = await deps.api.startRoom(room.roomId);
		} catch (error) {
			state.status = error instanceof Error ? error.message : 'Could not start the match.';
		} finally {
			state.busy = false;
		}
	}

	/**
	 * Reopens a room from the `?room=` parameter after a reload. Without a
	 * stored session the code is only prefilled; the player must join again.
	 */
	function restoreRoom(roomId: string): void {
		state.roomCodeInput = roomId;
		const stored = loadOnlineSession(roomId);
		if (!stored) return;
		state.token = stored.token;
		state.playerId = stored.playerId;
		state.intentSequence = stored.sequence;
		void deps.api
			.getRoom(roomId)
			.then((room) => {
				state.room = room;
				state.shareUrl = publishRoomUrl(roomId);
				deps.transport.subscribe();
			})
			.catch((error: unknown) => {
				state.status = error instanceof Error ? error.message : 'Match not found.';
			});
	}

	return {
		refreshRooms,
		createRoom,
		joinRoomWithCode,
		startMatch,
		restoreRoom
	};
}

export type OnlineLobbyController = ReturnType<typeof createOnlineLobbyController>;
