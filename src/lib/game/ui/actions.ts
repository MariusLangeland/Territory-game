import { HUMAN_PLAYER_ID } from '../constants';
import type { GameSession } from '../session/game-session';
import type { PublicStructure } from '../Structures';
import type { GameSnapshot } from '../simulation';
import type { WorkerLocalSimulation } from '../worker/local-simulation';

type OnboardingStep = 1 | 2 | 3;

/** Page callbacks/state needed by player commands. */
export interface ActionContext {
	get sim(): WorkerLocalSimulation | null;
	get snapshot(): GameSnapshot | null;
	get paused(): boolean;
	get gameStarted(): boolean;
	get showIntro(): boolean;
	get defeatOpen(): boolean;
	get artilleryTargeting(): boolean;
	get keyboardPlacement(): boolean;
	get shiftHeld(): boolean;
	get ctrlHeld(): boolean;
	get humanArtillery(): readonly PublicStructure[];
	get readyArtillery(): readonly PublicStructure[];
	get artilleryVolleyCost(): number;
	get onboardingStep(): OnboardingStep | null;
	setArtilleryTargeting(value: boolean): void;
	showToast(message: string, tone: 'success' | 'warn' | 'error'): void;
	advanceOnboarding(from: OnboardingStep, to: OnboardingStep): void;
	finishOnboarding(): void;
	buildKeyboardPlacement(x: number, y: number): Promise<void>;
	session: GameSession;
}

/** Player-initiated commands; validation stays in the worker. */
export function createActions(context: ActionContext) {
	async function handleAttack(x: number, y: number): Promise<void> {
		const sim = context.sim;
		const snapshot = context.snapshot;
		if (!sim || !snapshot || !context.gameStarted || context.showIntro) return;
		if (snapshot.ended || context.defeatOpen) return;
		if (context.keyboardPlacement) {
			await context.buildKeyboardPlacement(x, y);
			return;
		}
		if (context.paused) {
			context.showToast('Simulation paused. Resume to fire.', 'warn');
			return;
		}
		if (context.artilleryTargeting) {
			const barrage = await context.session.command('artillery', { x, y });
			context.showToast(
				barrage.ok ? 'Artillery barrage queued.' : barrage.message,
				barrage.ok ? 'success' : 'error'
			);
			if (barrage.ok) context.setArtilleryTargeting(false);
			return;
		}
		if (sim.getOwner(Math.floor(x), Math.floor(y)) === HUMAN_PLAYER_ID) {
			const upgrade = await context.session.command('upgrade', {
				x,
				y,
				levels: context.shiftHeld ? 5 : 1,
				merged: !context.ctrlHeld
			});
			context.showToast(upgrade.message, upgrade.ok ? 'success' : 'error');
			if (upgrade.ok && context.onboardingStep === 3) context.finishOnboarding();
			return;
		}
		const result = await context.session.command('attack', { x, y });
		if (!result.ok && result.reason === 'no-shared-border') {
			const naval = await context.session.command('naval', { x, y });
			if (naval.ok) {
				context.showToast(naval.message, 'success');
				return;
			}
		}
		context.showToast(result.message, result.ok ? 'success' : 'error');
		if (result.ok) context.advanceOnboarding(1, 2);
	}

	function toggleArtilleryTargeting(): void {
		const snapshot = context.snapshot;
		if (!context.sim || !snapshot || snapshot.ended) return;
		if (context.humanArtillery.length === 0) {
			context.showToast('Build an Artillery card first.', 'warn');
			return;
		}
		if (!context.artilleryTargeting && context.readyArtillery.length === 0) {
			context.showToast('All artillery is reloading.', 'warn');
			return;
		}
		if (!context.artilleryTargeting && snapshot.supply < context.artilleryVolleyCost) {
			context.showToast(`Need ${context.artilleryVolleyCost} supply to fire this volley.`, 'warn');
			return;
		}
		context.setArtilleryTargeting(!context.artilleryTargeting);
		context.showToast(
			context.artilleryTargeting
				? 'Artillery selected. Click a hostile structure or aim point in range.'
				: 'Artillery targeting cancelled.',
			context.artilleryTargeting ? 'success' : 'warn'
		);
	}

	async function cancelLatestFront(): Promise<void> {
		if (!context.sim) return;
		const result = await context.session.command('cancel-attack');
		context.showToast(result.message, result.ok ? 'success' : 'warn');
	}

	return { handleAttack, toggleArtilleryTargeting, cancelLatestFront };
}
