import { HUMAN_PLAYER_ID } from '#lib/game/constants';
import type { CameraView } from '#lib/game/render/camera-bridge';
import type { GameSnapshot } from '#lib/game/simulation';
import { STRUCTURE_ACCENTS } from '#lib/game/structures';
import type { StructureContextMenu } from '#lib/game/ui/structure-menu';
import type { WorkerLocalSimulation } from '#lib/game/worker/local-simulation';
import type { HoverState } from './types';

/** State cells the interaction selectors read. Values must stay as getters while passed in. */
export interface InteractionSelectorsDeps {
	readonly sim: WorkerLocalSimulation | null;
	readonly snapshot: GameSnapshot | null;
	readonly cameraView: CameraView | null;
	readonly hover: HoverState | null;
	readonly keyboardCursor: { x: number; y: number } | null;
	readonly draggingCardId: number | null;
	readonly dragOrigin: { x: number; y: number } | null;
	readonly dragPointer: { x: number; y: number } | null;
	readonly dragLanding: { x: number; y: number; radius: number; ok: boolean } | null;
	readonly artilleryTargeting: boolean;
	readonly keyboardPlacement: boolean;
	readonly paused: boolean;
	readonly gameStarted: boolean;
	readonly showIntro: boolean;
	readonly defeatOpen: boolean;
	readonly showHelp: boolean;
	readonly structureMenu: StructureContextMenu | null;
}

/**
 * Keyboard cursor and card-drag selectors. They only read page state; every
 * input mutation stays in the controllers, which receive the same accessors
 * from `createGamePageState`.
 */
export function createInteractionSelectors(deps: InteractionSelectorsDeps) {
	function isHumanAlly(snapshot: GameSnapshot, humanId: number, ownerId: number): boolean {
		return snapshot.alliances.some(
			(alliance) =>
				(alliance.playerA === humanId && alliance.playerB === ownerId) ||
				(alliance.playerB === humanId && alliance.playerA === ownerId)
		);
	}
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
	/**
	 * Naval snap preview. It mirrors the worker's target resolution (nearest
	 * non-friendly, non-allied, unoccupied shore within 32 px) from the mirror
	 * snapshot, but only when a click there could route to the naval fallback:
	 * the human owns a Port and the hovered cell is not friendly. Sea-route,
	 * supply and alive checks stay worker-authoritative at click time.
	 */
	let navalTarget = $derived.by(() => {
		const sim = deps.sim;
		const snapshot = deps.snapshot;
		const hover = deps.hover;
		if (!sim || !snapshot || !hover) return null;
		if (
			!deps.gameStarted ||
			deps.showIntro ||
			deps.defeatOpen ||
			deps.showHelp ||
			deps.paused ||
			deps.keyboardPlacement ||
			deps.draggingCardId !== null ||
			deps.artilleryTargeting ||
			deps.structureMenu !== null ||
			snapshot.ended
		) {
			return null;
		}
		const humanId = snapshot.humanId;
		if (humanId <= 0) return null;
		if (hover.owner === humanId) return null;
		if (hover.owner > 0 && isHumanAlly(snapshot, humanId, hover.owner)) return null;
		const hasPort = snapshot.structures.some(
			(structure) => structure.ownerId === humanId && structure.type === 'port'
		);
		if (!hasPort) return null;
		// Mirror the click routing: a land attack that can be launched takes
		// priority, and only an ocean/no-border failure falls back to naval.
		const attack = sim.validateAttack(humanId, hover.x, hover.y);
		if (attack.ok || (attack.reason !== 'no-shared-border' && attack.reason !== 'ocean')) {
			return null;
		}
		return sim.resolveNavalTarget(humanId, hover.x, hover.y);
	});
	let navalPreviewScreen = $derived.by(() => {
		const target = navalTarget;
		const cameraView = deps.cameraView;
		if (!target || !cameraView) return null;
		return {
			x: cameraView.viewportWidth / 2 + (target.x + 0.5 - cameraView.centerX) * cameraView.scale,
			y: cameraView.viewportHeight / 2 + (target.y + 0.5 - cameraView.centerY) * cameraView.scale
		};
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
		// End the arrow on the landing circle when one is known: normal placement
		// and the shift snap both point the card at the cell it will build.
		const endX = deps.dragLanding?.x ?? pointer.x;
		const endY = deps.dragLanding?.y ?? pointer.y;
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
		},
		get navalTarget() {
			return navalTarget;
		},
		set navalTarget(value) {
			navalTarget = value;
		},
		get navalPreviewScreen() {
			return navalPreviewScreen;
		},
		set navalPreviewScreen(value) {
			navalPreviewScreen = value;
		}
	};
}
