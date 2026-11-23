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
