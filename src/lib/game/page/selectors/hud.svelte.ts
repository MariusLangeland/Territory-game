import { ARTILLERY_SUPPLY_COST_PER_LEVEL, HUMAN_PLAYER_ID } from '#lib/game/constants';
import type { CameraView } from '#lib/game/render/camera-bridge';
import type { GameSnapshot } from '#lib/game/simulation';
import type { WorkerLocalSimulation } from '#lib/game/worker/local-simulation';
import type { HoverState } from './types';

/** State cells the HUD selectors read. Values must stay as getters while passed in. */
export interface HudSelectorsDeps {
	readonly sim: WorkerLocalSimulation | null;
	readonly snapshot: GameSnapshot | null;
	readonly hover: HoverState | null;
	readonly cameraView: CameraView | null;
	readonly pointerScreen: { x: number; y: number } | null;
	readonly draggingCardId: number | null;
	readonly gameStarted: boolean;
	readonly showIntro: boolean;
	readonly showHelp: boolean;
	readonly defeatOpen: boolean;
	readonly paused: boolean;
	readonly shiftHeld: boolean;
	readonly ctrlHeld: boolean;
	readonly artilleryTargeting: boolean;
}

/**
 * Commander/rank/supply/artillery readouts and the upgrade tooltip. Purely
 * derived: every branch is recomputed from the shared page state cells.
 */
export function createHudSelectors(deps: HudSelectorsDeps) {
	let humanFronts = $derived(
		deps.snapshot?.attacks.filter((attack) => attack.attackerId === HUMAN_PLAYER_ID) ?? []
	);
	let humanAllyName = $derived.by(() => {
		const snapshot = deps.snapshot;
		if (!snapshot) return null;
		const alliance = snapshot.alliances.find(
			(entry) => entry.playerA === HUMAN_PLAYER_ID || entry.playerB === HUMAN_PLAYER_ID
		);
		if (!alliance) return null;
		const allyId = alliance.playerA === HUMAN_PLAYER_ID ? alliance.playerB : alliance.playerA;
		return snapshot.players[allyId - 1]?.name ?? `STATE ${allyId}`;
	});
	let humanAlliancePending = $derived(
		deps.snapshot?.allianceProposals.some(
			(proposal) =>
				proposal.fromPlayerId === HUMAN_PLAYER_ID || proposal.toPlayerId === HUMAN_PLAYER_ID
		) ?? false
	);
	let hoverIsAlly = $derived.by(() => {
		const snapshot = deps.snapshot;
		const hover = deps.hover;
		if (!snapshot || !hover?.land || hover.owner <= 0 || hover.owner === snapshot.humanId) {
			return false;
		}
		return snapshot.alliances.some(
			(alliance) =>
				(alliance.playerA === snapshot.humanId && alliance.playerB === hover.owner) ||
				(alliance.playerB === snapshot.humanId && alliance.playerA === hover.owner)
		);
	});
	let humanArtillery = $derived(
		deps.snapshot?.structures.filter(
			(structure) => structure.type === 'artillery' && structure.ownerId === HUMAN_PLAYER_ID
		) ?? []
	);
	let readyArtillery = $derived(
		humanArtillery.filter((structure) => structure.readyAtTick <= (deps.snapshot?.tick ?? 0))
	);
	let readyArtilleryShells = $derived(
		readyArtillery.reduce((total, structure) => total + structure.stacks, 0)
	);
	let artilleryVolleyCost = $derived(readyArtilleryShells * ARTILLERY_SUPPLY_COST_PER_LEVEL);
	let supplyPreview: { label: string; cost: number; affordable: boolean } | null = $derived.by(
		() => {
			const sim = deps.sim;
			const snapshot = deps.snapshot;
			const hover = deps.hover;
			if (
				!sim ||
				!snapshot ||
				!hover?.land ||
				!deps.gameStarted ||
				deps.showIntro ||
				deps.defeatOpen ||
				snapshot.ended ||
				deps.paused
			) {
				return null;
			}
			const x = Math.floor(hover.x);
			const y = Math.floor(hover.y);
			if (deps.artilleryTargeting) {
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
				const levels = deps.shiftHeld ? 5 : 1;
				const quote = sim.getUpgradeQuote(HUMAN_PLAYER_ID, x, y, levels, !deps.ctrlHeld);
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
		const cap = Math.max(1, deps.snapshot?.supplyCap ?? 1);
		const supply = deps.snapshot?.supply ?? 0;
		const fill = Math.max(0, Math.min(100, (supply / cap) * 100));
		const cost = supplyPreview?.cost ?? 0;
		const costWidth = Math.min(fill, (cost / cap) * 100);
		return { cap, supply, fill, costWidth, costStart: fill - costWidth };
	});
	let upgradeTooltip = $derived.by(() => {
		const sim = deps.sim;
		const snapshot = deps.snapshot;
		const hover = deps.hover;
		const pointerScreen = deps.pointerScreen;
		if (
			!sim ||
			!snapshot ||
			!hover?.land ||
			!pointerScreen ||
			!deps.gameStarted ||
			deps.showIntro ||
			deps.showHelp ||
			deps.defeatOpen ||
			snapshot.ended ||
			deps.draggingCardId !== null ||
			deps.artilleryTargeting
		) {
			return null;
		}
		const x = hover.x;
		const y = hover.y;
		if (sim.getOwner(x, y) !== HUMAN_PLAYER_ID) return null;
		if (sim.getDistrictStructureId(x, y) === 0) return null;
		const levels = deps.shiftHeld ? 5 : 1;
		const quote = sim.getUpgradeQuote(HUMAN_PLAYER_ID, x, y, levels, !deps.ctrlHeld);
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
		const snapshot = deps.snapshot;
		if (!snapshot) return null;
		const humanId = snapshot.humanId;
		return snapshot.players.find((player) => player.id === humanId) ?? null;
	});
	let humanStructure = $derived.by(() => {
		const snapshot = deps.snapshot;
		if (!snapshot || !human) return null;
		const humanId = human.id;
		return snapshot.structures.find((structure) => structure.ownerId === humanId) ?? null;
	});
	let scaleLegend = $derived.by(() => {
		const cameraView = deps.cameraView;
		return cameraView ? `${Math.round(100 / cameraView.scale)} px / 100 px` : '—';
	});

	return {
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
		get scaleLegend() {
			return scaleLegend;
		},
		set scaleLegend(value) {
			scaleLegend = value;
		}
	};
}
