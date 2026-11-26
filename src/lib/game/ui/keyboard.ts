import type { CameraView } from '../render/camera-bridge';
import type { WorkerLocalSimulation } from '../worker/local-simulation';
import type { StructureContextMenu } from './structure-menu';

interface CameraBridge {
	centerOn(x: number, y: number): void;
	fitMap(): void;
	focusHuman(): void;
	zoomIn(): void;
	zoomOut(): void;
}

interface KeyboardContext {
	get sim(): WorkerLocalSimulation | null;
	get cameraView(): CameraView | null;
	get keyboardCursor(): { x: number; y: number } | null;
	get keyboardCursorAllied(): boolean;
	get keyboardPlacement(): boolean;
	get structureMenu(): StructureContextMenu | null;
	get artilleryTargeting(): boolean;
	get showHelp(): boolean;
	get defeatOpen(): boolean;
	get showIntro(): boolean;
	get showResult(): boolean;
	get canDeploy(): boolean;
	setKeyboardCursor(cursor: { x: number; y: number } | null): void;
	setArtilleryTargeting(value: boolean): void;
	setShowHelp(value: boolean): void;
	setShiftHeld(value: boolean): void;
	setCtrlHeld(value: boolean): void;
	cancelKeyboardPlacement(): void;
	beginKeyboardPlacement(index: number): void;
	togglePause(): void;
	deploy(): void;
	handleStructureMenuKey(event: KeyboardEvent): void;
	showDiplomacyToast(message: string, tone: 'success' | 'warn' | 'error'): void;
	camera: CameraBridge;
	actions: {
		handleAttack(x: number, y: number): Promise<void>;
		cancelLatestFront(): Promise<void>;
		toggleArtilleryTargeting(): void;
	};
}

/** Keyboard cursor and global gameplay shortcuts. */
export function createKeyboardInput(context: KeyboardContext) {
	function ensureCursor(): { x: number; y: number } | null {
		const sim = context.sim;
		if (!sim) return null;
		if (context.keyboardCursor) return context.keyboardCursor;
		const start = sim.map.starts[sim.humanPlayerId - 1];
		const cursor = start ? { x: start.x, y: start.y } : null;
		context.setKeyboardCursor(cursor);
		return cursor;
	}

	function moveCursor(dx: number, dy: number, fast: boolean): void {
		const sim = context.sim;
		const cameraView = context.cameraView;
		if (!sim || !cameraView) return;
		const cursor = ensureCursor();
		if (!cursor) return;
		const step = Math.max(1, Math.round(6 / Math.max(0.2, cameraView.scale))) * (fast ? 3 : 1);
		const next = {
			x: Math.max(0, Math.min(sim.width - 1, cursor.x + dx * step)),
			y: Math.max(0, Math.min(sim.height - 1, cursor.y + dy * step))
		};
		context.setKeyboardCursor(next);
		const screenX =
			cameraView.viewportWidth / 2 + (next.x + 0.5 - cameraView.centerX) * cameraView.scale;
		const screenY =
			cameraView.viewportHeight / 2 + (next.y + 0.5 - cameraView.centerY) * cameraView.scale;
		if (
			screenX < 70 ||
			screenY < 70 ||
			screenX > cameraView.viewportWidth - 70 ||
			screenY > cameraView.viewportHeight - 70
		) {
			context.camera.centerOn(next.x, next.y);
		}
	}

	function activateCursor(): void {
		const cursor = ensureCursor();
		if (!cursor) return;
		if (context.keyboardCursorAllied) {
			context.showDiplomacyToast('Allied territory cannot be attacked.', 'warn');
			return;
		}
		void context.actions.handleAttack(cursor.x, cursor.y);
	}

	function handleKeyup(event: KeyboardEvent): void {
		if (event.key === 'Shift') context.setShiftHeld(false);
		if (event.key === 'Control') context.setCtrlHeld(false);
	}

	function handleKeydown(event: KeyboardEvent): void {
		context.setShiftHeld(event.shiftKey);
		context.setCtrlHeld(event.ctrlKey);
		const target = event.target as HTMLElement | null;
		if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;

		if (context.structureMenu) {
			context.handleStructureMenuKey(event);
			return;
		}

		if (event.key === 'Escape') {
			if (context.keyboardPlacement) context.cancelKeyboardPlacement();
			else if (context.artilleryTargeting) context.setArtilleryTargeting(false);
			else if (context.keyboardCursor) context.setKeyboardCursor(null);
			else if (context.showHelp) context.setShowHelp(false);
			else if (context.defeatOpen) return;
			return;
		}

		if (context.showIntro) {
			if (event.key === 'Enter' && context.canDeploy) {
				event.preventDefault();
				context.deploy();
			}
			return;
		}

		if (context.showResult || context.defeatOpen || context.showHelp) return;

		if (/^[1-7]$/.test(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
			event.preventDefault();
			context.beginKeyboardPlacement(Number(event.key) - 1);
			return;
		}

		if (target?.closest('button, a')) return;

		if (event.code === 'Space') {
			event.preventDefault();
			context.togglePause();
			return;
		}

		const fast = event.shiftKey;
		switch (event.key) {
			case 'ArrowLeft':
				event.preventDefault();
				moveCursor(-1, 0, fast);
				return;
			case 'ArrowRight':
				event.preventDefault();
				moveCursor(1, 0, fast);
				return;
			case 'ArrowUp':
				event.preventDefault();
				moveCursor(0, -1, fast);
				return;
			case 'ArrowDown':
				event.preventDefault();
				moveCursor(0, 1, fast);
				return;
			case 'Enter':
				event.preventDefault();
				activateCursor();
				return;
		}

		switch (event.key.toLowerCase()) {
			case 'f':
				context.camera.fitMap();
				break;
			case 'c':
				context.camera.focusHuman();
				break;
			case '+':
			case '=':
				context.camera.zoomIn();
				break;
			case '-':
			case '_':
				context.camera.zoomOut();
				break;
			case 'h':
				context.setShowHelp(true);
				break;
			case 'x':
				void context.actions.cancelLatestFront();
				break;
			case 'a':
				context.actions.toggleArtilleryTargeting();
				break;
		}
	}

	return { handleKeydown, handleKeyup, ensureCursor, moveCursor, activateCursor };
}
