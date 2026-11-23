import { HUMAN_PLAYER_ID } from '#lib/game/constants';
import type { CameraView } from '#lib/game/render/camera-bridge';
import type { GameSnapshot } from '#lib/game/simulation';
import { STRUCTURE_ACCENTS } from '#lib/game/structures';
import type { WorkerLocalSimulation } from '#lib/game/worker/local-simulation';

/** State cells the interaction selectors read. Values must stay as getters while passed in. */
export interface InteractionSelectorsDeps {
	readonly sim: WorkerLocalSimulation | null;
	readonly snapshot: GameSnapshot | null;
	readonly cameraView: CameraView | null;
	readonly keyboardCursor: { x: number; y: number } | null;
	readonly draggingCardId: number | null;
	readonly dragOrigin: { x: number; y: number } | null;
	readonly dragPointer: { x: number; y: number } | null;
	readonly artilleryTargeting: boolean;
}

/**
 * Keyboard cursor and card-drag selectors. They only read page state; every
 * input mutation stays in the controllers, which receive the same accessors
 * from `createGamePageState`.
 */
export function createInteractionSelectors(deps: InteractionSelectorsDeps) {
	let keyboardCursorScreen = $derived.by(() => {
		const cursor = deps.keyboardCursor;
		const cameraView = deps.cameraView;
		if (!cursor || !cameraView) return null;
		return {
			x: cameraView.viewportWidth / 2 + (cursor.x + 0.5 - cameraView.centerX) * cameraView.scale,
			y: cameraView.viewportHeight / 2 + (cursor.y + 0.5 - cameraView.centerY) * cameraView.scale
		};
	});
	let keyboardCursorAllied = $derived.by(() => {
		const cursor = deps.keyboardCursor;
		const sim = deps.sim;
		const snapshot = deps.snapshot;
		if (!cursor || !sim || !snapshot) return false;
		const ownerId = sim.getOwner(cursor.x, cursor.y);
		if (ownerId <= 0 || ownerId === snapshot.humanId) return false;
		return snapshot.alliances.some(
			(alliance) =>
				(alliance.playerA === snapshot.humanId && alliance.playerB === ownerId) ||
				(alliance.playerB === snapshot.humanId && alliance.playerA === ownerId)
		);
	});
	let keyboardCursorStatus = $derived.by(() => {
		const cursor = deps.keyboardCursor;
		const sim = deps.sim;
		const snapshot = deps.snapshot;
		if (!cursor || !sim || !snapshot) return '';
		const { x, y } = cursor;
		const ownerId = sim.getOwner(x, y);
		const owner = snapshot.players.find((player) => player.id === ownerId);
		const defense = sim.getDefense(x, y);
		const action = keyboardCursorAllied
			? 'Allied territory; Enter is disabled'
			: deps.artilleryTargeting
				? 'Enter fires artillery'
				: ownerId === HUMAN_PLAYER_ID && sim.getDistrictStructureId(x, y)
					? 'Enter upgrades'
					: 'Enter attacks';
		return `Cursor ${x}, ${y}. ${owner ? owner.name : 'Unclaimed land'}. Defense ${defense}. ${action}.`;
	});
	let draggingCard = $derived(
		deps.draggingCardId === null
			? null
			: (deps.snapshot?.hand.find((card) => card.id === deps.draggingCardId) ?? null)
	);
	let dragAccent = $derived(draggingCard ? STRUCTURE_ACCENTS[draggingCard.type] : '#f7eed0');
	let dragArrow = $derived.by(() => {
		const origin = deps.dragOrigin;
		const pointer = deps.dragPointer;
		if (!origin || !pointer) return null;
		const startX = origin.x;
		const startY = origin.y;
		const endX = pointer.x;
		const endY = pointer.y;
		const dx = endX - startX;
		const dy = endY - startY;
		const length = Math.max(1, Math.hypot(dx, dy));
		const bend = Math.min(95, Math.max(34, length * 0.2));
		const midX = (startX + endX) / 2;
		const midY = (startY + endY) / 2;
		const controlX = midX + (-dy / length) * bend;
		const controlY = midY + (dx / length) * bend;
		const angle = Math.atan2(endY - controlY, endX - controlX);
		const head = 13;
		const left = angle + Math.PI * 0.82;
		const right = angle - Math.PI * 0.82;
		return {
			path: `M ${startX} ${startY} Q ${controlX} ${controlY} ${endX} ${endY}`,
			head: `M ${endX} ${endY} L ${endX + Math.cos(left) * head} ${
				endY + Math.sin(left) * head
			} L ${endX + Math.cos(right) * head} ${endY + Math.sin(right) * head} Z`
		};
	});

	return {
		get keyboardCursorScreen() {
			return keyboardCursorScreen;
		},
		set keyboardCursorScreen(value) {
			keyboardCursorScreen = value;
		},
		get keyboardCursorAllied() {
			return keyboardCursorAllied;
		},
		set keyboardCursorAllied(value) {
			keyboardCursorAllied = value;
		},
		get keyboardCursorStatus() {
			return keyboardCursorStatus;
		},
		set keyboardCursorStatus(value) {
			keyboardCursorStatus = value;
		},
		get draggingCard() {
			return draggingCard;
		},
		set draggingCard(value) {
			draggingCard = value;
		},
		get dragAccent() {
			return dragAccent;
		},
		set dragAccent(value) {
			dragAccent = value;
		},
		get dragArrow() {
			return dragArrow;
		},
		set dragArrow(value) {
			dragArrow = value;
		}
	};
}
