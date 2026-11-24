import { tick } from 'svelte';
import {
	HUMAN_PLAYER_ID,
	SHIFT_BUILD_SNAP_RADIUS,
	STRUCTURE_MIN_SPACING
} from '#lib/game/constants';
import type { CameraView } from '#lib/game/render/camera-bridge';
import type { GameSnapshot } from '#lib/game/simulation';
import type { PublicCard } from '#lib/game/structures';
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
	function clearDragState(): void {
		state.draggingCardId = null;
		state.keyboardPlacement = false;
		state.dragOrigin = null;
		state.dragPointer = null;
		state.dragLanding = null;
	}

	function dragLandingAt(clientX: number, clientY: number, card: PublicCard) {
		const sim = state.sim;
		const cameraView = state.cameraView;
		if (!sim || !cameraView) return null;
		const mapX =
			cameraView.centerX +
			(clientX - cameraView.viewportWidth / 2) / Math.max(0.0001, cameraView.scale);
		const mapY =
			cameraView.centerY +
			(clientY - cameraView.viewportHeight / 2) / Math.max(0.0001, cameraView.scale);
		const cellX = Math.floor(mapX);
		const cellY = Math.floor(mapY);
		const validation = sim.validateBuild(HUMAN_PLAYER_ID, card.id, cellX, cellY);
		const targetX = validation.targetX ?? cellX;
		const targetY = validation.targetY ?? cellY;
		return {
			x: cameraView.viewportWidth / 2 + (targetX + 0.5 - cameraView.centerX) * cameraView.scale,
			y: cameraView.viewportHeight / 2 + (targetY + 0.5 - cameraView.centerY) * cameraView.scale,
			radius: STRUCTURE_MIN_SPACING * cameraView.scale,
			ok: validation.ok
		};
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
		state.dragLanding = dragLandingAt(pointer.x, pointer.y, card);
		state.handRaised = true;
	}

	function cancelKeyboardPlacement(notify = true): void {
		if (!state.keyboardPlacement) return;
		clearDragState();
		state.handRaised = false;
		if (notify) deps.match.showToast('Build cancelled.', 'warn');
	}

	/**
	 * Shift-build snaps to the nearest legal cell. Port placement already snaps
	 * internally; other cards search outward from the cursor.
	 */
	function nearestBuildCell(card: PublicCard, cellX: number, cellY: number) {
		const sim = state.sim;
		if (!sim) return null;
		// Shift-build must create a new structure, not stack onto an existing
		// district. Ports are point anchors and intentionally may overlap.
		const isNewStructureSite = (x: number, y: number) =>
			card.type === 'port' || sim.getDistrictStructureId(x, y) === 0;
		if (isNewStructureSite(cellX, cellY)) {
			const origin = sim.validateBuild(HUMAN_PLAYER_ID, card.id, cellX, cellY);
			if (origin.ok) {
				return { x: origin.targetX ?? cellX, y: origin.targetY ?? cellY };
			}
		}
		if (card.type === 'port') return null;
		let bestX = -1;
		let bestY = -1;
		let bestDistance = Number.POSITIVE_INFINITY;
		const minX = Math.max(0, cellX - SHIFT_BUILD_SNAP_RADIUS);
		const maxX = Math.min(sim.width - 1, cellX + SHIFT_BUILD_SNAP_RADIUS);
		const minY = Math.max(0, cellY - SHIFT_BUILD_SNAP_RADIUS);
		const maxY = Math.min(sim.height - 1, cellY + SHIFT_BUILD_SNAP_RADIUS);
		for (let y = minY; y <= maxY; y++) {
			for (let x = minX; x <= maxX; x++) {
				if (!sim.isLand(x, y)) continue;
				if (!isNewStructureSite(x, y)) continue;
				const validation = sim.validateBuild(HUMAN_PLAYER_ID, card.id, x, y);
				if (!validation.ok) continue;
				const targetX = validation.targetX ?? x;
				const targetY = validation.targetY ?? y;
				const dx = targetX - cellX;
				const dy = targetY - cellY;
				const distance = dx * dx + dy * dy;
				if (
					distance < bestDistance ||
					(distance === bestDistance && (bestY < 0 || y < bestY || (y === bestY && x < bestX)))
				) {
					bestX = targetX;
					bestY = targetY;
					bestDistance = distance;
				}
			}
		}
		return bestX >= 0 ? { x: bestX, y: bestY } : null;
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
		const target = shifted ? nearestBuildCell(draggingCard, cellX, cellY) : { x: cellX, y: cellY };
		if (!target) {
			deps.match.showToast('No valid build site near the cursor.', 'warn');
			return;
		}
		const result = await deps.match.gameSession.command('build', {
			cardId: draggingCard.id,
			x: target.x,
			y: target.y
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
		state.dragLanding = dragLandingAt(pointer.x, pointer.y, draggingCard);
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
		state.shiftHeld = event.shiftKey;
		state.ctrlHeld = event.ctrlKey;
		if (!state.gameStarted || state.showIntro) return;
		const draggingCard = state.draggingCard;
		if (state.keyboardPlacement) {
			if (draggingCard) {
				state.dragPointer = { x: event.clientX, y: event.clientY };
				state.dragLanding = dragLandingAt(event.clientX, event.clientY, draggingCard);
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
