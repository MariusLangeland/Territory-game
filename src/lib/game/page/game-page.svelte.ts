import { onMount } from 'svelte';
import { goto } from '$app/navigation';
import { loadMatchSettings } from '#lib/game/match-config';
import { loadOnboardingDone } from '#lib/game/session/onboarding';
import { readSeedFromLocation } from '#lib/game/session/seed';
import { createActions } from '#lib/game/ui/actions';
import { createKeyboardInput } from '#lib/game/ui/keyboard';
import { createGamePageState, type GamePageState } from '#lib/game/page/game-page-state.svelte';
import {
	createInteractionController,
	type InteractionController
} from '#lib/game/page/interaction-controller.svelte';
import {
	createMatchController,
	type MatchController
} from '#lib/game/page/match-controller.svelte';
import {
	createOverlayController,
	type OverlayController
} from '#lib/game/page/overlay-controller.svelte';

interface PageDeps {
	match: MatchController;
	interaction: InteractionController;
	overlay: OverlayController;
}

/**
 * Copies property descriptors (not values) so accessors stay live, then wraps
 * the combined surface in a Proxy whose `set` trap forwards writable updates to
 * the controller that owns the plain property. This keeps the historical
 * `game.foo`/`bind:game.foo` API while the implementation lives in feature
 * controllers.
 */
function createControllerProxy<T extends object>(sources: readonly object[]): T {
	const target: Record<string, unknown> = {};
	const owners = new Map<string, object>();
	for (const source of sources) {
		for (const key of Object.getOwnPropertyNames(source)) {
			if (key === 'constructor') continue;
			const descriptor = Object.getOwnPropertyDescriptor(source, key);
			if (!descriptor) continue;
			Object.defineProperty(target, key, descriptor);
			owners.set(key, source);
		}
	}
	return new Proxy(target, {
		get(combined, property, receiver) {
			return Reflect.get(combined, property, receiver);
		},
		set(_combined, property, value) {
			if (typeof property !== 'string') return true;
			const owner = owners.get(property);
			if (!owner) return false;
			const descriptor = Object.getOwnPropertyDescriptor(owner, property);
			if (descriptor?.set) {
				descriptor.set.call(owner, value);
				return true;
			}
			if (descriptor && 'value' in descriptor && descriptor.writable) {
				(owner as Record<string, unknown>)[property] = value;
				return true;
			}
			// Derived/read-only view values: the legacy object literal exposed
			// setters for these, but nothing ever assigned them. Accept and ignore
			// so stray writes cannot corrupt the combined proxy target.
			return true;
		}
	}) as T;
}

export type GamePageApi = GamePageState &
	OverlayController &
	InteractionController &
	MatchController & {
		goto: typeof goto;
		actions: ReturnType<typeof createActions>;
		keyboard: ReturnType<typeof createKeyboardInput>;
	};

