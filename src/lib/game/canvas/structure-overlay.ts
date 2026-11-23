import { ARTILLERY_RANGE, colorForPlayer } from '#lib/game/constants';
import { formatSupply } from '#lib/format';
import { STRUCTURE_ACCENTS, type StructureType } from '#lib/game/structures';
import type { MapCamera } from '#lib/game/render/camera';
import type { GameSnapshot } from '#lib/game/simulation';
import type { SimulationView } from '#lib/game/simulation-view';

// Marker radii are screen pixels, deliberately independent of camera scale:
// structures stay the same size on screen as the player zooms.
const STATE_HUMAN_MARKER_RADIUS = 15;
const STATE_BOT_MARKER_RADIUS = 11;
const BUILDABLE_MARKER_RADIUS = 10;
/** Owner-selection ring drawn around the highlighted structures/capital. */
const SELECTION_RING_RADIUS = 11;

/** Everything the transparent structure overlay needs for one frame. */
export interface StructureOverlayFrame {
	camera: MapCamera;
	simulation: SimulationView;
	/** Throttled snapshot used for alliance rings and rival supply banners. */
	snapshot: GameSnapshot | null;
	targeting: boolean;
	humanPlayerId: number;
	mergeDistricts: boolean;
	selectedOwnerId: number | null;
}

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

function drawShield(context: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
	context.beginPath();
	context.moveTo(x, y - radius * 0.72);
	context.lineTo(x + radius * 0.58, y - radius * 0.32);
	context.lineTo(x + radius * 0.42, y + radius * 0.36);
	context.quadraticCurveTo(x, y + radius * 0.78, x - radius * 0.42, y + radius * 0.36);
	context.lineTo(x - radius * 0.58, y - radius * 0.32);
	context.closePath();
	context.stroke();
}

function drawJammer(context: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
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

function drawPort(context: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
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
	y: number,
	humanPlayerId: number
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
 * Allied states get a dashed ring around their capital so the relationship
 * is readable without hovering or opening a menu.
 */
function drawAllianceRings(
	context: CanvasRenderingContext2D,
	snapshot: GameSnapshot | null,
	simulation: SimulationView,
	camera: MapCamera
): void {
	if (!snapshot || snapshot.humanId <= 0) return;
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

/**
 * Supply banners are map-anchored at each rival capital and scaled by
 * territory. Snapshot throttling keeps 50 banners off the per-tick path.
 */
function drawSupplyBanners(
	context: CanvasRenderingContext2D,
	snapshot: GameSnapshot | null,
	simulation: SimulationView,
	camera: MapCamera,
	width: number,
	height: number
): void {
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

/**
 * Draws the transparent 2D overlay above the WebGPU map: structure markers,
 * artillery ranges, shells, naval landings, alliance rings, and supply banners.
 *
 * The overlay canvas is sized to the renderer camera in CSS pixels scaled by
 * devicePixelRatio, exactly like the map canvas, so screen-space marker radii
 * stay constant while zooming.
 */
export class StructureOverlay {
	private context: CanvasRenderingContext2D | null = null;

	constructor(private readonly canvas: HTMLCanvasElement) {}

	draw(frame: StructureOverlayFrame): void {
		const { camera, simulation, snapshot } = frame;
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		const width = Math.max(1, Math.round(camera.width));
		const height = Math.max(1, Math.round(camera.height));
		if (
			this.canvas.width !== Math.round(width * dpr) ||
			this.canvas.height !== Math.round(height * dpr)
		) {
			this.canvas.width = Math.round(width * dpr);
			this.canvas.height = Math.round(height * dpr);
			this.context = null;
		}
		this.context ??= this.canvas.getContext('2d');
		const context = this.context;
		if (!context) return;

		context.setTransform(1, 0, 0, 1, 0, 0);
		context.clearRect(0, 0, this.canvas.width, this.canvas.height);
		context.setTransform(dpr, 0, 0, dpr, 0, 0);

		if (frame.targeting) {
			for (const structure of simulation.structures.forOwner(frame.humanPlayerId)) {
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

		const mergedGroups = frame.mergeDistricts ? simulation.getMergedDistricts() : [];
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
				point.y,
				frame.humanPlayerId
			);
			if (frame.selectedOwnerId && structure.ownerId === frame.selectedOwnerId) {
				context.beginPath();
				context.arc(point.x, point.y, SELECTION_RING_RADIUS, 0, Math.PI * 2);
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
			drawStructureIcon(
				context,
				group.type,
				group.ownerId,
				group.totalStacks,
				point.x,
				point.y,
				frame.humanPlayerId
			);
			if (frame.selectedOwnerId && group.ownerId === frame.selectedOwnerId) {
				context.beginPath();
				context.arc(point.x, point.y, SELECTION_RING_RADIUS, 0, Math.PI * 2);
				context.lineWidth = 1.4;
				context.strokeStyle = '#f3b74d';
				context.stroke();
			}
		}

		if (frame.selectedOwnerId && frame.selectedOwnerId > 0) {
			const capital = simulation.map.starts[frame.selectedOwnerId - 1];
			if (capital) {
				const point = camera.mapToScreen(capital.x + 0.5, capital.y + 0.5);
				const color = colorForPlayer(frame.selectedOwnerId);
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

		drawAllianceRings(context, snapshot, simulation, camera);
		drawSupplyBanners(context, snapshot, simulation, camera, width, height);
	}
}
