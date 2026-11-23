import type { GameSnapshot } from '#lib/game/simulation';
import type { WorkerLocalSimulation } from '#lib/game/worker/local-simulation';
import type { OnboardingStep } from './types';

/** State cells the overlay/post-match selectors read. Values must stay as getters while passed in. */
export interface OverlaySelectorsDeps {
	readonly sim: WorkerLocalSimulation | null;
	readonly snapshot: GameSnapshot | null;
	readonly workerTelemetryVersion: number;
	readonly onboardingStep: OnboardingStep | null;
	readonly gameStarted: boolean;
	readonly showIntro: boolean;
	readonly showHelp: boolean;
	readonly defeatOpen: boolean;
	readonly paused: boolean;
}

/**
 * Post-match AI telemetry and onboarding-copy selectors. Presentation
 * controllers own the transitions; these groups only derive the rendered copy.
 */
export function createOverlaySelectors(deps: OverlaySelectorsDeps) {
	let aiPostMatch = $derived.by(() => {
		void deps.snapshot;
		void deps.workerTelemetryVersion;
		return deps.sim?.getBotBehaviorTelemetry() ?? null;
	});
	let aiOptionSummary = $derived.by(() => {
		void deps.snapshot;
		if (!aiPostMatch) return '—';
		return Object.entries(aiPostMatch.optionSelections)
			.sort((left, right) => right[1] - left[1])
			.slice(0, 3)
			.map(([id, count]) => `${id} ${count}`)
			.join(' / ');
	});
	let onboardingVisible = $derived(
		deps.onboardingStep !== null &&
			deps.gameStarted &&
			!deps.showIntro &&
			!deps.showHelp &&
			!deps.defeatOpen &&
			!deps.paused &&
			deps.snapshot?.ended !== true
	);
	let onboardingCopy = $derived.by(() => {
		switch (deps.onboardingStep) {
			case 1:
				return {
					index: '01 / 03',
					title: 'OPEN A FRONT',
					body: 'Click any land pixel touching your border. One click buys a front; repeated clicks create separate fronts.'
				};
			case 2:
				return {
					index: '02 / 03',
					title: 'BUILD SOMETHING',
					body: 'Drag a card into your territory, or press its number key then left-click the map. Right-click cancels placement.'
				};
			case 3:
				return {
					index: '03 / 03',
					title: 'UPGRADE A DISTRICT',
					body: 'Click anywhere inside one of your built districts to raise its structure. Each level costs more supply.'
				};
			default:
				return null;
		}
	});

	return {
		get aiPostMatch() {
			return aiPostMatch;
		},
		set aiPostMatch(value) {
			aiPostMatch = value;
		},
		get aiOptionSummary() {
			return aiOptionSummary;
		},
		set aiOptionSummary(value) {
			aiOptionSummary = value;
		},
		get onboardingVisible() {
			return onboardingVisible;
		},
		set onboardingVisible(value) {
			onboardingVisible = value;
		},
		get onboardingCopy() {
			return onboardingCopy;
		},
		set onboardingCopy(value) {
			onboardingCopy = value;
		}
	};
}
