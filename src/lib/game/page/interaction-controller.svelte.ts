import { tick } from 'svelte';
import { HUMAN_PLAYER_ID, STRUCTURE_MIN_SPACING } from '#lib/game/constants';
import type { CameraView } from '#lib/game/render/camera-bridge';
import type { GameSnapshot } from '#lib/game/simulation';
import type { PublicCard } from '#lib/game/structures';
import { findNearestNewStructureSite } from '#lib/game/ui/build-search';
import {
	buildStructureMenu,
	clampContextMenu,
	contextMenuItemButtons,
	focusContextMenuItem,
	handleContextMenuKey,
	moveContextMenuFocus
} from '#lib/game/ui/structure-menu';
import type { GamePageState, HoverState } from './game-page-state.svelte';
import type { MatchController } from './match-controller.svelte';
import type { OverlayController } from './overlay-controller.svelte';

export interface InteractionDeps {
	get match(): MatchController;
	get overlay(): OverlayController;
}

/**
 * Pointer, drag-and-drop, keyboard-placement, and structure context-menu
 * interactions. Every mutation is expressed through the shared page state
 * setters so Svelte keeps tracking the values from the facade proxy.
 */
export function createInteractionController(state: GamePageState, deps: InteractionDeps) {
	/** Shift-build re-scans up to 160 px, so preview recomputes are throttled. */
	const SHIFT_PREVIEW_THROTTLE_MS = 60;
	let shiftPreviewTimer: ReturnType<typeof setTimeout> | null = null;
	let shiftPreviewLastScan = 0;
	let shiftPreviewPoint: { x: number; y: number } | null = null;
	/** Touch pointers never carry a Shift modifier; hide Shift-only previews for them. */
	let pointerIsTouch = false;

	function clearShiftPreviewTimer(): void {
		if (shiftPreviewTimer === null) return;
		clearTimeout(shiftPreviewTimer);
		shiftPreviewTimer = null;
	}

	function clearDragState(): void {
		clearShiftPreviewTimer();
		shiftPreviewPoint = null;
		state.draggingCardId = null;
		state.keyboardPlacement = false;
		state.dragOrigin = null;
		state.dragPointer = null;
		state.dragLanding = null;
	}

	function pointerCell(clientX: number, clientY: number): { x: number; y: number } | null {
		const cameraView = state.cameraView;
		if (!cameraView) return null;
		const mapX =
			cameraView.centerX +
			(clientX - cameraView.viewportWidth / 2) / Math.max(0.0001, cameraView.scale);
		const mapY =
			cameraView.centerY +
			(clientY - cameraView.viewportHeight / 2) / Math.max(0.0001, cameraView.scale);
		return { x: Math.floor(mapX), y: Math.floor(mapY) };
	}

	function landingAtCell(cameraView: CameraView, cellX: number, cellY: number, ok: boolean) {
		return {
			x: cameraView.viewportWidth / 2 + (cellX + 0.5 - cameraView.centerX) * cameraView.scale,
			y: cameraView.viewportHeight / 2 + (cellY + 0.5 - cameraView.centerY) * cameraView.scale,
			radius: STRUCTURE_MIN_SPACING * cameraView.scale,
			ok
		};
	}

	function dragLandingAt(clientX: number, clientY: number, card: PublicCard) {
		const sim = state.sim;
		const cameraView = state.cameraView;
		if (!sim || !cameraView) return null;
		const cell = pointerCell(clientX, clientY);
		if (!cell) return null;
		const validation = sim.validateBuild(HUMAN_PLAYER_ID, card.id, cell.x, cell.y);
		const targetX = validation.targetX ?? cell.x;
		const targetY = validation.targetY ?? cell.y;
		return landingAtCell(cameraView, targetX, targetY, validation.ok);
	}

	/**
	 * Shift-build preview: the exact same nearest-new-structure search the click
	 * path uses, projected back to screen space. Ports keep their own shoreline
	 * snap. When nothing is legal the exact-cell red ring is shown instead.
	 */
	function shiftLandingAt(clientX: number, clientY: number, card: PublicCard) {
		const sim = state.sim;
		const cameraView = state.cameraView;
		if (!sim || !cameraView) return null;
		const cell = pointerCell(clientX, clientY);
		if (!cell) return null;
		const target = findNearestNewStructureSite(sim, card, cell.x, cell.y);
		if (!target) return dragLandingAt(clientX, clientY, card);
		return landingAtCell(cameraView, target.x, target.y, true);
	}

	function runShiftPreview(): void {
		const point = shiftPreviewPoint;
		const card = state.draggingCard;
		if (!point || !card || !state.keyboardPlacement) return;
		shiftPreviewLastScan = performance.now();
		state.dragLanding = shiftLandingAt(point.x, point.y, card);
	}

	function scheduleShiftPreview(point: { x: number; y: number }): void {
		shiftPreviewPoint = point;
		const remaining = SHIFT_PREVIEW_THROTTLE_MS - (performance.now() - shiftPreviewLastScan);
		if (remaining <= 0) {
			clearShiftPreviewTimer();
			runShiftPreview();
			return;
		}
		if (shiftPreviewTimer !== null) return;
		shiftPreviewTimer = setTimeout(() => {
			shiftPreviewTimer = null;
			runShiftPreview();
		}, remaining);
	}

	/**
	 * Recompute the armed-card landing preview. Unshifted placement stays exact
	 * and unthrottled; Shift-build scans are throttled and trailing (the last
	 * pointer position still resolves after the window closes).
	 */
	function refreshPointerPreviews(force = false): void {
		const card = state.draggingCard;
		if (!state.keyboardPlacement || !card) {
			clearShiftPreviewTimer();
			shiftPreviewPoint = null;
			return;
		}
		const pointer = state.pointerScreen ?? state.dragPointer;
		if (!pointer) return;
		if (!state.shiftHeld || pointerIsTouch) {
			clearShiftPreviewTimer();
			shiftPreviewPoint = null;
			state.dragLanding = dragLandingAt(pointer.x, pointer.y, card);
			return;
		}
		shiftPreviewPoint = pointer;
		if (force) {
			clearShiftPreviewTimer();
			runShiftPreview();
		} else {
			scheduleShiftPreview(pointer);
		}
	}

	function beginKeyboardPlacement(index: number): void {
		const snapshot = state.snapshot;
		if (
			!snapshot ||
			!state.gameStarted ||
			state.showIntro ||
			state.showResult ||
			state.defeatOpen ||
			state.showHelp
		) {
			return;
		}
		const card = snapshot.hand[index];
		if (!card) return;
		if (state.artilleryTargeting) state.artilleryTargeting = false;
		state.keyboardPlacement = true;
		state.draggingCardId = card.id;
		const element = document.querySelector<HTMLElement>(`[data-card-id="${card.id}"]`);
		const rect = element?.getBoundingClientRect();
		state.dragOrigin = rect
			? { x: rect.left + rect.width / 2, y: rect.top + 28 }
			: { x: window.innerWidth / 2, y: window.innerHeight - 120 };
		const pointer = state.pointerScreen ?? {
			x: window.innerWidth / 2,
			y: window.innerHeight / 2
		};
		state.dragPointer = pointer;
		state.handRaised = true;
		refreshPointerPreviews(true);
	}

	function cancelKeyboardPlacement(notify = true): void {
		if (!state.keyboardPlacement) return;
		clearDragState();
		state.handRaised = false;
		if (notify) deps.match.showToast('Build cancelled.', 'warn');
	}

	async function buildKeyboardPlacement(x: number, y: number): Promise<void> {
		const snapshot = state.snapshot;
		const draggingCard = state.draggingCard;
		if (!state.sim || !snapshot || !draggingCard) return;
		if (state.paused || state.defeatOpen || snapshot.ended) {
			deps.match.showToast('Resume the simulation before building.', 'warn');
			return;
		}
		const shifted = state.shiftHeld;
		const cellX = Math.floor(x);
		const cellY = Math.floor(y);
		const target = shifted
			? findNearestNewStructureSite(state.sim, draggingCard, cellX, cellY)
			: { x: cellX, y: cellY, tight: false };
		if (!target) {
			deps.match.showToast('No valid build site near the cursor.', 'warn');
			return;
		}
		const result = await deps.match.gameSession.command('build', {
			cardId: draggingCard.id,
			x: target.x,
			y: target.y,
			newStructureOnly: shifted,
			allowTightSpacing: shifted && target.tight
		});
		deps.match.showToast(result.message, result.ok ? 'success' : 'error');
		if (!result.ok) return;
		deps.overlay.advanceOnboarding(2, 3);
		if (!shifted) {
			clearDragState();
			return;
		}
		// Shift-build deliberately keeps the card armed for rapid placement.
		state.handRaised = true;
		const pointer = state.pointerScreen ?? {
			x: window.innerWidth / 2,
			y: window.innerHeight / 2
		};
		state.dragPointer = pointer;
		refreshPointerPreviews(true);
	}

	function structureAtScreen(clientX: number, clientY: number) {
		const snapshot = state.snapshot;
		const cameraView = state.cameraView;
		if (!snapshot || !cameraView) return null;
		let best: GameSnapshot['structures'][number] | null = null;
		let bestDistance = 16 * 16;
		for (const structure of snapshot.structures) {
			const screenX =
				cameraView.viewportWidth / 2 + (structure.x + 0.5 - cameraView.centerX) * cameraView.scale;
			const screenY =
				cameraView.viewportHeight / 2 + (structure.y + 0.5 - cameraView.centerY) * cameraView.scale;
			const dx = clientX - screenX;
			const dy = clientY - screenY;
			const distance = dx * dx + dy * dy;
			if (distance > bestDistance) continue;
			best = structure;
			bestDistance = distance;
		}
		return best;
	}

	function ownerAtScreen(clientX: number, clientY: number): number {
		const sim = state.sim;
		const cameraView = state.cameraView;
		if (!sim || !cameraView) return 0;
		const mapX =
			cameraView.centerX +
			(clientX - cameraView.viewportWidth / 2) / Math.max(0.0001, cameraView.scale);
		const mapY =
			cameraView.centerY +
			(clientY - cameraView.viewportHeight / 2) / Math.max(0.0001, cameraView.scale);
		return sim.getOwner(Math.floor(mapX), Math.floor(mapY));
	}

	function cameraViewsEqual(a: CameraView, b: CameraView): boolean {
		return (
			a.centerX === b.centerX &&
			a.centerY === b.centerY &&
			a.zoom === b.zoom &&
			a.scale === b.scale &&
			a.viewportWidth === b.viewportWidth &&
			a.viewportHeight === b.viewportHeight
		);
	}

	function menuItemButtons(): HTMLButtonElement[] {
		return contextMenuItemButtons(state.contextMenuEl);
	}

	function focusMenuItem(index = 0): void {
		focusContextMenuItem(state.contextMenuEl, index);
	}

	function moveMenuFocus(delta: 1 | -1): void {
		moveContextMenuFocus(state.contextMenuEl, delta);
	}

	function handleStructureMenuKey(event: KeyboardEvent): void {
		handleContextMenuKey(event, state.contextMenuEl, closeStructureMenu);
	}

	function clampStructureMenuToViewport(): void {
		const menu = state.structureMenu;
		const element = state.contextMenuEl;
		if (!menu || !element) return;
		state.structureMenu = clampContextMenu(menu, element, window.innerWidth, window.innerHeight);
	}

	function focusMenuAfterRender(index = 0): void {
		void tick().then(() => {
			if (!state.structureMenu) return;
			clampStructureMenuToViewport();
			focusMenuItem(index);
		});
	}

	function handleContextMenu(event: MouseEvent): void {
		event.preventDefault();
		const target = event.target as HTMLElement;
		if (target.closest('.context-menu')) return;
		cancelKeyboardPlacement();
		closeStructureMenu();
		if (target.closest('.hud, .card-tray, button')) return;
		const snapshot = state.snapshot;
		const cameraView = state.cameraView;
		if (
			!state.sim ||
			!snapshot ||
			!cameraView ||
			state.showIntro ||
			!state.gameStarted ||
			state.showResult ||
			state.defeatOpen ||
			state.showHelp
		) {
			return;
		}
		const structure = structureAtScreen(event.clientX, event.clientY);
		const ownerId = structure?.ownerId ?? ownerAtScreen(event.clientX, event.clientY);
		const menu = buildStructureMenu({
			snapshot,
			structure,
			ownerId,
			clientX: event.clientX,
			clientY: event.clientY,
			viewportWidth: window.innerWidth,
			viewportHeight: window.innerHeight
		});
		if (!menu) return;
		state.structureMenu = menu;
		state.structureMenuCameraView = cameraView;
		focusMenuAfterRender(0);
	}

	function closeStructureMenu(): void {
		state.structureMenu = null;
		state.structureMenuCameraView = null;
	}

	function handleWindowPointerDown(event: PointerEvent): void {
		if (!state.structureMenu) return;
		if ((event.target as HTMLElement).closest('.context-menu')) return;
		closeStructureMenu();
	}

	function requestDemolish(): void {
		const menu = state.structureMenu;
		if (!menu || menu.structureId === null || !menu.isOwn || menu.isState) return;
		if (state.paused) {
			deps.match.showToast('Resume the simulation before demolishing.', 'warn');
			return;
		}
		state.structureMenu = { ...menu, confirmingDemolish: true };
		focusMenuAfterRender(0);
	}

	function cancelDemolishConfirm(): void {
		const menu = state.structureMenu;
		if (!menu) return;
		state.structureMenu = { ...menu, confirmingDemolish: false };
		focusMenuAfterRender(0);
	}

	async function demolishStructure(): Promise<void> {
		const menu = state.structureMenu;
		if (!menu || !menu.confirmingDemolish) return;
		closeStructureMenu();
		if (!state.sim || menu.structureId === null || !menu.isOwn || menu.isState) return;
		if (state.paused) {
			deps.match.showToast('Resume the simulation before demolishing.', 'warn');
			return;
		}
		const result = await deps.match.gameSession.command('demolish', {
			structureId: menu.structureId
		});
		deps.match.showToast(result.message, result.ok ? 'success' : 'error');
	}

	async function requestAlliance(): Promise<void> {
		const menu = state.structureMenu;
		closeStructureMenu();
		if (!menu || !state.sim || menu.allianceOwnerId === null || menu.allianceStatus !== 'none') {
			return;
		}
		if (state.paused) {
			deps.match.showToast('Resume the simulation before requesting an alliance.', 'warn');
			return;
		}
		const result = await deps.match.gameSession.command('alliance-request', {
			targetPlayerId: menu.allianceOwnerId
		});
		deps.overlay.showDiplomacyToast(result.message, result.ok ? 'success' : 'error');
	}

	async function breakAlliance(): Promise<void> {
		const menu = state.structureMenu;
		closeStructureMenu();
		if (!menu || !state.sim || menu.allianceOwnerId === null || menu.allianceStatus !== 'active') {
			return;
		}
		if (state.paused) {
			deps.match.showToast('Resume the simulation before breaking an alliance.', 'warn');
			return;
		}
		const result = await deps.match.gameSession.command('alliance-break', {
			targetPlayerId: menu.allianceOwnerId
		});
		deps.overlay.showDiplomacyToast(result.message, result.ok ? 'success' : 'error');
	}

	function transparentDragSource(): HTMLCanvasElement {
		let image = state.transparentDragImage;
		if (!image) {
			image = document.createElement('canvas');
			image.width = 1;
			image.height = 1;
			state.transparentDragImage = image;
		}
		return image;
	}

	async function startCardDrag(event: DragEvent, card: PublicCard): Promise<void> {
		state.keyboardPlacement = false;
		state.draggingCardId = card.id;
		const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
		state.dragOrigin = { x: rect.left + rect.width / 2, y: rect.top + 28 };
		state.dragPointer = { x: event.clientX, y: event.clientY };
		state.dragLanding = null;
		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = 'move';
			event.dataTransfer.setData('text/plain', String(card.id));
			event.dataTransfer.setDragImage(transparentDragSource(), 0, 0);
		}
	}

	function endCardDrag(): void {
		clearDragState();
	}

	function updateDragHover(event: DragEvent): void {
		if (state.draggingCardId === null) return;
		state.dragPointer = { x: event.clientX, y: event.clientY };
		const draggingCard = state.draggingCard;
		if (!state.sim || !state.snapshot || !state.cameraView || !draggingCard) {
			state.dragLanding = null;
			return;
		}
		if ((event.target as HTMLElement).closest('.card-tray')) {
			state.dragLanding = null;
			return;
		}
		state.dragLanding = dragLandingAt(event.clientX, event.clientY, draggingCard);
	}

	function handleDragOver(event: DragEvent): void {
		if (state.draggingCardId === null) return;
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
		updateDragHover(event);
	}

	async function handleCardDrop(event: DragEvent): Promise<void> {
		event.preventDefault();
		const rawCardId = event.dataTransfer?.getData('text/plain');
		const cardId = rawCardId ? Number(rawCardId) : state.draggingCardId;
		clearDragState();
		const snapshot = state.snapshot;
		const cameraView = state.cameraView;
		if (!state.sim || !snapshot || !state.gameStarted || !cameraView || cardId === null) return;
		if (state.paused || state.defeatOpen || snapshot.ended) {
			deps.match.showToast('Resume the simulation before building.', 'warn');
			return;
		}

		if ((event.target as HTMLElement).closest('.card-tray')) return;
		const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
		const screenX = event.clientX - rect.left;
		const screenY = event.clientY - rect.top;
		const mapX =
			cameraView.centerX +
			(screenX - cameraView.viewportWidth / 2) / Math.max(0.0001, cameraView.scale);
		const mapY =
			cameraView.centerY +
			(screenY - cameraView.viewportHeight / 2) / Math.max(0.0001, cameraView.scale);

		const result = await deps.match.gameSession.command('build', {
			cardId,
			x: Math.floor(mapX),
			y: Math.floor(mapY)
		});
		deps.match.showToast(result.message, result.ok ? 'success' : 'error');
		if (result.ok) deps.overlay.advanceOnboarding(2, 3);
	}

	function handleWindowPointerMove(event: PointerEvent): void {
		state.pointerScreen = { x: event.clientX, y: event.clientY };
		pointerIsTouch = event.pointerType === 'touch';
		const shiftChanged = state.shiftHeld !== event.shiftKey;
		state.shiftHeld = event.shiftKey;
		state.ctrlHeld = event.ctrlKey;
		if (!state.gameStarted || state.showIntro) return;
		const draggingCard = state.draggingCard;
		if (state.keyboardPlacement) {
			if (draggingCard) {
				state.dragPointer = { x: event.clientX, y: event.clientY };
				// The shift scan is throttled; a Shift press/release mid-move
				// forces an immediate refresh so the preview never lags the key.
				refreshPointerPreviews(shiftChanged);
			}
			state.handRaised = true;
			return;
		}
		if (state.draggingCardId !== null) {
			state.handRaised = true;
			return;
		}
		const shell = state.handShellEl;
		if (!shell) return;
		const rect = shell.getBoundingClientRect();
		// When collapsed, only the peeking strip should reopen the hand; the
		// invisible layout box above it must not become a map dead zone.
		const hitTop = state.handRaised ? rect.top : rect.bottom - 38;
		state.handRaised =
			event.clientX >= rect.left &&
			event.clientX <= rect.right &&
			event.clientY >= hitTop &&
			event.clientY <= rect.bottom;
	}

	function handleHover(next: HoverState | null): void {
		state.hover = next;
	}

	return {
		clearDragState,
		dragLandingAt,
		refreshPointerPreviews,
		beginKeyboardPlacement,
		cancelKeyboardPlacement,
		buildKeyboardPlacement,
		structureAtScreen,
		ownerAtScreen,
		cameraViewsEqual,
		menuItemButtons,
		focusMenuItem,
		moveMenuFocus,
		handleStructureMenuKey,
		clampStructureMenuToViewport,
		focusMenuAfterRender,
		handleContextMenu,
		closeStructureMenu,
		handleWindowPointerDown,
		requestDemolish,
		cancelDemolishConfirm,
		demolishStructure,
		requestAlliance,
		breakAlliance,
		transparentDragSource,
		startCardDrag,
		endCardDrag,
		updateDragHover,
		handleDragOver,
		handleCardDrop,
		handleWindowPointerMove,
		handleHover
	};
}

export type InteractionController = ReturnType<typeof createInteractionController>;
