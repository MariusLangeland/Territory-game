import { TICK_RATE } from '#lib/game/constants';
import { saveOnboardingDone } from '#lib/game/session/onboarding';
import type { GamePageState, OnboardingStep } from './game-page-state.svelte';
import type { MatchController } from './match-controller.svelte';

export interface OverlayDeps {
	get match(): MatchController;
}

/**
 * Modal/toast presentation state machines: onboarding hints, the diplomacy
 * toast timer, and the post-defeat escape hatches. All persistent data lives in
 * the shared page state; this controller owns only timers and transitions.
 */
export function createOverlayController(state: GamePageState, deps: OverlayDeps) {
	let diplomacyToastTimer: ReturnType<typeof setTimeout> | null = null;

	function beginOnboarding(): void {
		if (state.onboardingDone) return;
		state.onboardingStep = 1;
	}

	function advanceOnboarding(from: OnboardingStep, to: OnboardingStep): void {
		if (state.onboardingStep === from) state.onboardingStep = to;
	}

	function finishOnboarding(): void {
		state.onboardingDone = true;
		state.onboardingStep = null;
		saveOnboardingDone();
	}

	function showDiplomacyToast(
		message: string,
		tone: 'success' | 'warn' | 'error' = 'success'
	): void {
		state.diplomacyToast = { message, tone };
		if (diplomacyToastTimer) clearTimeout(diplomacyToastTimer);
		diplomacyToastTimer = setTimeout(() => {
			state.diplomacyToast = null;
			diplomacyToastTimer = null;
		}, 3400);
	}

	function diplomacyRemaining(expiresAtTick: number | null): string {
		if (expiresAtTick === null) return '';
		const ticks = Math.max(0, expiresAtTick - (state.snapshot?.tick ?? 0));
		const seconds = Math.ceil(ticks / TICK_RATE);
		return seconds >= 60
			? `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
			: `${seconds}s`;
	}

	function spectate(): void {
		state.defeatOpen = false;
		state.paused = false;
		deps.match.gameSession.resume();
	}

	function reload(): void {
		window.location.reload();
	}

	function dispose(): void {
		if (diplomacyToastTimer) clearTimeout(diplomacyToastTimer);
		diplomacyToastTimer = null;
	}

	return {
		// The timer handle was part of the legacy controller surface; keep it
		// visible without making it reactive.
		get diplomacyToastTimer() {
			return diplomacyToastTimer;
		},
		set diplomacyToastTimer(value) {
			diplomacyToastTimer = value;
		},
		beginOnboarding,
		advanceOnboarding,
		finishOnboarding,
		showDiplomacyToast,
		diplomacyRemaining,
		spectate,
		reload,
		dispose
	};
}

export type OverlayController = ReturnType<typeof createOverlayController>;
