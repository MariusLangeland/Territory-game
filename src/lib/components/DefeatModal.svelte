<script lang="ts">
	import type { PublicPlayer } from '#lib/game/simulation';

	interface Props {
		human: PublicPlayer;
		tick: number;
		matchClock: string;
		humanRank: number;
		aliveCount: number;
		onSpectate: () => void;
		onRematch: () => void;
		onNewWorld: () => void;
	}
	let { human, tick, matchClock, humanRank, aliveCount, onSpectate, onRematch, onNewWorld }: Props =
		$props();
</script>

<div
	class="overlay result-overlay defeat-overlay"
	role="dialog"
	aria-modal="true"
	aria-labelledby="defeat-title"
>
	<article class="modal result-modal defeat-modal">
		<p class="overlay-kicker">STATE TERMINATED / NO TERRITORY</p>
		<h2 id="defeat-title">YOUR FLAG<br /><em>FALLS.</em></h2>
		<p class="result-lede">
			{human.name} no longer holds a single pixel. The simulation is paused at tick {tick}.
		</p>
		<div class="result-stats">
			<div><span>SURVIVED</span><strong>{matchClock}</strong></div>
			<div><span>FINAL RANK</span><strong>#{humanRank}</strong></div>
			<div><span>WORLD CLAIMED</span><strong>{(human.landShare * 100).toFixed(1)}%</strong></div>
			<div><span>ALIVE STATES</span><strong>{aliveCount}</strong></div>
		</div>
		<div class="modal-actions">
			<button class="deploy-button" type="button" onclick={onSpectate}>
				<span>SPECTATE THE END</span>
			</button>
			<button class="ghost-button" type="button" onclick={onRematch}>REMATCH</button>
			<button class="ghost-button" type="button" onclick={onNewWorld}>NEW WORLD</button>
		</div>
	</article>
</div>

<style>
	@media (max-width: 900px) {
		.result-stats {
			grid-template-columns: 1fr 1fr;
		}
		.result-stats div:nth-child(2) {
			border-right: 0;
		}
		.result-stats div:nth-child(-n + 2) {
			border-bottom: 1px solid var(--line-soft);
		}
	}
	@media (max-width: 900px) {
	}
	.result-modal::before {
		content: '';
		position: absolute;
		top: -1px;
		left: -1px;
		width: 18px;
		height: 18px;
		border-top: 1px solid var(--signal);
		border-left: 1px solid var(--signal);
	}
	.result-modal {
		width: min(92vw, 670px);
	}
	.result-modal h2 {
		font-size: var(--display-md);
	}
	.result-lede {
		max-width: 490px;
		margin: 0 0 24px;
		font-size: var(--text-13);
		line-height: 1.6;
		color: var(--ink-dim);
	}
	.result-stats {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		margin: 20px 0 22px;
		border-top: 1px solid var(--line-soft);
		border-bottom: 1px solid var(--line-soft);
	}
	.result-stats div {
		display: flex;
		flex-direction: column;
		gap: 5px;
		padding: 12px 14px;
		border-right: 1px solid var(--line-soft);
	}
	.result-stats div:last-child {
		border-right: 0;
	}
	.result-stats span {
		font-family: var(--font-mono);
		font-size: var(--text-2xs);
		letter-spacing: 0.1em;
		color: var(--ink-faint);
	}
	.result-stats strong {
		font-family: var(--font-mono);
		font-size: var(--text-16);
		font-weight: 500;
		color: var(--ink);
	}
	.defeat-modal h2 {
		color: var(--danger-bright);
	}
	.defeat-modal h2 em {
		-webkit-text-stroke-color: rgba(255, 143, 125, 0.8);
	}
</style>
