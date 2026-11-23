import { onMount } from 'svelte';
import { createOnlineApi } from './online-api';
import {
	createOnlineLobbyController,
	type OnlineLobbyController
} from './online-lobby-controller.svelte';
import {
	createOnlineMatchController,
	type OnlineMatchController
} from './online-match-controller.svelte';
import { createOnlinePageState, type OnlinePageState } from './online-page-state.svelte';
import { createOnlineTransport } from './online-transport.svelte';
import { readRoomParam } from './online-session';

export type OnlinePageApi = OnlinePageState &
	OnlineLobbyController &
	OnlineMatchController & {
		acknowledgeVisuals(lastRevision: number): void;
	};

/**
 * Composition root for the online lobby/match page. The route only owns markup:
 * reactive state lives in `online-page-state.svelte.ts`, HTTP calls in
 * `online-api.ts`, the SSE/session lifecycle in `online-transport.svelte.ts`
 * and `online-session.ts`, and commands in the lobby/match controllers.
 */
export function createOnlinePage(): OnlinePageApi {
	const state = createOnlinePageState();
	const api = createOnlineApi(() => state.token);
	const transport = createOnlineTransport(state);
	const lobby = createOnlineLobbyController(state, { api, transport });
	const match = createOnlineMatchController(state, { api, transport });

	onMount(() => {
		window.addEventListener('keydown', match.handleKeydown);
		const roomParam = readRoomParam();
		if (roomParam) lobby.restoreRoom(roomParam);
		else void lobby.refreshRooms();
		return () => {
			window.removeEventListener('keydown', match.handleKeydown);
			transport.close();
		};
	});

	// `state` already exposes live accessors; merging the controller methods onto
	// it keeps the historical flat `online.foo` surface without copying values.
	return Object.assign(state, lobby, match, {
		acknowledgeVisuals: transport.acknowledgeVisuals
	});
}
