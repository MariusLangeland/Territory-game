import { describe, expect, it } from 'vitest';
import type { MatchView } from '../view/match-view';
import type { GameSnapshot } from '../simulation';
import type { WorkerLocalSimulation } from '../worker/local-simulation';
import { createActions, type ActionContext } from './actions';

interface CommandCall {
	type: string;
	payload: Record<string, unknown>;
}

function makeContext(overrides: Partial<ActionContext> = {}) {
	const calls: CommandCall[] = [];
	const toasts: string[] = [];
	const built: Array<{ x: number; y: number }> = [];
	const context: ActionContext = {
		get sim() {
			return { getOwner: () => 1 } as unknown as WorkerLocalSimulation;
		},
		get snapshot() {
			return { ended: false } as GameSnapshot;
		},
		get paused() {
			return false;
		},
		get gameStarted() {
			return true;
		},
		get showIntro() {
			return false;
		},
		get defeatOpen() {
			return false;
		},
		get artilleryTargeting() {
			return false;
		},
		get keyboardPlacement() {
			return false;
		},
		get shiftHeld() {
			return false;
		},
		get ctrlHeld() {
			return false;
		},
		get upgradeBatch() {
			return 1;
		},
		get humanArtillery() {
			return [];
		},
		get readyArtillery() {
			return [];
		},
		get artilleryVolleyCost() {
			return 0;
		},
		get onboardingStep() {
			return null;
		},
		setArtilleryTargeting() {},
		showToast(message) {
			toasts.push(message);
		},
		advanceOnboarding() {},
		finishOnboarding() {},
		async buildKeyboardPlacement(x, y) {
			built.push({ x, y });
		},
		session: {
			async command(type: string, payload: Record<string, unknown>) {
				calls.push({ type, payload });
				if (type === 'attack')
					return { ok: false, reason: 'ocean', message: 'Cannot take ocean pixels.' };
				if (type === 'naval') return { ok: true, message: 'Naval landing ordered.' };
				return { ok: true, message: 'ok' };
			}
		} as unknown as MatchView,
		...overrides
	};
	return { context, calls, toasts, built };
}

describe('player actions', () => {
	it('uses the selected upgrade batch for a district click', async () => {
		const { context, calls } = makeContext({
			get upgradeBatch() {
				return 10;
			}
		});
		await createActions(context).handleAttack(3, 4);
		const upgrade = calls.find((call) => call.type === 'upgrade');
		expect(upgrade?.payload).toMatchObject({ levels: 10, x: 3, y: 4 });
	});

	it('does not upgrade on shift-click when no card is armed', async () => {
		const { context, calls, toasts } = makeContext({
			get shiftHeld() {
				return true;
			}
		});
		await createActions(context).handleAttack(3, 4);
		expect(calls.some((call) => call.type === 'upgrade')).toBe(false);
		expect(toasts.at(-1)).toContain('shift-build');
	});

	it('delegates shift placement to the armed-card build path', async () => {
		const { context, calls, built } = makeContext({
			get keyboardPlacement() {
				return true;
			},
			get shiftHeld() {
				return true;
			}
		});
		await createActions(context).handleAttack(9, 11);
		expect(built).toEqual([{ x: 9, y: 11 }]);
		expect(calls).toHaveLength(0);
	});

	it('falls back from an ocean attack click to a snapping naval order', async () => {
		const { context, calls, toasts } = makeContext({
			get sim() {
				return {
					getOwner: () => 2
				} as unknown as WorkerLocalSimulation;
			}
		});
		await createActions(context).handleAttack(20, 21);
		expect(calls.map((call) => call.type)).toEqual(['attack', 'naval']);
		expect(toasts.at(-1)).toContain('Naval landing');
	});
});
