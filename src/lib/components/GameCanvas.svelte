<script lang="ts">
	import { onMount } from 'svelte';
	import { ARTILLERY_RANGE, HUMAN_PLAYER_ID, TICK_MS, colorForPlayer } from '#lib/game/constants';
	import { formatSupply } from '#lib/format';
	import type { GameSnapshot, SimEvent, TerritorySimulation } from '#lib/game/simulation';
	import {
		STRUCTURE_ACCENTS,
		STRUCTURE_TYPE_CODES,
		type StructureType
	} from '#lib/game/Structures';
	import { GameCameraBridge } from '#lib/game/render/camera-bridge';
	import { TerritoryRenderer, type RendererFrameStats } from '#lib/game/render/territory-renderer';

	// Marker radii are screen pixels, deliberately independent of camera scale:
	// structures stay the same size on screen as the player zooms.
	const STATE_HUMAN_MARKER_RADIUS = 15;
	const STATE_BOT_MARKER_RADIUS = 11;
	const BUILDABLE_MARKER_RADIUS = 10;

	interface HoverInfo {
		x: number;
		y: number;
		owner: number;
		land: boolean;
		elevation: number;
		baseDefense: number;
		auraDefense: number;
		defense: number;
	}

	interface RemoteVisual {
		revision: number;
		tick: number;
		snapshot: GameSnapshot;
		changes: Uint32Array;
		changeCount: number;
		overflow: boolean;
		districtTiles: number[];
	}

	interface Props {
		simulation: TerritorySimulation;
		paused: boolean;
		/** When false, the simulation is advanced by a worker instead of this frame loop. */
		simulate?: boolean;
		remoteVisuals?: RemoteVisual[];
		onRemoteVisualsApplied?: (revision: number) => void;
		targeting?: boolean;
		/** The pointer is over an allied state; suppress the attack cursor. */
		allyTarget?: boolean;
		/** Seat controlled by this client; defaults to the local human seat. */
		humanPlayerId?: number;
		mergeDistricts?: boolean;
		highlightType?: StructureType | null;
		cameraBridge: GameCameraBridge;
		/** Spectator fast-forward; normal gameplay keeps 1× and the 4-step clamp. */
		speedMultiplier?: number;
		maxStepsPerFrame?: number;
		/** Evolution spectators start with the whole map visible. */
		cameraFocus?: 'human' | 'map';
		onTick?: (snapshot: GameSnapshot, events: SimEvent[]) => void;
		onHover?: (hover: HoverInfo | null) => void;
		onAttack?: (x: number, y: number) => void;
		/** Spectator genome selection: click an occupied cell to select its owner. */
		selectedOwnerId?: number | null;
		onSelectOwner?: (ownerId: number | null) => void;
		onError?: (error: Error) => void;
		onReady?: () => void;
		onPerf?: (stats: RendererFrameStats) => void;
	}

	let {
		simulation,
		paused,
		simulate = true,
		remoteVisuals = [],
		onRemoteVisualsApplied,
		targeting = false,
		allyTarget = false,
		humanPlayerId = HUMAN_PLAYER_ID,
		mergeDistricts = true,
		highlightType = null,
		cameraBridge,
		speedMultiplier = 1,
		maxStepsPerFrame = 4,
		cameraFocus = 'human',
		onTick,
		onHover,
		onAttack,
		selectedOwnerId = null,
		onSelectOwner,
		onError,
		onReady,
		onPerf
	}: Props = $props();

	let canvas: HTMLCanvasElement;
	let structureCanvas: HTMLCanvasElement;
	let renderer: TerritoryRenderer | null = null;
	let dragging = $state(false);
	let pointerActive = false;
	let pointerStartX = 0;
	let pointerStartY = 0;
	let pointerLastX = 0;
	let pointerLastY = 0;
	const activePointers = new Map<number, { x: number; y: number }>();
	let pinchActive = false;
	let pinchDistance = 0;
	let pinchCentreX = 0;
	let pinchCentreY = 0;
	let suppressNextTap = false;
	/** Latest throttled snapshot, used by the 2D supply banners. */
	let lastSnapshot: GameSnapshot | null = null;
	let lastRemoteRevision = -1;

	function applyRemoteVisual(visual: RemoteVisual): void {
		if (!renderer || visual.revision <= lastRemoteRevision) return;
		lastRemoteRevision = visual.revision;
		if (visual.overflow) {
			renderer.syncFromSimulation();
		} else {
			renderer.applyChanges(
				visual.changes,
				visual.changeCount,
				false,
				visual.districtTiles.length > 0,
				visual.districtTiles
			);
		}
		lastSnapshot = visual.snapshot;
	}

	function applyRemoteVisualQueue(): void {
		if (simulate || !renderer || remoteVisuals.length === 0) return;
		let applied = false;
		for (const visual of remoteVisuals) {
			if (visual.revision <= lastRemoteRevision) continue;
			applyRemoteVisual(visual);
			applied = true;
		}
		if (applied) onRemoteVisualsApplied?.(lastRemoteRevision);
	}

	onMount(() => {
		let disposed = false;
		let frameId = 0;
		let lastTime = performance.now();
		let accumulator = 0;
		let lastViewReport = 0;
		let lastPerfReport = 0;
		let lastHoverKey = '';
		let lastHoverAt = 0;
		let lastUiUpdate = 0;
		let structureContext: CanvasRenderingContext2D | null = null;

		function drawStar(
			context: CanvasRenderingContext2D,
			x: number,
			y: number,
			outer: number,
			inner: number
		): void {
			context.beginPath();
			for (let i = 0; i < 10; i++) {
				const radius = i % 2 === 0 ? outer : inner;
				const angle = -Math.PI / 2 + (i * Math.PI) / 5;
				const px = x + Math.cos(angle) * radius;
				const py = y + Math.sin(angle) * radius;
				if (i === 0) context.moveTo(px, py);
				else context.lineTo(px, py);
			}
			context.closePath();
		}

		function drawArtillery(
			context: CanvasRenderingContext2D,
			x: number,
			y: number,
			radius: number
		): void {
			context.beginPath();
			context.moveTo(x - radius * 0.58, y + radius * 0.16);
			context.lineTo(x + radius * 0.46, y - radius * 0.34);
			context.moveTo(x - radius * 0.62, y + radius * 0.42);
			context.lineTo(x + radius * 0.1, y + radius * 0.52);
			context.stroke();
			context.beginPath();
			context.arc(x - radius * 0.28, y + radius * 0.5, radius * 0.2, 0, Math.PI * 2);
			context.arc(x + radius * 0.12, y + radius * 0.5, radius * 0.2, 0, Math.PI * 2);
			context.stroke();
			context.beginPath();
			context.arc(x + radius * 0.44, y - radius * 0.34, radius * 0.18, 0, Math.PI * 2);
			context.stroke();
		}

		function drawCrossedSwords(
			context: CanvasRenderingContext2D,
			x: number,
			y: number,
			radius: number
		): void {
			context.beginPath();
			context.moveTo(x - radius * 0.55, y + radius * 0.55);
			context.lineTo(x + radius * 0.55, y - radius * 0.55);
			context.moveTo(x - radius * 0.55, y - radius * 0.55);
			context.lineTo(x + radius * 0.55, y + radius * 0.55);
			context.stroke();
		}

		function drawShield(
			context: CanvasRenderingContext2D,
			x: number,
			y: number,
			radius: number
		): void {
			context.beginPath();
			context.moveTo(x, y - radius * 0.72);
			context.lineTo(x + radius * 0.58, y - radius * 0.32);
			context.lineTo(x + radius * 0.42, y + radius * 0.36);
			context.quadraticCurveTo(x, y + radius * 0.78, x - radius * 0.42, y + radius * 0.36);
			context.lineTo(x - radius * 0.58, y - radius * 0.32);
			context.closePath();
			context.stroke();
		}

		function drawJammer(
			context: CanvasRenderingContext2D,
			x: number,
			y: number,
			radius: number
		): void {
			context.beginPath();
			context.arc(x, y + radius * 0.45, radius * 0.16, 0, Math.PI * 2);
			context.fill();
			for (let ring = 0; ring < 3; ring++) {
				context.beginPath();
				context.arc(
					x,
					y + radius * 0.45,
					radius * (0.34 + ring * 0.22),
					-Math.PI * 0.82,
					-Math.PI * 0.18
				);
				context.stroke();
			}
			context.beginPath();
			context.moveTo(x, y + radius * 0.28);
			context.lineTo(x, y - radius * 0.5);
			context.stroke();
		}

		function drawCommandPost(
			context: CanvasRenderingContext2D,
			x: number,
			y: number,
			radius: number
		): void {
			context.beginPath();
			context.moveTo(x, y + radius * 0.65);
			context.lineTo(x, y - radius * 0.55);
			context.moveTo(x - radius * 0.45, y + radius * 0.65);
			context.lineTo(x + radius * 0.45, y + radius * 0.65);
			context.stroke();
			context.beginPath();
			context.arc(x, y - radius * 0.1, radius * 0.42, -Math.PI * 0.8, -Math.PI * 0.2);
			context.stroke();
		}

		function drawWarAcademy(
			context: CanvasRenderingContext2D,
			x: number,
			y: number,
			radius: number
		): void {
			context.beginPath();
			context.moveTo(x, y - radius * 0.7);
			context.lineTo(x + radius * 0.65, y - radius * 0.3);
			context.lineTo(x, y + radius * 0.1);
			context.lineTo(x - radius * 0.65, y - radius * 0.3);
			context.closePath();
			context.moveTo(x - radius * 0.55, y + radius * 0.18);
			context.lineTo(x, y + radius * 0.48);
			context.lineTo(x + radius * 0.55, y + radius * 0.18);
			context.stroke();
		}

		function drawPort(
			context: CanvasRenderingContext2D,
			x: number,
			y: number,
			radius: number
		): void {
			context.beginPath();
			context.arc(x, y - radius * 0.55, radius * 0.16, 0, Math.PI * 2);
			context.stroke();
			context.beginPath();
			context.moveTo(x, y - radius * 0.4);
			context.lineTo(x, y + radius * 0.55);
			context.moveTo(x - radius * 0.5, y - radius * 0.08);
			context.lineTo(x + radius * 0.5, y - radius * 0.08);
			context.moveTo(x - radius * 0.62, y + radius * 0.18);
			context.quadraticCurveTo(x, y + radius * 0.82, x + radius * 0.62, y + radius * 0.18);
			context.stroke();
		}

		function drawStructureIcon(
			context: CanvasRenderingContext2D,
			type: StructureType,
			ownerId: number,
			stacks: number,
			x: number,
			y: number
		): void {
			const human = ownerId === humanPlayerId;
			const isState = type === 'state';
			const radius = isState
				? human
					? STATE_HUMAN_MARKER_RADIUS
					: STATE_BOT_MARKER_RADIUS
				: BUILDABLE_MARKER_RADIUS;
			const ownerColor = colorForPlayer(ownerId);
			const accent = STRUCTURE_ACCENTS[type];

			// A dark halo keeps every structure readable over bright terrain and
			// territory colors. State keeps the owner-colored disc; buildables use
			// a dark badge with an owner ring so their type icon stays legible.
			context.beginPath();
			context.arc(x, y, radius + 4, 0, Math.PI * 2);
			context.fillStyle = 'rgba(2, 8, 12, 0.42)';
			context.fill();
			context.beginPath();
			context.arc(x, y, radius + 2, 0, Math.PI * 2);
			context.fillStyle = 'rgba(4, 12, 16, 0.92)';
			context.fill();

			context.beginPath();
			context.arc(x, y, radius, 0, Math.PI * 2);
			context.fillStyle = isState ? ownerColor.hex : 'rgba(5, 15, 20, 0.96)';
			context.fill();
			context.lineWidth = isState ? (human ? 2.4 : 2) : 2.6;
			context.strokeStyle = isState ? 'rgba(252, 246, 225, 0.96)' : ownerColor.hex;
			context.stroke();

			if (human && isState) {
				context.beginPath();
				context.arc(x, y, radius + 5.5, 0, Math.PI * 2);
				context.lineWidth = 1.4;
				context.strokeStyle = 'rgba(252, 246, 225, 0.34)';
				context.stroke();
			}

			context.strokeStyle = isState ? 'rgba(255, 248, 225, 0.98)' : accent;
			context.lineWidth = isState ? 1.8 : 2.1;
			context.lineCap = 'round';
			context.lineJoin = 'round';
			if (type === 'state') {
				drawStar(context, x, y, radius * 0.58, radius * 0.24);
				context.fillStyle = 'rgba(255, 248, 225, 0.98)';
				context.fill();
				context.lineWidth = 1;
				context.strokeStyle = 'rgba(5, 14, 18, 0.88)';
				context.stroke();
			} else if (type === 'artillery') {
				drawArtillery(context, x, y, radius);
			} else if (type === 'barracks') {
				drawCrossedSwords(context, x, y, radius);
			} else if (type === 'fortification') {
				drawShield(context, x, y, radius);
			} else if (type === 'jammer') {
				drawJammer(context, x, y, radius);
			} else if (type === 'command-post') {
				drawCommandPost(context, x, y, radius);
			} else if (type === 'port') {
				drawPort(context, x, y, radius);
			} else {
				drawWarAcademy(context, x, y, radius);
			}

			if (stacks > 1) {
				const badgeX = x + radius * 0.78;
				const badgeY = y + radius * 0.78;
				context.beginPath();
				context.arc(badgeX, badgeY, 6.5, 0, Math.PI * 2);
				context.fillStyle = 'rgba(5, 14, 18, 0.96)';
				context.fill();
				context.lineWidth = 1;
				context.strokeStyle = accent;
				context.stroke();
				context.fillStyle = '#fff7df';
				context.font = '600 8px ui-monospace, monospace';
				context.textAlign = 'center';
				context.textBaseline = 'middle';
				context.fillText(String(stacks), badgeX, badgeY + 0.5);
			}
		}

		/**
		 * Supply banners are map-anchored at each rival capital and scaled by
		 * territory. Snapshot throttling keeps 50 banners off the per-tick path.
		 */
		/**
		 * Allied states get a dashed ring around their capital so the relationship
		 * is readable without hovering or opening a menu.
		 */
		function drawAllianceRings(context: CanvasRenderingContext2D): void {
			const snapshot = lastSnapshot;
			const camera = renderer?.camera;
			if (!snapshot || !camera || snapshot.humanId <= 0) return;
			const allies = new Set<number>();
			for (const alliance of snapshot.alliances) {
				if (alliance.playerA === snapshot.humanId) allies.add(alliance.playerB);
				if (alliance.playerB === snapshot.humanId) allies.add(alliance.playerA);
			}
			if (allies.size === 0) return;
			for (const playerId of allies) {
				const capital =
					simulation.structures.all.find(
						(structure) => structure.type === 'state' && structure.ownerId === playerId
					) ?? simulation.map.starts[playerId - 1];
				if (!capital) continue;
				const point = camera.mapToScreen(capital.x + 0.5, capital.y + 0.5);
				context.save();
				context.beginPath();
				context.arc(point.x, point.y, STATE_BOT_MARKER_RADIUS + 8, 0, Math.PI * 2);
				context.setLineDash([4, 3]);
				context.lineWidth = 2;
				context.strokeStyle = colorForPlayer(playerId).hex;
				context.globalAlpha = 0.9;
				context.stroke();
				context.globalAlpha = 0.35;
				context.beginPath();
				context.arc(point.x, point.y, STATE_BOT_MARKER_RADIUS + 11, 0, Math.PI * 2);
				context.lineWidth = 1;
				context.stroke();
				context.restore();
			}
		}

		function drawSupplyBanners(
			context: CanvasRenderingContext2D,
			width: number,
			height: number
		): void {
			const snapshot = lastSnapshot;
			if (!snapshot) return;
			const capitalByOwner = new Map<number, { x: number; y: number }>();
			for (const structure of snapshot.structures) {
				if (structure.type === 'state') {
					capitalByOwner.set(structure.ownerId, { x: structure.x, y: structure.y });
				}
			}
			const rivals = snapshot.players.filter(
				(player) => player.alive && player.id !== snapshot.humanId && player.territory > 0
			);
			if (rivals.length === 0) return;
			const maxTerritory = Math.max(1, ...rivals.map((player) => player.territory));
			// Smaller states first so the largest banners win overlap.
			rivals.sort((left, right) => left.territory - right.territory);

			const camera = renderer?.camera;
			if (!camera) return;
			for (const player of rivals) {
				const capital = capitalByOwner.get(player.id) ?? simulation.map.starts[player.id - 1];
				if (!capital) continue;
				const point = camera.mapToScreen(capital.x + 0.5, capital.y + 0.5);
				if (point.x < -80 || point.y < -80 || point.x > width + 80 || point.y > height + 80) {
					continue;
				}

				// The banner must fit inside the state's on-screen footprint. At
				// overview zoom a state is only a few pixels wide, so hide its
				// banner instead of letting text cover the map.
				const territoryRadiusPx = Math.sqrt(player.territory / Math.PI) * camera.scale;
				// Stay inside the state footprint even for irregular territory:
				// half its equivalent radius for width, most of it for height.
				const maxBannerWidth = territoryRadiusPx * 1.05;
				const maxBannerHeight = territoryRadiusPx * 0.75;
				if (maxBannerWidth < 26 || maxBannerHeight < 16) continue;

				const sizeRatio = Math.sqrt(player.territory / maxTerritory);
				let scale = 0.75 + sizeRatio;
				const supplyText = formatSupply(player.supply);
				const attackText = `${player.attacksAffordable} ATK`;
				const allied = snapshot.alliances.some(
					(alliance) =>
						(alliance.playerA === snapshot.humanId && alliance.playerB === player.id) ||
						(alliance.playerB === snapshot.humanId && alliance.playerA === player.id)
				);
				const pending = snapshot.allianceProposals.some(
					(proposal) =>
						(proposal.fromPlayerId === snapshot.humanId && proposal.toPlayerId === player.id) ||
						(proposal.toPlayerId === snapshot.humanId && proposal.fromPlayerId === player.id)
				);
				const nameText = `${player.name}${allied ? ' · ALLY' : pending ? ' · PENDING' : ''}`;
				const accent = colorForPlayer(player.id).hex;
				const measure = (fontScale: number) => {
					const supplySize = Math.max(1, Math.round(17 * fontScale));
					const attackSize = Math.max(1, Math.round(9 * fontScale));
					const nameSize = Math.max(1, Math.round(8 * fontScale));
					const padding = 6 * fontScale;
					const gap = 4 * fontScale;
					context.font = `800 ${supplySize}px ui-monospace, monospace`;
					const supplyWidth = context.measureText(supplyText).width;
					context.font = `800 ${attackSize}px ui-monospace, monospace`;
					const attackWidth = context.measureText(attackText).width;
					context.font = `700 ${nameSize}px ui-monospace, monospace`;
					const nameWidth = context.measureText(nameText).width;
					const lineWidth = supplyWidth + gap + attackWidth;
					return {
						supplySize,
						attackSize,
						nameSize,
						padding,
						gap,
						supplyWidth,
						lineWidth,
						width: Math.ceil(Math.max(lineWidth, nameWidth) + padding * 2),
						height: Math.ceil(nameSize + supplySize + padding * 2)
					};
				};
				let metrics = measure(scale);
				const fit = Math.min(1, maxBannerWidth / metrics.width, maxBannerHeight / metrics.height);
				// Below this the text is not legible; the state boundary is too
				// small to carry a banner at the current zoom.
				if (fit < 0.72) continue;
				scale *= fit;
				metrics = measure(scale);
				if (metrics.width > maxBannerWidth || metrics.height > maxBannerHeight) continue;

				const bannerX = Math.round(
					Math.min(Math.max(4, point.x - metrics.width / 2), width - metrics.width - 4)
				);
				const bannerY = Math.round(
					Math.max(4, Math.min(point.y - 18 - metrics.height, height - metrics.height - 4))
				);

				// A dark translucent plate keeps the name/supply/affordable-front
				// text legible over bright or busy territory.
				context.beginPath();
				context.roundRect(bannerX, bannerY, metrics.width, metrics.height, Math.max(2, 3 * scale));
				context.fillStyle = 'rgba(3, 10, 14, 0.72)';
				context.fill();

				// A faint stem anchors the text to the capital marker.
				context.beginPath();
				context.moveTo(bannerX + metrics.width / 2, bannerY + metrics.height);
				context.lineTo(point.x, point.y - 12);
				context.lineWidth = 1;
				context.strokeStyle = accent;
				context.globalAlpha = 0.35;
				context.stroke();
				context.globalAlpha = 1;

				// No plaque and no border: legibility comes from a text shadow
				// instead of an opaque box that would occlude the map.
				context.save();
				context.shadowColor = 'rgba(0, 0, 0, 0.92)';
				context.shadowBlur = Math.max(2, 2 * scale);
				context.shadowOffsetY = 1;
				context.textAlign = 'center';

				context.textBaseline = 'top';
				context.font = `700 ${metrics.nameSize}px ui-monospace, monospace`;
				context.fillStyle = accent;
				context.fillText(nameText, bannerX + metrics.width / 2, bannerY + metrics.padding * 0.5);

				context.textBaseline = 'middle';
				context.textAlign = 'left';
				const lineY = bannerY + metrics.height - metrics.padding - metrics.supplySize / 2;
				const lineX = bannerX + (metrics.width - metrics.lineWidth) / 2;
				context.font = `800 ${metrics.supplySize}px ui-monospace, monospace`;
				context.fillStyle = '#fff7df';
				context.fillText(supplyText, lineX, lineY);
				context.font = `800 ${metrics.attackSize}px ui-monospace, monospace`;
				context.fillStyle = accent;
				context.fillText(attackText, lineX + metrics.supplyWidth + metrics.gap, lineY);
				context.restore();
			}
		}

		function drawStructures(): void {
			if (!renderer || !structureCanvas) return;
			const camera = renderer.camera;
			const dpr = Math.min(window.devicePixelRatio || 1, 2);
			const width = Math.max(1, Math.round(camera.width));
			const height = Math.max(1, Math.round(camera.height));
			if (
				structureCanvas.width !== Math.round(width * dpr) ||
				structureCanvas.height !== Math.round(height * dpr)
			) {
				structureCanvas.width = Math.round(width * dpr);
				structureCanvas.height = Math.round(height * dpr);
				structureContext = null;
			}
			structureContext ??= structureCanvas.getContext('2d');
			const context = structureContext;
			if (!context) return;

			context.setTransform(1, 0, 0, 1, 0, 0);
			context.clearRect(0, 0, structureCanvas.width, structureCanvas.height);
			context.setTransform(dpr, 0, 0, dpr, 0, 0);

			if (targeting) {
				for (const structure of simulation.structures.forOwner(humanPlayerId)) {
					if (structure.type !== 'artillery') continue;
					const center = camera.mapToScreen(structure.x + 0.5, structure.y + 0.5);
					const edge = camera.mapToScreen(structure.x + 0.5 + ARTILLERY_RANGE, structure.y + 0.5);
					const screenRadius = Math.abs(edge.x - center.x);
					context.beginPath();
					context.arc(center.x, center.y, screenRadius, 0, Math.PI * 2);
					context.fillStyle = 'rgba(255, 155, 90, 0.035)';
					context.fill();
					context.lineWidth = 1;
					context.strokeStyle = 'rgba(255, 155, 90, 0.28)';
					context.setLineDash([4, 6]);
					context.stroke();
					context.setLineDash([]);
				}
			}

			const mergedGroups = mergeDistricts ? simulation.getMergedDistricts() : [];
			const mergedIds = new Set<number>();
			for (const group of mergedGroups) {
				if (group.structureIds.length < 2) continue;
				for (const structureId of group.structureIds) mergedIds.add(structureId);
			}

			for (const structure of simulation.structures.all) {
				if (mergedIds.has(structure.id)) continue;
				const point = camera.mapToScreen(structure.x + 0.5, structure.y + 0.5);
				if (point.x < -18 || point.y < -18 || point.x > width + 18 || point.y > height + 18) {
					continue;
				}
				drawStructureIcon(
					context,
					structure.type,
					structure.ownerId,
					structure.stacks,
					point.x,
					point.y
				);
				if (selectedOwnerId && structure.ownerId === selectedOwnerId) {
					context.beginPath();
					context.arc(point.x, point.y, 11, 0, Math.PI * 2);
					context.lineWidth = 1.4;
					context.strokeStyle = '#f3b74d';
					context.stroke();
				}
			}

			for (const group of mergedGroups) {
				if (group.structureIds.length < 2 || group.totalStacks <= 0) continue;
				const point = camera.mapToScreen(group.centerX + 0.5, group.centerY + 0.5);
				if (point.x < -18 || point.y < -18 || point.x > width + 18 || point.y > height + 18) {
					continue;
				}
				drawStructureIcon(context, group.type, group.ownerId, group.totalStacks, point.x, point.y);
				if (selectedOwnerId && group.ownerId === selectedOwnerId) {
					context.beginPath();
					context.arc(point.x, point.y, 11, 0, Math.PI * 2);
					context.lineWidth = 1.4;
					context.strokeStyle = '#f3b74d';
					context.stroke();
				}
			}

			if (selectedOwnerId && selectedOwnerId > 0) {
				const capital = simulation.map.starts[selectedOwnerId - 1];
				if (capital) {
					const point = camera.mapToScreen(capital.x + 0.5, capital.y + 0.5);
					const color = colorForPlayer(selectedOwnerId);
					context.beginPath();
					context.arc(point.x, point.y, 20, 0, Math.PI * 2);
					context.lineWidth = 2;
					context.strokeStyle = '#f3b74d';
					context.stroke();
					context.beginPath();
					context.arc(point.x, point.y, 14, 0, Math.PI * 2);
					context.lineWidth = 1;
					context.strokeStyle = color.hex;
					context.stroke();
				}
			}

			for (const shell of simulation.activeShells) {
				const span = Math.max(1, shell.arriveAtTick - shell.launchedAtTick);
				const progress = Math.max(0, Math.min(1, (simulation.tick - shell.launchedAtTick) / span));
				const trailProgress = Math.max(0, progress - Math.min(0.35, 7 / span));
				const x = shell.fromX + (shell.targetX - shell.fromX) * progress + 0.5;
				const y = shell.fromY + (shell.targetY - shell.fromY) * progress + 0.5;
				const trailX = shell.fromX + (shell.targetX - shell.fromX) * trailProgress + 0.5;
				const trailY = shell.fromY + (shell.targetY - shell.fromY) * trailProgress + 0.5;
				const point = camera.mapToScreen(x, y);
				const trail = camera.mapToScreen(trailX, trailY);
				const ownerColor = colorForPlayer(shell.ownerId);
				context.beginPath();
				context.moveTo(trail.x, trail.y);
				context.lineTo(point.x, point.y);
				context.lineWidth = 2.2;
				context.strokeStyle = 'rgba(255, 190, 120, 0.55)';
				context.stroke();
				context.beginPath();
				context.arc(point.x, point.y, 4.4, 0, Math.PI * 2);
				context.fillStyle = '#ffd9a2';
				context.fill();
				context.lineWidth = 1.2;
				context.strokeStyle = ownerColor.hex;
				context.stroke();
			}

			for (const landing of simulation.activeNavalLandings) {
				if (landing.path.length === 0) continue;
				const scaled = landing.progress * (landing.path.length - 1);
				const fromSlot = Math.max(0, Math.min(landing.path.length - 1, Math.floor(scaled)));
				const toSlot = Math.min(landing.path.length - 1, fromSlot + 1);
				const t = scaled - fromSlot;
				const fromIndex = landing.path[fromSlot] ?? landing.path[0] ?? 0;
				const toIndex = landing.path[toSlot] ?? fromIndex;
				const fromX = (fromIndex % simulation.width) + 0.5;
				const fromY = Math.floor(fromIndex / simulation.width) + 0.5;
				const toX = (toIndex % simulation.width) + 0.5;
				const toY = Math.floor(toIndex / simulation.width) + 0.5;
				const point = camera.mapToScreen(fromX + (toX - fromX) * t, fromY + (toY - fromY) * t);
				if (point.x < -20 || point.y < -20 || point.x > width + 20 || point.y > height + 20) {
					continue;
				}
				const ownerColor = colorForPlayer(landing.ownerId);
				const angle = Math.atan2(toY - fromY, toX - fromX);
				context.save();
				context.translate(point.x, point.y);
				context.rotate(angle);
				context.beginPath();
				context.moveTo(8, 0);
				context.lineTo(-5, 4.5);
				context.lineTo(-2, 0);
				context.lineTo(-5, -4.5);
				context.closePath();
				context.fillStyle = '#f7eed0';
				context.fill();
				context.lineWidth = 1.4;
				context.strokeStyle = ownerColor.hex;
				context.stroke();
				context.restore();
				context.beginPath();
				context.moveTo(point.x - Math.cos(angle) * 8, point.y - Math.sin(angle) * 8);
				context.lineTo(point.x - Math.cos(angle) * 18, point.y - Math.sin(angle) * 18);
				context.lineWidth = 2;
				context.strokeStyle = 'rgba(160, 220, 235, 0.35)';
				context.stroke();
			}

			drawAllianceRings(context);
			drawSupplyBanners(context, width, height);
		}

		function frame(now: number): void {
			if (disposed || !renderer) return;
			// Apply every queued worker delta in order. The worker only sends one
			// visual at a time and waits for the acknowledgement below, so a frame
			// cannot silently skip a delta and leave the control texture stale.
			applyRemoteVisualQueue();
			const delta = Math.min(250, Math.max(0, now - lastTime));
			lastTime = now;

			// At 1000× the fast-forward loop can execute a thousand ticks between
			// useful visual updates. Applying every tick's renderer delta dominates
			// the frame; instead resync the whole control texture once per 1000
			// ticks and let the renderer upload it in chunks.
			if (!simulate) {
				accumulator = 0;
			} else if (paused || simulation.ended) {
				accumulator = 0;
			} else {
				accumulator += delta * speedMultiplier;
				let steps = 0;
				let latestSnapshot: GameSnapshot | null = null;
				const pendingEvents: SimEvent[] = [];

				while (accumulator >= TICK_MS && steps < maxStepsPerFrame && !simulation.ended) {
					const result = simulation.step();
					renderer.applyChanges(
						result.changes,
						result.changeCount,
						result.changesOverflow,
						result.districtsChanged,
						result.districtTiles
					);
					latestSnapshot = result.snapshot;
					pendingEvents.push(...result.events);
					accumulator -= TICK_MS;
					steps++;
				}
				if (steps >= maxStepsPerFrame) accumulator = 0;

				// Territory rendering updates every tick, but rebuilding 51 HUD
				// rows at 10 Hz creates avoidable main-thread spikes. Snapshots go
				// to Svelte at 5 Hz, or immediately on elimination/victory events.
				if (
					latestSnapshot &&
					(now - lastUiUpdate >= 200 || pendingEvents.length > 0 || latestSnapshot.ended)
				) {
					lastUiUpdate = now;
					lastSnapshot = latestSnapshot;
					onTick?.(latestSnapshot, pendingEvents);
				}
			}

			renderer.mergeDistrictSeams = mergeDistricts;
			renderer.highlightDistrictCode = highlightType
				? STRUCTURE_TYPE_CODES[highlightType] * 4 - 3
				: 0;
			renderer.highlightDistrictOwner = highlightType ? humanPlayerId : 0;
			renderer.render(now);
			drawStructures();

			if (now - lastViewReport > 140) {
				cameraBridge.report();
				lastViewReport = now;
			}
			if (now - lastPerfReport > 1000) {
				onPerf?.({ ...renderer.stats });
				lastPerfReport = now;
			}

			frameId = requestAnimationFrame(frame);
		}

		async function initialize(): Promise<void> {
			try {
				renderer = await TerritoryRenderer.create(canvas, simulation);
				if (disposed) {
					renderer.destroy();
					renderer = null;
					return;
				}

				applyRemoteVisualQueue();

				const camera = renderer.camera;
				const humanStart = simulation.map.starts[humanPlayerId - 1];
				if (cameraFocus === 'map') {
					camera.focusOn(simulation.width / 2, simulation.height / 2, 1);
				} else {
					camera.focusOn(humanStart.x, humanStart.y, 3.8);
				}

				renderer.onDeviceLost = (message) => {
					onError?.(new Error(message));
				};

				cameraBridge.attach({
					zoomIn: () => camera.zoomAt(camera.width / 2, camera.height / 2, 1.32),
					zoomOut: () => camera.zoomAt(camera.width / 2, camera.height / 2, 1 / 1.32),
					fitMap: () => camera.focusOn(simulation.width / 2, simulation.height / 2, 1),
					focusHuman: () => camera.focusOn(humanStart.x, humanStart.y, 3.8),
					centerOn: (x, y, zoom) => {
						if (zoom === undefined) camera.centerOn(x, y);
						else camera.focusOn(x, y, zoom);
					},
					getView: () => ({
						centerX: camera.centerX,
						centerY: camera.centerY,
						zoom: camera.zoom,
						scale: camera.scale,
						viewportWidth: camera.width,
						viewportHeight: camera.height,
						mapWidth: simulation.width,
						mapHeight: simulation.height
					})
				});

				onReady?.();
				lastSnapshot = simulation.getSnapshot();
				onTick?.(lastSnapshot, []);
				lastTime = performance.now();
				frameId = requestAnimationFrame(frame);
			} catch (error) {
				const reason = error instanceof Error ? error : new Error(String(error));
				onError?.(reason);
			}
		}

		function localHover(clientX: number, clientY: number): void {
			if (!renderer) return;
			const rect = canvas.getBoundingClientRect();
			const screenX = clientX - rect.left;
			const screenY = clientY - rect.top;
			const point = renderer.camera.screenToMap(screenX, screenY);
			const x = Math.floor(point.x);
			const y = Math.floor(point.y);
			if (x < 0 || y < 0 || x >= simulation.width || y >= simulation.height) {
				renderer.hover = null;
				if (lastHoverKey !== 'none') {
					lastHoverKey = 'none';
					onHover?.(null);
				}
				return;
			}

			renderer.hover = { x, y };
			const now = performance.now();
			const owner = simulation.getOwner(x, y);
			const land = simulation.isLand(x, y);
			const elevation = simulation.getElevation(x, y);
			const baseDefense = simulation.getBaseDefense(x, y);
			const auraDefense = simulation.getAuraDefense(x, y);
			const defense = simulation.getDefense(x, y);
			const key = `${x}:${y}:${owner}:${land}:${auraDefense}:${defense}`;
			if (now - lastHoverAt > 85 && key !== lastHoverKey) {
				lastHoverAt = now;
				lastHoverKey = key;
				onHover?.({ x, y, owner, land, elevation, baseDefense, auraDefense, defense });
			}
		}

		function pinchGeometry(): { distance: number; x: number; y: number } | null {
			const points = [...activePointers.values()];
			if (points.length < 2) return null;
			const [a, b] = points;
			const dx = b.x - a.x;
			const dy = b.y - a.y;
			return {
				distance: Math.hypot(dx, dy),
				x: (a.x + b.x) / 2,
				y: (a.y + b.y) / 2
			};
		}

		function handlePointerDown(event: PointerEvent): void {
			if ((event.pointerType === 'mouse' && event.button !== 0) || !renderer) return;
			activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
			canvas.setPointerCapture(event.pointerId);

			if (activePointers.size === 2) {
				const geometry = pinchGeometry();
				if (geometry) {
					pinchActive = true;
					suppressNextTap = true;
					pointerActive = false;
					dragging = false;
					pinchDistance = geometry.distance;
					pinchCentreX = geometry.x;
					pinchCentreY = geometry.y;
				}
				return;
			}
			if (activePointers.size > 2) return;

			pointerActive = true;
			dragging = false;
			pointerStartX = event.clientX;
			pointerStartY = event.clientY;
			pointerLastX = event.clientX;
			pointerLastY = event.clientY;
			localHover(event.clientX, event.clientY);
		}

		function handlePointerMove(event: PointerEvent): void {
			if (!renderer) return;
			if (activePointers.has(event.pointerId)) {
				activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
			}

			if (pinchActive) {
				const geometry = pinchGeometry();
				if (geometry && pinchDistance > 0) {
					const rect = canvas.getBoundingClientRect();
					const ratio = Math.max(0.5, Math.min(2, geometry.distance / pinchDistance));
					renderer.camera.zoomAt(geometry.x - rect.left, geometry.y - rect.top, ratio);
					renderer.camera.panBy(geometry.x - pinchCentreX, geometry.y - pinchCentreY);
					pinchDistance = geometry.distance;
					pinchCentreX = geometry.x;
					pinchCentreY = geometry.y;
					cameraBridge.report();
				}
				return;
			}

			localHover(event.clientX, event.clientY);
			if (!pointerActive) return;

			const dx = event.clientX - pointerLastX;
			const dy = event.clientY - pointerLastY;
			pointerLastX = event.clientX;
			pointerLastY = event.clientY;

			if (!dragging) {
				const totalX = event.clientX - pointerStartX;
				const totalY = event.clientY - pointerStartY;
				if (totalX * totalX + totalY * totalY > 16) dragging = true;
			}

			if (dragging) renderer.camera.panBy(dx, dy);
		}

		function handlePointerUp(event: PointerEvent): void {
			if (!renderer) return;
			const wasPinching = pinchActive;
			activePointers.delete(event.pointerId);

			if (wasPinching) {
				pinchActive = false;
				pointerActive = false;
				dragging = false;
				const remaining = pinchGeometry();
				if (remaining) {
					pinchDistance = remaining.distance;
					pinchCentreX = remaining.x;
					pinchCentreY = remaining.y;
					pinchActive = true;
				}
			} else if (pointerActive && !dragging && !suppressNextTap) {
				const rect = canvas.getBoundingClientRect();
				const point = renderer.camera.screenToMap(
					event.clientX - rect.left,
					event.clientY - rect.top
				);
				const x = Math.floor(point.x);
				const y = Math.floor(point.y);
				if (onSelectOwner) {
					const owner =
						x >= 0 && y >= 0 && x < simulation.width && y < simulation.height
							? (simulation.owners[y * simulation.width + x] ?? 0)
							: 0;
					onSelectOwner(owner > 0 ? owner : null);
				} else {
					onAttack?.(x, y);
				}
			}

			if (activePointers.size === 0) suppressNextTap = false;
			pointerActive = false;
			dragging = false;
			if (canvas.hasPointerCapture(event.pointerId)) {
				canvas.releasePointerCapture(event.pointerId);
			}
			localHover(event.clientX, event.clientY);
		}

		function handlePointerLeave(): void {
			if (!renderer || pointerActive) return;
			renderer.hover = null;
			if (lastHoverKey !== 'none') {
				lastHoverKey = 'none';
				onHover?.(null);
			}
		}

		function handleWheel(event: WheelEvent): void {
			if (!renderer) return;
			event.preventDefault();
			const rect = canvas.getBoundingClientRect();
			const factor = Math.exp(-event.deltaY * 0.00135);
			renderer.camera.zoomAt(event.clientX - rect.left, event.clientY - rect.top, factor);
			cameraBridge.report();
			localHover(event.clientX, event.clientY);
		}

		// Pointer capture needs a listener with an explicit non-passive wheel.
		canvas.addEventListener('pointerdown', handlePointerDown);
		canvas.addEventListener('pointermove', handlePointerMove);
		canvas.addEventListener('pointerup', handlePointerUp);
		canvas.addEventListener('pointercancel', handlePointerUp);
		canvas.addEventListener('pointerleave', handlePointerLeave);
		canvas.addEventListener('wheel', handleWheel, { passive: false });

		void initialize();

		return () => {
			disposed = true;
			cancelAnimationFrame(frameId);
			cameraBridge.detach();
			renderer?.destroy();
			renderer = null;
			canvas.removeEventListener('pointerdown', handlePointerDown);
			canvas.removeEventListener('pointermove', handlePointerMove);
			canvas.removeEventListener('pointerup', handlePointerUp);
			canvas.removeEventListener('pointercancel', handlePointerUp);
			canvas.removeEventListener('pointerleave', handlePointerLeave);
			canvas.removeEventListener('wheel', handleWheel);
		};
	});
</script>

<canvas
	bind:this={canvas}
	class:grabbing={dragging}
	class="territory-canvas"
	class:targeting
	class:ally-target={allyTarget && !targeting}
	aria-label={targeting
		? 'Artillery targeting. Click a hostile structure near the aim point to fire.'
		: 'Territory map. Drag to pan, scroll to zoom, click to attack.'}
></canvas>

<canvas bind:this={structureCanvas} class="structure-canvas" aria-hidden="true"></canvas>

<style>
	.territory-canvas {
		position: absolute;
		inset: 0;
		display: block;
		width: 100%;
		height: 100%;
		touch-action: none;
		cursor: crosshair;
		outline: none;
	}

	.territory-canvas.targeting {
		cursor: cell;
	}

	.territory-canvas.ally-target {
		cursor: not-allowed;
	}

	.territory-canvas.grabbing {
		cursor: grabbing;
	}

	.structure-canvas {
		position: absolute;
		inset: 0;
		display: block;
		width: 100%;
		height: 100%;
		pointer-events: none;
	}
</style>
