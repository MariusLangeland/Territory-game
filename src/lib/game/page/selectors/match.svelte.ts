import { formatClock } from '#lib/format';
import { TICK_RATE } from '#lib/game/constants';
import { matchSettingsEqual, type MatchSettings } from '#lib/game/match-config';
import type { GameSnapshot } from '#lib/game/simulation';
import type { WorkerLocalSimulation } from '#lib/game/worker/local-simulation';

/** State cells the match selectors read. Values must stay as getters while passed in. */
export interface MatchSelectorsDeps {
	readonly sim: WorkerLocalSimulation | null;
	readonly snapshot: GameSnapshot | null;
	readonly matchSettings: MatchSettings;
	readonly appliedMatchSettings: MatchSettings | null;
	readonly currentSeed: number;
	readonly phase: 'loading' | 'ready' | 'error';
	readonly rendererReady: boolean;
}

/**
 * Match setup/readiness, seed, atlas-size, and clock selectors. Everything here
 * derives from the shared state cells; the seed/settings setters live in the
 * core state accessors.
 */
export function createMatchSelectors(deps: MatchSelectorsDeps) {
	let settingsDirty = $derived(
		deps.appliedMatchSettings !== null &&
			!matchSettingsEqual(deps.matchSettings, deps.appliedMatchSettings)
	);
	let stateCount = $derived(deps.sim?.playerCount ?? deps.matchSettings.states);
	let mapWidth = $derived(deps.sim?.width ?? deps.matchSettings.mapWidth);
	let mapHeight = $derived(deps.sim?.height ?? deps.matchSettings.mapHeight);
	let seedHex = $derived(deps.currentSeed.toString(16).toUpperCase().padStart(8, '0'));
	let canDeploy = $derived(
		deps.phase === 'ready' && deps.rendererReady && deps.sim !== null && !settingsDirty
	);
	let deployLabel = $derived(
		settingsDirty
			? 'APPLY MATCH SETUP FIRST'
			: canDeploy
				? 'DEPLOY COMMANDER'
				: 'INITIALISING WEBGPU…'
	);
	let matchClock = $derived(formatClock((deps.snapshot?.tick ?? 0) / TICK_RATE));
	let matchTimeRemaining = $derived(
		deps.sim && deps.sim.matchDurationTicks > 0
			? formatClock(
					Math.max(0, (deps.sim.matchDurationTicks - (deps.snapshot?.tick ?? 0)) / TICK_RATE)
				)
			: null
	);

	return {
		get settingsDirty() {
			return settingsDirty;
		},
		set settingsDirty(value) {
			settingsDirty = value;
		},
		get stateCount() {
			return stateCount;
		},
		set stateCount(value) {
			stateCount = value;
		},
		get mapWidth() {
			return mapWidth;
		},
		set mapWidth(value) {
			mapWidth = value;
		},
		get mapHeight() {
			return mapHeight;
		},
		set mapHeight(value) {
			mapHeight = value;
		},
		get seedHex() {
			return seedHex;
		},
		set seedHex(value) {
			seedHex = value;
		},
		get canDeploy() {
			return canDeploy;
		},
		set canDeploy(value) {
			canDeploy = value;
		},
		get deployLabel() {
			return deployLabel;
		},
		set deployLabel(value) {
			deployLabel = value;
		},
		get matchClock() {
			return matchClock;
		},
		set matchClock(value) {
			matchClock = value;
		},
		get matchTimeRemaining() {
			return matchTimeRemaining;
		},
		set matchTimeRemaining(value) {
			matchTimeRemaining = value;
		}
	};
}
