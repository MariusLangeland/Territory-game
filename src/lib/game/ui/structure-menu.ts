import { STRUCTURE_DEFINITIONS, type PublicStructure } from '../structures';
import type { GameSnapshot } from '../simulation';

export interface StructureContextMenu {
	x: number;
	y: number;
	structureId: number | null;
	ownerId: number;
	typeLabel: string;
	stacks: number;
	isOwn: boolean;
	isState: boolean;
	allianceOwnerId: number | null;
	allianceName: string;
	allianceStatus: 'none' | 'pending' | 'active' | 'busy';
	allianceExpiresAtTick: number | null;
	confirmingDemolish: boolean;
}

interface BuildMenuArgs {
	snapshot: GameSnapshot;
	structure: PublicStructure | null;
	ownerId: number;
	clientX: number;
	clientY: number;
	viewportWidth: number;
	viewportHeight: number;
}

const MENU_EDGE = 8;
const MENU_WIDTH = 264;

/** Build the structure/diplomacy popup payload from a map click. */
export function buildStructureMenu(args: BuildMenuArgs): StructureContextMenu | null {
	const { snapshot, structure, ownerId, clientX, clientY, viewportWidth, viewportHeight } = args;
	const humanId = snapshot.humanId;
	const isOpponent = ownerId > 0 && ownerId !== humanId;
	if (!structure && !isOpponent) return null;
	const isOwn = ownerId === humanId;
	let allianceStatus: StructureContextMenu['allianceStatus'] = 'none';
	let allianceExpiresAtTick: number | null = null;

	if (isOpponent && humanId > 0) {
		const activeAlliance = snapshot.alliances.find(
			(alliance) =>
				(alliance.playerA === humanId && alliance.playerB === ownerId) ||
				(alliance.playerA === ownerId && alliance.playerB === humanId)
		);
		const active = activeAlliance !== undefined;
		const pendingProposal = snapshot.allianceProposals.find(
			(proposal) =>
				(proposal.fromPlayerId === humanId && proposal.toPlayerId === ownerId) ||
				(proposal.fromPlayerId === ownerId && proposal.toPlayerId === humanId)
		);
		const pending = pendingProposal !== undefined;
		allianceExpiresAtTick = activeAlliance?.expiresAtTick ?? pendingProposal?.expiresAtTick ?? null;
		const targetBusy =
			snapshot.alliances.some(
				(alliance) => alliance.playerA === ownerId || alliance.playerB === ownerId
			) ||
			snapshot.allianceProposals.some(
				(proposal) => proposal.fromPlayerId === ownerId || proposal.toPlayerId === ownerId
			) ||
			snapshot.alliances.some(
				(alliance) => alliance.playerA === humanId || alliance.playerB === humanId
			) ||
			snapshot.allianceProposals.some(
				(proposal) => proposal.fromPlayerId === humanId || proposal.toPlayerId === humanId
			);
		allianceStatus = active ? 'active' : pending ? 'pending' : targetBusy ? 'busy' : 'none';
	}

	const menuHeight = structure ? 236 : 168;
	return {
		x: Math.max(MENU_EDGE, Math.min(clientX, viewportWidth - MENU_WIDTH - MENU_EDGE)),
		y: Math.max(MENU_EDGE, Math.min(clientY, viewportHeight - menuHeight - MENU_EDGE)),
		structureId: structure?.id ?? null,
		ownerId,
		typeLabel: structure ? STRUCTURE_DEFINITIONS[structure.type].label : '',
		stacks: structure?.stacks ?? 0,
		isOwn,
		isState: structure?.type === 'state',
		allianceOwnerId: isOpponent ? ownerId : null,
		allianceName: isOpponent ? (snapshot.players[ownerId - 1]?.name ?? `STATE ${ownerId}`) : '',
		allianceStatus,
		allianceExpiresAtTick,
		confirmingDemolish: false
	};
}

export function contextMenuItemButtons(root: HTMLElement | null): HTMLButtonElement[] {
	if (!root) return [];
	return Array.from(root.querySelectorAll<HTMLButtonElement>('.context-item:not(:disabled)'));
}

export function focusContextMenuItem(root: HTMLElement | null, index = 0): void {
	const items = contextMenuItemButtons(root);
	if (items.length === 0) return;
	items[Math.max(0, Math.min(index, items.length - 1))]?.focus();
}

export function moveContextMenuFocus(root: HTMLElement | null, delta: 1 | -1): void {
	const items = contextMenuItemButtons(root);
	if (items.length === 0) return;
	const current = items.findIndex((item) => item === document.activeElement);
	const next =
		current === -1
			? delta > 0
				? 0
				: items.length - 1
			: (current + delta + items.length) % items.length;
	items[next]?.focus();
}

/** Handle popup keyboard navigation; returns true when the event was consumed. */
export function handleContextMenuKey(
	event: KeyboardEvent,
	root: HTMLElement | null,
	onClose: () => void
): boolean {
	switch (event.key) {
		case 'ArrowDown':
			event.preventDefault();
			moveContextMenuFocus(root, 1);
			return true;
		case 'ArrowUp':
			event.preventDefault();
			moveContextMenuFocus(root, -1);
			return true;
		case 'Home':
			event.preventDefault();
			focusContextMenuItem(root, 0);
			return true;
		case 'End':
			event.preventDefault();
			focusContextMenuItem(root, contextMenuItemButtons(root).length - 1);
			return true;
		case 'Tab':
			event.preventDefault();
			moveContextMenuFocus(root, event.shiftKey ? -1 : 1);
			return true;
		case 'Enter':
		case ' ':
		case 'Spacebar': {
			event.preventDefault();
			const active = document.activeElement;
			if (active instanceof HTMLButtonElement && active.closest('.context-menu')) {
				active.click();
			} else {
				focusContextMenuItem(root, 0);
			}
			return true;
		}
		case 'Escape':
			event.preventDefault();
			onClose();
			return true;
	}
	return false;
}

export function clampContextMenu(
	menu: StructureContextMenu,
	element: HTMLElement,
	viewportWidth: number,
	viewportHeight: number
): StructureContextMenu {
	const width = element.offsetWidth || MENU_WIDTH;
	const height = element.offsetHeight || 160;
	const x = Math.max(MENU_EDGE, Math.min(menu.x, viewportWidth - width - MENU_EDGE));
	const y = Math.max(MENU_EDGE, Math.min(menu.y, viewportHeight - height - MENU_EDGE));
	return x === menu.x && y === menu.y ? menu : { ...menu, x, y };
}
