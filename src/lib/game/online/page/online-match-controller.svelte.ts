import type { OnlineIntent } from '#lib/game/net/online-protocol';
import type { OnlineApi } from './online-api';
import type { OnlinePageState } from './online-page-state.svelte';
import { saveOnlineSession } from './online-session';
import type { OnlineTransport } from './online-transport.svelte';

export interface OnlineMatchDeps {
	api: OnlineApi;
	transport: OnlineTransport;
}

/**
 * In-match client actions: intent submission with sequence persistence, card
 * placement/artillery targeting, the keyboard shortcut, and leaving the room.
 */
export function createOnlineMatchController(state: OnlinePageState, deps: OnlineMatchDeps) {
	function persistSequence(): void {
		const room = state.room;
		if (!room) return;
		saveOnlineSession(room.roomId, {
			playerId: state.playerId,
			token: state.token,
			sequence: state.intentSequence
		});
	}

	async function sendIntent(intent: OnlineIntent): Promise<void> {
		const room = state.room;
		if (!room) return;
		state.intentSequence++;
		persistSequence();
		try {
			const result = await deps.api.sendIntent(room.roomId, state.intentSequence, intent);
			if (!result.ok) state.status = result.message;
		} catch (error) {
			state.status = error instanceof Error ? error.message : 'Command failed.';
		}
	}

	function cancelFront(): void {
		void sendIntent({ type: 'cancel-attack' });
	}

	function selectCard(cardId: number): void {
		state.selectedCardId = cardId;
		state.artilleryMode = false;
	}

	function clearSelection(): void {
		state.selectedCardId = null;
		state.artilleryMode = false;
	}

	function toggleArtillery(): void {
		state.artilleryMode = !state.artilleryMode;
		state.selectedCardId = null;
	}

	function handleCanvasClick(x: number, y: number): void {
		if (!state.running) return;
		if (state.selectedCardId !== null) {
			void sendIntent({ type: 'build', cardId: state.selectedCardId, x, y });
			state.selectedCardId = null;
			return;
		}
		if (state.artilleryMode) {
			void sendIntent({ type: 'artillery', x, y });
			state.artilleryMode = false;
			return;
		}
		const view = state.remoteView;
		const owner =
			view && x >= 0 && y >= 0 && x < view.width && y < view.height
				? view.getOwner(Math.floor(x), Math.floor(y))
				: 0;
		if (owner === state.playerId) {
			void sendIntent({ type: 'upgrade', x, y, levels: 1, merged: true });
			return;
		}
		void sendIntent({ type: 'attack', x, y });
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (!state.running) return;
		if (event.key === 'Escape') {
			clearSelection();
			return;
		}
		if (event.key >= '1' && event.key <= '7') {
			const card = state.playableCards[Number(event.key) - 1];
			if (card) selectCard(card.id);
		}
	}

	function leaveOnline(): void {
		deps.transport.close();
		state.room = null;
		state.remoteView = null;
		state.snapshot = null;
		state.visuals = [];
		state.playerId = 0;
		state.token = '';
		state.selectedCardId = null;
		state.artilleryMode = false;
		state.status = 'Left the room.';
	}

	return {
		sendIntent,
		cancelFront,
		selectCard,
		clearSelection,
		toggleArtillery,
		handleCanvasClick,
		handleKeydown,
		leaveOnline
	};
}

export type OnlineMatchController = ReturnType<typeof createOnlineMatchController>;
