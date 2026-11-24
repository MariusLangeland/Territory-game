import { goto } from '$app/navigation';
import type { RendererFrameStats } from '#lib/game/render/territory-renderer';
import { GameSession } from '#lib/game/session/game-session';
import { parseSeed, randomSeed, readSeedFromLocation, seedHexFor } from '#lib/game/session/seed';
import type { GameSnapshot, SimEvent } from '#lib/game/simulation';
import {
	mapPreset,
	normalizeMatchSettings,
	saveMatchSettings,
	type MatchSettings
} from '#lib/game/match-config';
import type { WorkerLocalSimulation } from '#lib/game/worker/local-simulation';
import type { LocalWorkerVisual } from '#lib/game/worker/local-protocol';
import type { GamePageState } from './game-page-state.svelte';
import type { InteractionController } from './interaction-controller.svelte';
import type { OverlayController } from './overlay-controller.svelte';

export interface MatchDeps {
	get interaction(): InteractionController;
	get overlay(): OverlayController;
}

/**
 * Match lifecycle: settings persistence, world/seed creation, the worker
 * session, tick dispatch, and renderer callbacks. Owns the `GameSession`
 * because it is the only controller that starts/stops the match worker.
 */
export function createMatchController(state: GamePageState, deps: MatchDeps) {
	/**
	 * Successful commands stay silent; warnings/errors use the existing compact
	 * HUD toast so shift-build and naval-snap guidance is visible to the player.
	 */
	function showToast(message: string, tone: 'success' | 'error' | 'warn' = 'success'): void {
		if (tone === 'success') return;
		deps.overlay.showDiplomacyToast(message, tone);
	}

	function persistMatchSettings(): void {
		saveMatchSettings(state.matchSettings);
	}

	function applyMapPreset(): void {
		const preset = mapPreset(state.matchSettings.mapPreset);
		state.matchSettings = {
			...state.matchSettings,
			mapWidth: preset.width,
			mapHeight: preset.height
		};
		persistMatchSettings();
	}

	function applyMatchSettings(): void {
		persistMatchSettings();
		createWorld(state.currentSeed || readSeedFromLocation(), state.matchSettings);
	}

	function applySeedPreset(seed: number): void {
		persistMatchSettings();
		createWorld(seed >>> 0, state.matchSettings);
	}

	function createWorld(seed: number, settings: MatchSettings = state.matchSettings): void {
		const normalized = normalizeMatchSettings(settings);
		state.matchSettings = { ...normalized };
		state.appliedMatchSettings = { ...normalized };
		state.phase = 'loading';
		state.errorMessage = '';
		state.rendererReady = false;
		state.artilleryTargeting = false;
		state.sim = null;
		state.snapshot = null;
		state.workerVisuals = [];
		state.workerVisualRevision = 0;
		state.lastWorkerUiTick = -100;
		state.gameStarted = false;
		state.showIntro = true;
		state.showHelp = false;
		state.defeatOpen = false;
		state.defeatHandled = false;
		state.paused = true;
		state.hover = null;
		deps.interaction.closeStructureMenu();
		state.cameraView = null;
		state.rankScrollTop = 0;
		state.handRaised = true;
		deps.interaction.clearDragState();
		state.eventFeed = [];
		state.currentSeed = seed >>> 0;
		state.seedInput = seedHexFor(seed);
		gameSession.start(seed, normalized);
	}

	function deploy(): void {
		if (!state.canDeploy) return;
		state.showIntro = false;
		state.gameStarted = true;
		state.artilleryTargeting = false;
		state.paused = false;
		gameSession.resume();
		deps.overlay.beginOnboarding();
	}

	function togglePause(): void {
		if (!state.gameStarted || state.showResult || state.defeatOpen) return;
		state.paused = !state.paused;
		if (state.paused) gameSession.pause();
		else gameSession.resume();
	}

	function newWorld(): void {
		createWorld(randomSeed());
	}

	function rematch(): void {
		createWorld(state.currentSeed);
	}

	async function copySeed(): Promise<void> {
		try {
			await navigator.clipboard.writeText(String(state.currentSeed));
			showToast(`Seed ${state.currentSeed} copied.`, 'success');
		} catch {
			showToast(`Seed: ${state.currentSeed}`, 'warn');
		}
	}

	function applySeed(): void {
		const parsed = parseSeed(state.seedInput);
		if (parsed === null) {
			showToast('Seed must be 1–8 hexadecimal characters.', 'warn');
			return;
		}
		if (parsed === state.currentSeed && state.phase === 'ready') {
			showToast('That world is already loaded.', 'warn');
			return;
		}
		createWorld(parsed);
	}

	function handleSessionReady(next: WorkerLocalSimulation, seed: number): void {
		state.sim = next;
		state.snapshot = next.getSnapshot();
		state.phase = 'ready';
		const url = new URL(window.location.href);
		url.searchParams.set('seed', String(seed >>> 0));
		void goto(url, { replace: true, reset: false, state: {} });
	}

	function handleWorkerVisual(visual: LocalWorkerVisual): void {
		if (!state.sim) return;
		state.workerVisualRevision++;
		state.workerVisuals = [
			...state.workerVisuals,
			{
				revision: state.workerVisualRevision,
				tick: visual.tick,
				snapshot: visual.snapshot,
				changes: visual.changes,
				changeCount: visual.changes.length,
				overflow: visual.changesOverflow,
				districtTiles: visual.districtTiles
			}
		].slice(-8);
		if (
			visual.tick - state.lastWorkerUiTick >= 2 ||
			visual.events.length > 0 ||
			visual.snapshot.ended
		) {
			state.lastWorkerUiTick = visual.tick;
			handleTick(visual.snapshot, visual.events);
		}
	}

	function acknowledgeWorkerVisuals(lastRevision: number): void {
		state.workerVisuals = state.workerVisuals.filter((visual) => visual.revision > lastRevision);
	}

	function handleTick(next: GameSnapshot, events: SimEvent[]): void {
		const previous = state.snapshot;
		state.snapshot = next;

		const important = events.filter((event) => event.kind !== 'system');
		if (previous && next.humanId > 0) {
			const hadActive = previous.alliances.some(
				(alliance) => alliance.playerA === next.humanId || alliance.playerB === next.humanId
			);
			const hasActive = next.alliances.some(
				(alliance) => alliance.playerA === next.humanId || alliance.playerB === next.humanId
			);
			const hadPending = previous.allianceProposals.some(
				(proposal) => proposal.fromPlayerId === next.humanId || proposal.toPlayerId === next.humanId
			);
			const hasPending = next.allianceProposals.some(
				(proposal) => proposal.fromPlayerId === next.humanId || proposal.toPlayerId === next.humanId
			);
			if (!hadActive && hasActive) {
				deps.overlay.showDiplomacyToast(
					'Alliance formed. Allied territory is now protected.',
					'success'
				);
			} else if (hadPending && !hasPending && !hasActive) {
				const declined = important.some(
					(event) => event.kind === 'alliance' && event.message.includes('declined')
				);
				deps.overlay.showDiplomacyToast(
					declined ? 'Alliance request declined.' : 'Alliance request expired.',
					'warn'
				);
			} else if (hadActive && !hasActive) {
				const broke = important.some(
					(event) => event.kind === 'alliance' && event.message.includes('broke')
				);
				if (!broke) deps.overlay.showDiplomacyToast('Alliance expired.', 'warn');
			}
		}
		if (important.length > 0) {
			state.eventFeed = [...important, ...state.eventFeed].slice(0, 4);
		}
		if (
			state.gameStarted &&
			events.some(
				(event) =>
					event.kind === 'structure' &&
					event.playerId === next.humanId &&
					event.message.includes('State structure')
			)
		) {
			showToast(
				'Your State structure was destroyed. Territory is no longer protected from annexation.',
				'error'
			);
		}

		if (!state.gameStarted) return;
		const humanState = next.players.find((player) => player.id === next.humanId);
		if (!humanState?.alive && !state.defeatHandled && !next.ended) {
			state.defeatHandled = true;
			state.defeatOpen = true;
			state.paused = true;
			gameSession.pause();
		}
		if (next.ended) {
			state.paused = true;
			state.defeatOpen = false;
		}
	}

	function handleReady(): void {
		state.rendererReady = true;
	}

	function handleError(error: Error): void {
		state.errorMessage = error.message;
		state.phase = 'error';
		state.paused = true;
	}

	function handlePerf(stats: RendererFrameStats): void {
		state.perf = stats;
	}

	function navigateFromMinimap(x: number, y: number): void {
		state.cameraBridge.centerOn(x, y, Math.max(2.2, state.cameraView?.zoom ?? 2.2));
	}

	function handleRankScroll(event: Event): void {
		state.rankScrollTop = (event.currentTarget as HTMLElement).scrollTop;
	}

	const gameSession = new GameSession({
		onReady: handleSessionReady,
		onVisual: handleWorkerVisual,
		onTelemetry: () => state.workerTelemetryVersion++,
		onError: handleError
	});

	return {
		get gameSession() {
			return gameSession;
		},
		persistMatchSettings,
		applyMapPreset,
		applyMatchSettings,
		applySeedPreset,
		createWorld,
		deploy,
		togglePause,
		newWorld,
		rematch,
		copySeed,
		applySeed,
		showToast,
		handleSessionReady,
		handleWorkerVisual,
		acknowledgeWorkerVisuals,
		handleTick,
		handleReady,
		handleError,
		handlePerf,
		navigateFromMinimap,
		handleRankScroll
	};
}

export type MatchController = ReturnType<typeof createMatchController>;
