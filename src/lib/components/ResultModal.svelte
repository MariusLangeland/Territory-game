<script lang="ts">
	import { colorForPlayer } from '#lib/game/constants';
	import type { BotBehaviorTelemetry, PublicPlayer } from '#lib/game/simulation';

	interface Props {
		humanId: number;
		winner: PublicPlayer | null;
		humanRank: number;
		worldClaim: number;
		matchClock: string;
		seedHex: string;
		ranked: readonly PublicPlayer[];
		aiPostMatch: BotBehaviorTelemetry | null;
		aiOptionSummary: string;
		onRematch: () => void;
		onCopySeed: () => void;
		onNewWorld: () => void;
		onOpenHelp: () => void;
	}
	let {
		humanId,
		winner,
		humanRank,
		worldClaim,
		matchClock,
		seedHex,
		ranked,
		aiPostMatch,
		aiOptionSummary,
		onRematch,
		onCopySeed,
		onNewWorld,
		onOpenHelp
	}: Props = $props();
</script>

<div class="overlay result-overlay" role="dialog" aria-modal="true" aria-labelledby="result-title">
	<article class="modal result-modal">
		<p class="overlay-kicker">
			{winner?.id === humanId ? 'CAMPAIGN COMPLETE / VICTORY' : 'CAMPAIGN COMPLETE / DEFEAT'}
		</p>
		<h2 id="result-title">
			{#if winner?.id === humanId}
				THE ATLAS<br /><em>IS YOURS.</em>
			{:else}
				{winner?.name ?? 'A RIVAL'}<br /><em>TAKES THE WORLD.</em>
			{/if}
		</h2>
		<p class="result-lede">
			{#if winner?.id === humanId}
				You hold 70% of the land. The frontier is closed.
			{:else}
				Your command has ended. The map remembers who held the last pixel.
			{/if}
		</p>

		<div class="result-stats">
			<div><span>WAR CLOCK</span><strong>{matchClock}</strong></div>
			<div><span>WORLD CLAIMED</span><strong>{worldClaim.toFixed(1)}%</strong></div>
			<div><span>COMMANDER RANK</span><strong>#{humanRank || '—'}</strong></div>
			<div><span>SEED</span><strong>{seedHex}</strong></div>
		</div>

		{#if aiPostMatch}
			<div class="result-ai">
				<div>
					<span>AI FORTS UNDER THREAT</span><strong>
						{aiPostMatch.threatenedFortificationBuilds} built / {aiPostMatch.threatenedFortificationUpgrades}
						upgraded
					</strong>
				</div>
				<div><span>DETERRENCE POSTURES</span><strong>{aiPostMatch.deterrencePostures}</strong></div>
				<div>
					<span>INCOME-GAP CP / WA</span><strong>
						{aiPostMatch.incomeGapCommandPosts} / {aiPostMatch.incomeGapWarAcademies}
					</strong>
				</div>
				<div>
					<span>SUPPLY OPPORTUNITIES</span><strong>{aiPostMatch.opportunityAttacks}</strong>
				</div>
				<div>
					<span>BOT PORTS / LANDINGS</span><strong>
						{aiPostMatch.botPortBuilds} / {aiPostMatch.botNavalLandings}
					</strong>
				</div>
				<div><span>STRATEGIC OPTIONS</span><strong>{aiOptionSummary}</strong></div>
			</div>
		{/if}

		<ol class="result-standings">
			{#each ranked.slice(0, 4) as player, index (player.id)}
				<li
					class:is-human={player.id === humanId}
					style={`--player-color:${colorForPlayer(player.id).hex}`}
				>
					<span>{String(index + 1).padStart(2, '0')}</span>
					<i></i>
					<b>{player.name}</b>
					<em>{(player.landShare * 100).toFixed(1)}%</em>
				</li>
			{/each}
		</ol>

		<div class="modal-actions">
			<button class="deploy-button" type="button" onclick={onRematch}>
				<span>REMATCH SAME SEED</span>
			</button>
			<button class="ghost-button" type="button" onclick={onCopySeed}>COPY SEED</button>
			<button class="ghost-button" type="button" onclick={onNewWorld}>NEW WORLD</button>
			<button class="ghost-button" type="button" onclick={onOpenHelp}>FIELD MANUAL</button>
		</div>
	</article>
</div>
