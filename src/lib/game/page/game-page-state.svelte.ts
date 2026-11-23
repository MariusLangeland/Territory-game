import { formatClock } from '#lib/format';
import { ARTILLERY_SUPPLY_COST_PER_LEVEL, HUMAN_PLAYER_ID, TICK_RATE } from '#lib/game/constants';
import {
	DEFAULT_MATCH_SETTINGS,
	matchSettingsEqual,
	type MatchSettings
} from '#lib/game/match-config';
import { GameCameraBridge, type CameraView } from '#lib/game/render/camera-bridge';
import type { RendererFrameStats } from '#lib/game/render/territory-renderer';
import { STRUCTURE_ACCENTS } from '#lib/game/Structures';
import type { GameSnapshot, SimEvent } from '#lib/game/simulation';
import type { StructureContextMenu } from '#lib/game/ui/structure-menu';
import type { WorkerLocalSimulation } from '#lib/game/worker/local-simulation';

export interface HoverState {
	x: number;
	y: number;
	owner: number;
	land: boolean;
	elevation: number;
	baseDefense: number;
	auraDefense: number;
	defense: number;
}

export interface WorkerVisualEntry {
	revision: number;
	tick: number;
	snapshot: GameSnapshot;
	changes: Uint32Array;
	changeCount: number;
	overflow: boolean;
	districtTiles: number[];
}

export type OnboardingStep = 1 | 2 | 3;

/**
 * Owns every reactive value rendered by the game page. Feature controllers
 * mutate these through the getters/setters; keeping the declarations in one
 * `.svelte.ts` module preserves rune reactivity across module boundaries.
 */