export function createGamePage(): GamePageApi {
	const state = createGamePageState();
	// Populated right after construction; the controllers only dereference these
	// cross-references in callbacks, never during factory setup.
	const deps = {} as PageDeps;
	const overlay = createOverlayController(state, deps);
	const interaction = createInteractionController(state, deps);
	const match = createMatchController(state, deps);
	Object.assign(deps, { match, interaction, overlay });

	state.cameraBridge.onView = (view) => {
		state.cameraView = view;
		if (!state.structureMenu) return;
		// Reports arrive on an interval even when nothing moved, so only a real
		// camera change (pan/zoom/fit/keyboard recentre) dismisses the menu.
		if (!state.structureMenuCameraView) {
			state.structureMenuCameraView = view;
			return;
		}
		if (!interaction.cameraViewsEqual(state.structureMenuCameraView, view)) {
			interaction.closeStructureMenu();
		}
	};

	const actions = createActions({
		get sim() {
			return state.sim;
		},
		get snapshot() {
			return state.snapshot;
		},
		get paused() {
			return state.paused;
		},
		get gameStarted() {
			return state.gameStarted;
		},
		get showIntro() {
			return state.showIntro;
		},
		get defeatOpen() {
			return state.defeatOpen;
		},
		get artilleryTargeting() {
			return state.artilleryTargeting;
		},
		get keyboardPlacement() {
			return state.keyboardPlacement;
		},
		get shiftHeld() {
			return state.shiftHeld;
		},
		get upgradeBatch() {
			return state.upgradeBatch;
		},
		get ctrlHeld() {
			return state.ctrlHeld;
		},
		get humanArtillery() {
			return state.humanArtillery;
		},
		get readyArtillery() {
			return state.readyArtillery;
		},
		get artilleryVolleyCost() {
			return state.artilleryVolleyCost;
		},
		get onboardingStep() {
			return state.onboardingStep;
		},
		setArtilleryTargeting(value) {
			state.artilleryTargeting = value;
		},
		showToast: match.showToast,
		advanceOnboarding: overlay.advanceOnboarding,
		finishOnboarding: overlay.finishOnboarding,
		buildKeyboardPlacement: interaction.buildKeyboardPlacement,
		session: match.gameSession
	});

	const keyboard = createKeyboardInput({
		get sim() {
			return state.sim;
		},
		get cameraView() {
			return state.cameraView;
		},
		get keyboardCursor() {
			return state.keyboardCursor;
		},
		get keyboardCursorAllied() {
			return state.keyboardCursorAllied;
		},
		get keyboardPlacement() {
			return state.keyboardPlacement;
		},
		get structureMenu() {
			return state.structureMenu;
		},
		get artilleryTargeting() {
			return state.artilleryTargeting;
		},
		get showHelp() {
			return state.showHelp;
		},
		get defeatOpen() {
			return state.defeatOpen;
		},
		get showIntro() {
			return state.showIntro;
		},
		get showResult() {
			return state.showResult;
		},
		get canDeploy() {
			return state.canDeploy;
		},
		setKeyboardCursor(cursor) {
			state.keyboardCursor = cursor;
		},
		setArtilleryTargeting(value) {
			state.artilleryTargeting = value;
		},
		setShowHelp(value) {
			state.showHelp = value;
		},
		setShiftHeld(value) {
			state.shiftHeld = value;
		},
		setCtrlHeld(value) {
			state.ctrlHeld = value;
		},
		cancelKeyboardPlacement: interaction.cancelKeyboardPlacement,
		beginKeyboardPlacement: interaction.beginKeyboardPlacement,
		togglePause: match.togglePause,
		deploy: match.deploy,
		handleStructureMenuKey: interaction.handleStructureMenuKey,
		showDiplomacyToast: overlay.showDiplomacyToast,
		camera: state.cameraBridge,
		actions
	});

	$effect(() => {
		const element = state.rankScrollEl;
		if (!element) return;

		state.rankViewportHeight = element.clientHeight;
		const observer = new ResizeObserver(() => {
			state.rankViewportHeight = element.clientHeight;
		});
		observer.observe(element);
		return () => observer.disconnect();
	});

	onMount(() => {
		window.addEventListener('keydown', keyboard.handleKeydown);
		window.addEventListener('keyup', keyboard.handleKeyup);
		window.addEventListener('pointermove', interaction.handleWindowPointerMove);
		window.addEventListener('pointerdown', interaction.handleWindowPointerDown);
		state.onboardingDone = loadOnboardingDone();
		state.matchSettings = loadMatchSettings();
		match.createWorld(readSeedFromLocation(), state.matchSettings);

		return () => {
			window.removeEventListener('keydown', keyboard.handleKeydown);
			window.removeEventListener('keyup', keyboard.handleKeyup);
			window.removeEventListener('pointermove', interaction.handleWindowPointerMove);
			window.removeEventListener('pointerdown', interaction.handleWindowPointerDown);
			overlay.dispose();
			match.gameSession.dispose();
			state.cameraBridge.onView = undefined;
		};
	});

	return createControllerProxy<GamePageApi>([
		state,
		overlay,
		interaction,
		match,
		{ goto, actions, keyboard }
	]);
}
