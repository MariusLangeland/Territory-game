import type {
	OnlineRoomListEntry,
	OnlineRoomView,
	OnlineSeat
} from '#lib/game/net/online-protocol';
import { GameCameraBridge } from '#lib/game/render/camera-bridge';
import type { GameSnapshot } from '#lib/game/simulation';
import { STRUCTURE_DEFINITIONS, type BuildableStructureType } from '#lib/game/structures';
import type { RemoteSimulationView } from '#lib/game/worker/view';

/** Render delta handed to the canvas until it acknowledges the revision. */
export interface OnlineVisual {
	revision: number;
	tick: number;
	snapshot: GameSnapshot;
	changes: Uint32Array;
	changeCount: number;
	overflow: boolean;
	districtTiles: number[];
}

const DEFAULT_CONFIG = {
	totalStates: 8,
	maxHumans: 8,
	seed: 0,
	botDifficulty: 'standard' as const,
	timerMinutes: 0,
	botCommandPostStacks: 0
};

/**
 * Owns every reactive value rendered by the online page. Controllers mutate
 * these through the getters/setters; keeping the declarations in one
 * `.svelte.ts` module preserves rune reactivity across module boundaries.
 */
export function createOnlinePageState() {
	let displayName = $state('Commander');
	let roomCodeInput = $state('');
	let config = $state({ ...DEFAULT_CONFIG });
	let room = $state<OnlineRoomView | null>(null);
	let roomList = $state<OnlineRoomListEntry[]>([]);
	let playerId = $state(0);
	let token = $state('');
	let status = $state('Create a room or join with a code.');
	let busy = $state(false);
	let connected = $state(false);
	let remoteView = $state<RemoteSimulationView | null>(null);
	let snapshot = $state<GameSnapshot | null>(null);
	let visuals = $state<OnlineVisual[]>([]);
	let shareUrl = $state('');
	let selectedCardId = $state<number | null>(null);
	let artilleryMode = $state(false);
	// Non-reactive session bookkeeping: intent ordering is persisted so a reload
	// can resume the server's sequence validation without resetting it to zero.
	let intentSequence = 0;

	const cameraBridge = new GameCameraBridge();

	const currentPlayer = $derived(
		room && playerId > 0 ? room.seats.find((seat) => seat.playerId === playerId) : undefined
	);
	const isHost = $derived(currentPlayer?.host === true);
	const running = $derived(room?.phase === 'running');
	const completed = $derived(room?.phase === 'completed');
	const humanCards = $derived(snapshot?.hand ?? []);
	const playableCards = $derived(
		humanCards.map((card) => ({
			...card,
			definition: STRUCTURE_DEFINITIONS[card.type as BuildableStructureType],
			cost: STRUCTURE_DEFINITIONS[card.type as BuildableStructureType].cost,
			affordable: (snapshot?.supply ?? 0) >= STRUCTURE_DEFINITIONS[card.type].cost
		}))
	);
	const alivePlayers = $derived(snapshot?.players.filter((player) => player.alive) ?? []);
	const seatSlots = $derived(
		room ? Array.from({ length: room.config.maxHumans }, (_, index) => index) : []
	);
	const supplyLabel = $derived(
		snapshot ? `${Math.floor(snapshot.supply)} / ${Math.floor(snapshot.supplyCap)}` : '—'
	);

	return {
		get displayName() {
			return displayName;
		},
		set displayName(value) {
			displayName = value;
		},
		get roomCodeInput() {
			return roomCodeInput;
		},
		set roomCodeInput(value) {
			roomCodeInput = value;
		},
		get config() {
			return config;
		},
		set config(value) {
			config = value;
		},
		get room() {
			return room;
		},
		set room(value) {
			room = value;
		},
		get roomList() {
			return roomList;
		},
		set roomList(value) {
			roomList = value;
		},
		get playerId() {
			return playerId;
		},
		set playerId(value) {
			playerId = value;
		},
		get token() {
			return token;
		},
		set token(value) {
			token = value;
		},
		get status() {
			return status;
		},
		set status(value) {
			status = value;
		},
		get busy() {
			return busy;
		},
		set busy(value) {
			busy = value;
		},
		get connected() {
			return connected;
		},
		set connected(value) {
			connected = value;
		},
		get remoteView() {
			return remoteView;
		},
		set remoteView(value) {
			remoteView = value;
		},
		get snapshot() {
			return snapshot;
		},
		set snapshot(value) {
			snapshot = value;
		},
		get visuals() {
			return visuals;
		},
		set visuals(value) {
			visuals = value;
		},
		get shareUrl() {
			return shareUrl;
		},
		set shareUrl(value) {
			shareUrl = value;
		},
		get selectedCardId() {
			return selectedCardId;
		},
		set selectedCardId(value) {
			selectedCardId = value;
		},
		get artilleryMode() {
			return artilleryMode;
		},
		set artilleryMode(value) {
			artilleryMode = value;
		},
		get intentSequence() {
			return intentSequence;
		},
		set intentSequence(value) {
			intentSequence = value;
		},
		get currentPlayer(): OnlineSeat | undefined {
			return currentPlayer;
		},
		get isHost() {
			return isHost;
		},
		get running() {
			return running;
		},
		get completed() {
			return completed;
		},
		get humanCards() {
			return humanCards;
		},
		get playableCards() {
			return playableCards;
		},
		get alivePlayers() {
			return alivePlayers;
		},
		get seatSlots() {
			return seatSlots;
		},
		get supplyLabel() {
			return supplyLabel;
		},
		cameraBridge
	};
}

export type OnlinePageState = ReturnType<typeof createOnlinePageState>;