export function createGamePageState() {
	let sim = $state<WorkerLocalSimulation | null>(null);
	let snapshot = $state<GameSnapshot | null>(null);
	let workerVisuals = $state<WorkerVisualEntry[]>([]);
	let workerVisualRevision = 0;
	let lastWorkerUiTick = -100;
	let workerTelemetryVersion = $state(0);
	let phase = $state<'loading' | 'ready' | 'error'>('loading');
	let errorMessage = $state('');
	let rendererReady = $state(false);
	let gameStarted = $state(false);
	let paused = $state(true);
	let showIntro = $state(true);
	let showHelp = $state(false);
	let onboardingStep = $state<OnboardingStep | null>(null);
	let onboardingDone = $state(false);
	let defeatOpen = $state(false);
	let defeatHandled = $state(false);
	let hover = $state<HoverState | null>(null);
	let structureMenu = $state<StructureContextMenu | null>(null);
	let contextMenuEl = $state<HTMLDivElement | null>(null);
	let pointerScreen = $state<{ x: number; y: number } | null>(null);
	let shiftHeld = $state(false);
	let ctrlHeld = $state(false);
	let cameraView = $state<CameraView | null>(null);
	// Non-reactive anchor: the camera view captured when the popup opens, so the
	// renderer's periodic view reports do not dismiss a freshly positioned menu.
	let structureMenuCameraView: CameraView | null = null;
	let perf = $state<RendererFrameStats>({
		fps: 0,
		uploadedPixels: 0,
		uploadCalls: 0,
		frames: 0
	});
	let eventFeed = $state<SimEvent[]>([]);
	let currentSeed = $state(0);
	let seedInput = $state('');
	let rankScrollEl = $state<HTMLDivElement | null>(null);
	let rankScrollTop = $state(0);
	let rankViewportHeight = $state(360);
	let handRaised = $state(true);
	let handShellEl = $state<HTMLDivElement | null>(null);
	let matchSettings = $state<MatchSettings>({ ...DEFAULT_MATCH_SETTINGS });
	let appliedMatchSettings = $state<MatchSettings | null>(null);
	let settingsDirty = $derived(
		appliedMatchSettings !== null && !matchSettingsEqual(matchSettings, appliedMatchSettings)
	);
	let stateCount = $derived(sim?.playerCount ?? matchSettings.states);
	let mapWidth = $derived(sim?.width ?? matchSettings.mapWidth);
	let mapHeight = $derived(sim?.height ?? matchSettings.mapHeight);
	let keyboardCursor = $state<{ x: number; y: number } | null>(null);
	let keyboardCursorScreen = $derived.by(() => {
		if (!keyboardCursor || !cameraView) return null;
		return {
			x:
				cameraView.viewportWidth / 2 +
				(keyboardCursor.x + 0.5 - cameraView.centerX) * cameraView.scale,
			y:
				cameraView.viewportHeight / 2 +
				(keyboardCursor.y + 0.5 - cameraView.centerY) * cameraView.scale
		};
	});
	let keyboardCursorStatus = $derived.by(() => {
		if (!keyboardCursor || !sim || !snapshot) return '';
		const { x, y } = keyboardCursor;
		const ownerId = sim.getOwner(x, y);
		const owner = snapshot.players.find((player) => player.id === ownerId);
		const defense = sim.getDefense(x, y);
		const action = keyboardCursorAllied
			? 'Allied territory; Enter is disabled'
			: artilleryTargeting
				? 'Enter fires artillery'
				: ownerId === HUMAN_PLAYER_ID && sim.getDistrictStructureId(x, y)
					? 'Enter upgrades'
					: 'Enter attacks';
		return `Cursor ${x}, ${y}. ${owner ? owner.name : 'Unclaimed land'}. Defense ${defense}. ${action}.`;
	});
	let draggingCardId = $state<number | null>(null);
	let keyboardPlacement = $state(false);
	let dragOrigin = $state<{ x: number; y: number } | null>(null);
	let dragPointer = $state<{ x: number; y: number } | null>(null);
	let dragLanding = $state<{
		x: number;
		y: number;
		radius: number;
		ok: boolean;
	} | null>(null);
	let transparentDragImage: HTMLCanvasElement | null = null;
	let diplomacyToast = $state<{ message: string; tone: 'success' | 'warn' | 'error' } | null>(null);
	let artilleryTargeting = $state(false);

	const RANK_ROW_HEIGHT = 28;
	const RANK_OVERSCAN = 3;

	const cameraBridge = new GameCameraBridge();

	let humanFronts = $derived(
		snapshot?.attacks.filter((attack) => attack.attackerId === HUMAN_PLAYER_ID) ?? []
	);
	let humanAllyName = $derived.by(() => {
		if (!snapshot) return null;
		const alliance = snapshot.alliances.find(
			(entry) => entry.playerA === HUMAN_PLAYER_ID || entry.playerB === HUMAN_PLAYER_ID
		);
		if (!alliance) return null;
		const allyId = alliance.playerA === HUMAN_PLAYER_ID ? alliance.playerB : alliance.playerA;
		return snapshot.players[allyId - 1]?.name ?? `STATE ${allyId}`;
	});
	let humanAlliancePending = $derived(
		snapshot?.allianceProposals.some(
			(proposal) =>
				proposal.fromPlayerId === HUMAN_PLAYER_ID || proposal.toPlayerId === HUMAN_PLAYER_ID
		) ?? false
	);
	let hoverIsAlly = $derived.by(() => {
		if (!snapshot || !hover?.land || hover.owner <= 0 || hover.owner === snapshot.humanId) {
			return false;
		}
		return snapshot.alliances.some(
			(alliance) =>
				(alliance.playerA === snapshot?.humanId && alliance.playerB === hover?.owner) ||
				(alliance.playerB === snapshot?.humanId && alliance.playerA === hover?.owner)
		);
	});
	let keyboardCursorAllied = $derived.by(() => {
		if (!keyboardCursor || !sim || !snapshot) return false;
		const ownerId = sim.getOwner(keyboardCursor.x, keyboardCursor.y);
		if (ownerId <= 0 || ownerId === snapshot.humanId) return false;
		return snapshot.alliances.some(
			(alliance) =>
				(alliance.playerA === snapshot?.humanId && alliance.playerB === ownerId) ||
				(alliance.playerB === snapshot?.humanId && alliance.playerA === ownerId)
		);
	});
	let humanArtillery = $derived(
		snapshot?.structures.filter(
			(structure) => structure.type === 'artillery' && structure.ownerId === HUMAN_PLAYER_ID
		) ?? []
	);
	let readyArtillery = $derived(
		humanArtillery.filter((structure) => structure.readyAtTick <= (snapshot?.tick ?? 0))
	);
	let readyArtilleryShells = $derived(
		readyArtillery.reduce((total, structure) => total + structure.stacks, 0)
	);
	let artilleryVolleyCost = $derived(readyArtilleryShells * ARTILLERY_SUPPLY_COST_PER_LEVEL);
	let supplyPreview: { label: string; cost: number; affordable: boolean } | null = $derived.by(
		() => {
			if (
				!sim ||
				!snapshot ||
				!hover?.land ||
				!gameStarted ||
				showIntro ||
				defeatOpen ||
				snapshot.ended ||
				paused
			) {
				return null;
			}
			const x = Math.floor(hover.x);
			const y = Math.floor(hover.y);
			if (artilleryTargeting) {
				const barrage = sim.validateArtillery(HUMAN_PLAYER_ID, x, y);
				if (!barrage.ok && barrage.reason !== 'no-supply') return null;
				return {
					label: 'ARTILLERY',
					cost: artilleryVolleyCost,
					affordable: snapshot.supply >= artilleryVolleyCost
				};
			}
			if (hover.owner === HUMAN_PLAYER_ID) {
				if (sim.getDistrictStructureId(x, y) === 0) return null;
				const levels = shiftHeld ? 5 : 1;
				const quote = sim.getUpgradeQuote(HUMAN_PLAYER_ID, x, y, levels, !ctrlHeld);
				if (quote.currentLevel === 0) return null;
				return {
					label: quote.merged
						? levels === 5
							? 'MERGED ×5'
							: 'MERGED'
						: levels === 5
							? 'UPGRADE ×5'
							: 'UPGRADE',
					cost: quote.cost,
					affordable: quote.ok
				};
			}
			const attack = sim.validateAttack(HUMAN_PLAYER_ID, x, y);
			if (!attack.ok && attack.reason !== 'no-orders') return null;
			const cost = sim.getAttackStats(HUMAN_PLAYER_ID, hover.owner).cost;
			return {
				label: 'FRONT',
				cost,
				affordable: snapshot.supply >= cost
			};
		}
	);
	let supplyBar = $derived.by(() => {
		const cap = Math.max(1, snapshot?.supplyCap ?? 1);
		const supply = snapshot?.supply ?? 0;
		const fill = Math.max(0, Math.min(100, (supply / cap) * 100));
		const cost = supplyPreview?.cost ?? 0;
		const costWidth = Math.min(fill, (cost / cap) * 100);
		return { cap, supply, fill, costWidth, costStart: fill - costWidth };
	});
	let upgradeTooltip = $derived.by(() => {
		if (
			!sim ||
			!snapshot ||
			!hover?.land ||
			!pointerScreen ||
			!gameStarted ||
			showIntro ||
			showHelp ||
			defeatOpen ||
			snapshot.ended ||
			draggingCardId !== null ||
			artilleryTargeting
		) {
			return null;
		}
		const x = hover.x;
		const y = hover.y;
		if (sim.getOwner(x, y) !== HUMAN_PLAYER_ID) return null;
		if (sim.getDistrictStructureId(x, y) === 0) return null;
		const levels = shiftHeld ? 5 : 1;
		const quote = sim.getUpgradeQuote(HUMAN_PLAYER_ID, x, y, levels, !ctrlHeld);
		if (quote.currentLevel === 0) return null;
		return {
			x: pointerScreen.x,
			y: pointerScreen.y,
			levels: quote.levels,
			cost: quote.cost,
			currentLevel: quote.currentLevel,
			projectedLevel: quote.projectedLevel,
			merged: quote.merged,
			structureCount: quote.structureCount,
			ok: quote.ok
		};
	});
	let human = $derived.by(() => {
		if (!snapshot) return null;
		const humanId = snapshot.humanId;
		return snapshot.players.find((player) => player.id === humanId) ?? null;
	});
	let humanStructure = $derived.by(() => {
		if (!snapshot || !human) return null;
		const humanId = human.id;
		return snapshot.structures.find((structure) => structure.ownerId === humanId) ?? null;
	});
	let ranked = $derived(
		snapshot
			? [...snapshot.players].sort(
					(a, b) => Number(b.alive) - Number(a.alive) || b.territory - a.territory || a.id - b.id
				)
			: []
	);
	let humanRank = $derived.by(() => {
		if (!human) return 0;
		const humanId = human.id;
		return ranked.findIndex((p) => p.id === humanId) + 1;
	});
	let rankWindow = $derived.by(() => {
		const start = Math.max(0, Math.floor(rankScrollTop / RANK_ROW_HEIGHT) - RANK_OVERSCAN);
		const visibleRows = Math.ceil(rankViewportHeight / RANK_ROW_HEIGHT) + RANK_OVERSCAN * 2;
		return {
			start,
			end: Math.min(ranked.length, start + visibleRows)
		};
	});
	let visibleRanked = $derived(ranked.slice(rankWindow.start, rankWindow.end));
	let aliveCount = $derived(snapshot ? snapshot.players.filter((p) => p.alive).length : 0);
	let worldClaim = $derived(
		snapshot && snapshot.landCount > 0 ? (snapshot.claimedLand / snapshot.landCount) * 100 : 0
	);
	let winner = $derived(
		snapshot?.winnerId
			? (snapshot.players.find((player) => player.id === snapshot?.winnerId) ?? null)
			: null
	);
	let showResult = $derived(Boolean(gameStarted && snapshot?.ended));
	let aiPostMatch = $derived.by(() => {
		void snapshot;
		void workerTelemetryVersion;
		return sim?.getBotBehaviorTelemetry() ?? null;
	});
	let aiOptionSummary = $derived.by(() => {
		void snapshot;
		if (!aiPostMatch) return '—';
		return Object.entries(aiPostMatch.optionSelections)
			.sort((left, right) => right[1] - left[1])
			.slice(0, 3)
			.map(([id, count]) => `${id} ${count}`)
			.join(' / ');
	});
	let seedHex = $derived(currentSeed.toString(16).toUpperCase().padStart(8, '0'));
	let canDeploy = $derived(phase === 'ready' && rendererReady && sim !== null && !settingsDirty);
	let deployLabel = $derived(
		settingsDirty
			? 'APPLY MATCH SETUP FIRST'
			: canDeploy
				? 'DEPLOY COMMANDER'
				: 'INITIALISING WEBGPU…'
	);
	let onboardingVisible = $derived(
		onboardingStep !== null &&
			gameStarted &&
			!showIntro &&
			!showHelp &&
			!defeatOpen &&
			!paused &&
			snapshot?.ended !== true
	);
	let onboardingCopy = $derived.by(() => {
		switch (onboardingStep) {
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
	let matchClock = $derived(formatClock((snapshot?.tick ?? 0) / TICK_RATE));
	let matchTimeRemaining = $derived(
		sim && sim.matchDurationTicks > 0
			? formatClock(Math.max(0, (sim.matchDurationTicks - (snapshot?.tick ?? 0)) / TICK_RATE))
			: null
	);
	let draggingCard = $derived(
		draggingCardId === null
			? null
			: (snapshot?.hand.find((card) => card.id === draggingCardId) ?? null)
	);
	let dragAccent = $derived(draggingCard ? STRUCTURE_ACCENTS[draggingCard.type] : '#f7eed0');
	let dragArrow = $derived.by(() => {
		if (!dragOrigin || !dragPointer) return null;
		const startX = dragOrigin.x;
		const startY = dragOrigin.y;
		const endX = dragPointer.x;
		const endY = dragPointer.y;
		const dx = endX - startX;
		const dy = endY - startY;
		const length = Math.max(1, Math.hypot(dx, dy));
		const bend = Math.min(95, Math.max(34, length * 0.2));
		const midX = (startX + endX) / 2;
		const midY = (startY + endY) / 2;
		const controlX = midX + (-dy / length) * bend;
		const controlY = midY + (dx / length) * bend;
		const angle = Math.atan2(endY - controlY, endX - controlX);
		const head = 13;
		const left = angle + Math.PI * 0.82;
		const right = angle - Math.PI * 0.82;
		return {
			path: `M ${startX} ${startY} Q ${controlX} ${controlY} ${endX} ${endY}`,
			head: `M ${endX} ${endY} L ${endX + Math.cos(left) * head} ${
				endY + Math.sin(left) * head
			} L ${endX + Math.cos(right) * head} ${endY + Math.sin(right) * head} Z`
		};
	});
	let scaleLegend = $derived(
		cameraView ? `${Math.round(100 / cameraView.scale)} px / 100 px` : '—'
	);

	return {
		RANK_ROW_HEIGHT,
		RANK_OVERSCAN,
		cameraBridge,

		get sim() {
			return sim;
		},
		set sim(value) {
			sim = value;
		},
		get snapshot() {
			return snapshot;
		},
		set snapshot(value) {
			snapshot = value;
		},
		get workerVisuals() {
			return workerVisuals;
		},
		set workerVisuals(value) {
			workerVisuals = value;
		},
		get workerVisualRevision() {
			return workerVisualRevision;
		},
		set workerVisualRevision(value) {
			workerVisualRevision = value;
		},
		get lastWorkerUiTick() {
			return lastWorkerUiTick;
		},
		set lastWorkerUiTick(value) {
			lastWorkerUiTick = value;
		},
		get workerTelemetryVersion() {
			return workerTelemetryVersion;
		},
		set workerTelemetryVersion(value) {
			workerTelemetryVersion = value;
		},
		get phase() {
			return phase;
		},
		set phase(value) {
			phase = value;
		},
		get errorMessage() {
			return errorMessage;
		},
		set errorMessage(value) {
			errorMessage = value;
		},
		get rendererReady() {
			return rendererReady;
		},
		set rendererReady(value) {
			rendererReady = value;
		},
		get gameStarted() {
			return gameStarted;
		},
		set gameStarted(value) {
			gameStarted = value;
		},
		get paused() {
			return paused;
		},
		set paused(value) {
			paused = value;
		},
		get showIntro() {
			return showIntro;
		},
		set showIntro(value) {
			showIntro = value;
		},
		get showHelp() {
			return showHelp;
		},
		set showHelp(value) {
			showHelp = value;
		},
		get onboardingStep() {
			return onboardingStep;
		},
		set onboardingStep(value) {
			onboardingStep = value;
		},
		get onboardingDone() {
			return onboardingDone;
		},
		set onboardingDone(value) {
			onboardingDone = value;
		},
		get defeatOpen() {
			return defeatOpen;
		},
		set defeatOpen(value) {
			defeatOpen = value;
		},
		get defeatHandled() {
			return defeatHandled;
		},
		set defeatHandled(value) {
			defeatHandled = value;
		},
		get hover() {
			return hover;
		},
		set hover(value) {
			hover = value;
		},
		get structureMenu() {
			return structureMenu;
		},
		set structureMenu(value) {
			structureMenu = value;
		},
		get contextMenuEl() {
			return contextMenuEl;
		},
		set contextMenuEl(value) {
			contextMenuEl = value;
		},
		get pointerScreen() {
			return pointerScreen;
		},
		set pointerScreen(value) {
			pointerScreen = value;
		},
		get shiftHeld() {
			return shiftHeld;
		},
		set shiftHeld(value) {
			shiftHeld = value;
		},
		get ctrlHeld() {
			return ctrlHeld;
		},
		set ctrlHeld(value) {
			ctrlHeld = value;
		},
		get cameraView() {
			return cameraView;
		},
		set cameraView(value) {
			cameraView = value;
		},
		get structureMenuCameraView() {
			return structureMenuCameraView;
		},
		set structureMenuCameraView(value) {
			structureMenuCameraView = value;
		},
		get perf() {
			return perf;
		},
		set perf(value) {
			perf = value;
		},
		get eventFeed() {
			return eventFeed;
		},
		set eventFeed(value) {
			eventFeed = value;
		},
		get currentSeed() {
			return currentSeed;
		},
		set currentSeed(value) {
			currentSeed = value;
		},
		get seedInput() {
			return seedInput;
		},
		set seedInput(value) {
			seedInput = value;
		},
		get rankScrollEl() {
			return rankScrollEl;
		},
		set rankScrollEl(value) {
			rankScrollEl = value;
		},
		get rankScrollTop() {
			return rankScrollTop;
		},
		set rankScrollTop(value) {
			rankScrollTop = value;
		},
		get rankViewportHeight() {
			return rankViewportHeight;
		},
		set rankViewportHeight(value) {
			rankViewportHeight = value;
		},
		get handRaised() {
			return handRaised;
		},
		set handRaised(value) {
			handRaised = value;
		},
		get handShellEl() {
			return handShellEl;
		},
		set handShellEl(value) {
			handShellEl = value;
		},
		get matchSettings() {
			return matchSettings;
		},
		set matchSettings(value) {
			matchSettings = value;
		},
		get appliedMatchSettings() {
			return appliedMatchSettings;
		},
		set appliedMatchSettings(value) {
			appliedMatchSettings = value;
		},
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
		get keyboardCursor() {
			return keyboardCursor;
		},
		set keyboardCursor(value) {
			keyboardCursor = value;
		},
		get keyboardCursorScreen() {
			return keyboardCursorScreen;
		},
		set keyboardCursorScreen(value) {
			keyboardCursorScreen = value;
		},
		get keyboardCursorStatus() {
			return keyboardCursorStatus;
		},
		set keyboardCursorStatus(value) {
			keyboardCursorStatus = value;
		},
		get draggingCardId() {
			return draggingCardId;
		},
		set draggingCardId(value) {
			draggingCardId = value;
		},
		get keyboardPlacement() {
			return keyboardPlacement;
		},
		set keyboardPlacement(value) {
			keyboardPlacement = value;
		},
		get dragOrigin() {
			return dragOrigin;
		},
		set dragOrigin(value) {
			dragOrigin = value;
		},
		get dragPointer() {
			return dragPointer;
		},
		set dragPointer(value) {
			dragPointer = value;
		},
		get dragLanding() {
			return dragLanding;
		},
		set dragLanding(value) {
			dragLanding = value;
		},
		get transparentDragImage() {
			return transparentDragImage;
		},
		set transparentDragImage(value) {
			transparentDragImage = value;
		},
		get diplomacyToast() {
			return diplomacyToast;
		},
		set diplomacyToast(value) {
			diplomacyToast = value;
		},
		get humanFronts() {
			return humanFronts;
		},
		set humanFronts(value) {
			humanFronts = value;
		},
		get humanAllyName() {
			return humanAllyName;
		},
		set humanAllyName(value) {
			humanAllyName = value;
		},
		get humanAlliancePending() {
			return humanAlliancePending;
		},
		set humanAlliancePending(value) {
			humanAlliancePending = value;
		},
		get hoverIsAlly() {
			return hoverIsAlly;
		},
		set hoverIsAlly(value) {
			hoverIsAlly = value;
		},
		get keyboardCursorAllied() {
			return keyboardCursorAllied;
		},
		set keyboardCursorAllied(value) {
			keyboardCursorAllied = value;
		},
		get humanArtillery() {
			return humanArtillery;
		},
		set humanArtillery(value) {
			humanArtillery = value;
		},
		get readyArtillery() {
			return readyArtillery;
		},
		set readyArtillery(value) {
			readyArtillery = value;
		},
		get readyArtilleryShells() {
			return readyArtilleryShells;
		},
		set readyArtilleryShells(value) {
			readyArtilleryShells = value;
		},
		get artilleryVolleyCost() {
			return artilleryVolleyCost;
		},
		set artilleryVolleyCost(value) {
			artilleryVolleyCost = value;
		},
		get artilleryTargeting() {
			return artilleryTargeting;
		},
		set artilleryTargeting(value) {
			artilleryTargeting = value;
		},
		get supplyPreview() {
			return supplyPreview;
		},
		set supplyPreview(value) {
			supplyPreview = value;
		},
		get supplyBar() {
			return supplyBar;
		},
		set supplyBar(value) {
			supplyBar = value;
		},
		get upgradeTooltip() {
			return upgradeTooltip;
		},
		set upgradeTooltip(value) {
			upgradeTooltip = value;
		},
		get human() {
			return human;
		},
		set human(value) {
			human = value;
		},
		get humanStructure() {
			return humanStructure;
		},
		set humanStructure(value) {
			humanStructure = value;
		},
		get ranked() {
			return ranked;
		},
		set ranked(value) {
			ranked = value;
		},
		get humanRank() {
			return humanRank;
		},
		set humanRank(value) {
			humanRank = value;
		},
		get rankWindow() {
			return rankWindow;
		},
		set rankWindow(value) {
			rankWindow = value;
		},
		get visibleRanked() {
			return visibleRanked;
		},
		set visibleRanked(value) {
			visibleRanked = value;
		},
		get aliveCount() {
			return aliveCount;
		},
		set aliveCount(value) {
			aliveCount = value;
		},
		get worldClaim() {
			return worldClaim;
		},
		set worldClaim(value) {
			worldClaim = value;
		},
		get winner() {
			return winner;
		},
		set winner(value) {
			winner = value;
		},
		get showResult() {
			return showResult;
		},
		set showResult(value) {
			showResult = value;
		},
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
		},
		get draggingCard() {
			return draggingCard;
		},
		set draggingCard(value) {
			draggingCard = value;
		},
		get dragAccent() {
			return dragAccent;
		},
		set dragAccent(value) {
			dragAccent = value;
		},
		get dragArrow() {
			return dragArrow;
		},
		set dragArrow(value) {
			dragArrow = value;
		},
		get scaleLegend() {
			return scaleLegend;
		},
		set scaleLegend(value) {
			scaleLegend = value;
		}
	};
}

export type GamePageState = ReturnType<typeof createGamePageState>;
