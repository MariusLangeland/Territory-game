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
		.result-ai {
			grid-template-columns: 1fr 1fr;
		}
		.result-ai div:nth-child(even) {
			border-right: 0;
		}
		.result-ai div:nth-child(-n + 4) {
			border-bottom: 1px solid var(--line-soft);
		}
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
	.result-ai {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		margin: 0 0 12px;
		border: 1px solid var(--line-soft);
		background: rgba(88, 199, 232, 0.04);
	}
	.result-ai div {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 8px 9px;
		border-right: 1px solid var(--line-soft);
	}
	.result-ai div:last-child {
		border-right: 0;
	}
	.result-ai span {
		font-family: var(--font-mono);
		font-size: var(--text-6);
		letter-spacing: 0.08em;
		color: var(--ink-faint);
	}
	.result-ai strong {
		font-family: var(--font-mono);
		font-size: var(--text-10);
		font-weight: 500;
		color: var(--accent-cyan);
	}
	.result-standings {
		margin: 0 0 10px;
		padding: 0;
		list-style: none;
	}
	.result-standings li {
		display: grid;
		grid-template-columns: 26px 5px 1fr auto;
		align-items: center;
		gap: 10px;
		height: 28px;
		padding: 0 8px;
		border-bottom: 1px solid var(--line-soft);
	}
	.result-standings li.is-human {
		background: color-mix(in srgb, var(--player-color) 8%, transparent);
	}
	.result-standings span {
		font-family: var(--font-mono);
		font-size: var(--text-8);
		font-style: normal;
		color: var(--ink-faint);
	}
	.result-standings em {
		font-family: var(--font-mono);
		font-size: var(--text-8);
		font-style: normal;
		color: var(--ink-faint);
	}
	.result-standings i {
		width: 5px;
		height: 12px;
		background: var(--player-color);
	}
	.result-standings b {
		font-family: var(--font-mono);
		font-size: var(--text-10);
		font-weight: 500;
		letter-spacing: 0.04em;
	}
</style>
