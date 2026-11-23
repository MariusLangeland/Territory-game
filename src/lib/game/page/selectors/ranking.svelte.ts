import type { GameSnapshot } from '#lib/game/simulation';

/** State cells the ranking selectors read. Values must stay as getters while passed in. */
export interface RankingSelectorsDeps {
	readonly snapshot: GameSnapshot | null;
	readonly gameStarted: boolean;
	readonly rankScrollTop: number;
	readonly rankViewportHeight: number;
}

const RANK_ROW_HEIGHT = 28;
const RANK_OVERSCAN = 3;

/**
 * World rank list, virtualization window, and match-result selectors. The
 * row height/overscan constants stay next to the window math they drive.
 */
export function createRankingSelectors(
	deps: RankingSelectorsDeps,
	hud: { readonly human: GameSnapshot['players'][number] | null }
) {
	let ranked = $derived(
		deps.snapshot
			? [...deps.snapshot.players].sort(
					(a, b) => Number(b.alive) - Number(a.alive) || b.territory - a.territory || a.id - b.id
				)
			: []
	);
	let humanRank = $derived.by(() => {
		const human = hud.human;
		if (!human) return 0;
		const humanId = human.id;
		return ranked.findIndex((p) => p.id === humanId) + 1;
	});
	let rankWindow = $derived.by(() => {
		const start = Math.max(0, Math.floor(deps.rankScrollTop / RANK_ROW_HEIGHT) - RANK_OVERSCAN);
		const visibleRows = Math.ceil(deps.rankViewportHeight / RANK_ROW_HEIGHT) + RANK_OVERSCAN * 2;
		return {
			start,
			end: Math.min(ranked.length, start + visibleRows)
		};
	});
	let visibleRanked = $derived(ranked.slice(rankWindow.start, rankWindow.end));
	let aliveCount = $derived(
		deps.snapshot ? deps.snapshot.players.filter((p) => p.alive).length : 0
	);
	let worldClaim = $derived(
		deps.snapshot && deps.snapshot.landCount > 0
			? (deps.snapshot.claimedLand / deps.snapshot.landCount) * 100
			: 0
	);
	let winner = $derived(
		deps.snapshot?.winnerId
			? (deps.snapshot.players.find((player) => player.id === deps.snapshot?.winnerId) ?? null)
			: null
	);
	let showResult = $derived(Boolean(deps.gameStarted && deps.snapshot?.ended));

	return {
		RANK_ROW_HEIGHT,
		RANK_OVERSCAN,
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
		}
	};
}
