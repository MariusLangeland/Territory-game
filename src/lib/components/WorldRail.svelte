<script lang="ts">
	import { TICK_RATE, colorForPlayer } from '#lib/game/constants';
	import type { GameSnapshot, PublicPlayer, SimEvent } from '#lib/game/simulation';
	import { formatClock, formatCompact, formatShare } from '#lib/format';

	interface Props {
		snapshot: GameSnapshot;
		human: PublicPlayer;
		ranked: readonly PublicPlayer[];
		visibleRanked: readonly PublicPlayer[];
		rankWindow: { start: number; end: number };
		rankRowHeight: number;
		rankScrollElement?: HTMLElement | null;
		worldClaim: number;
		aliveCount: number;
		seedHex: string;
		eventFeed: readonly SimEvent[];
		onRankScroll: (event: Event) => void;
	}
	let {
		snapshot,
		human,
		ranked,
		visibleRanked,
		rankWindow,
		rankRowHeight,
		rankScrollElement = $bindable(null),
		worldClaim,
		aliveCount,
		seedHex,
		eventFeed,
		onRankScroll
	}: Props = $props();
</script>

<aside class="right-rail hud">
	<section class="panel board" aria-label="World leaderboard">
		<div class="panel-head">
			<span>WORLD CONTROL</span>
			<span class="panel-meta">{aliveCount} ALIVE · {snapshot.attacks.length} FRONTS</span>
		</div>
		<div class="world-meter">
			<div class="world-meter-copy">
				<span>CLAIMED TERRITORY</span>
				<strong>{worldClaim.toFixed(1)}%</strong>
			</div>
			<div class="meter-track"><span style={`width:${Math.min(100, worldClaim)}%`}></span></div>
			<div class="world-meter-foot">
				<span>{formatCompact(snapshot.claimedLand)} PX</span>
				<span>{formatCompact(snapshot.landCount)} LAND</span>
			</div>
		</div>

		<div class="rank-scroll" bind:this={rankScrollElement} onscroll={onRankScroll}>
			{#if rankWindow.start > 0}
				<div
					class="rank-spacer"
					style={`height:${rankWindow.start * rankRowHeight}px`}
					aria-hidden="true"
				></div>
			{/if}
			<ol class="rank-list">
				{#each visibleRanked as player, index (player.id)}
					<li
						class:is-human={player.id === human.id}
						class:is-dead={!player.alive}
						style={`--player-color:${colorForPlayer(player.id).hex};--share:${Math.min(100, player.landShare * 100)}%`}
					>
						<span class="rank-index">
							{String(rankWindow.start + index + 1).padStart(3, '0')}
						</span>
						<span class="rank-swatch" aria-hidden="true"></span>
						<span class="rank-name">
							{player.name}
							{#if player.id === human.id}<em>YOU</em>{/if}
							{#if !player.alive}<em class="dead-tag">OUT</em>{/if}
						</span>
						<span class="rank-land">{formatShare(player.landShare)}%</span>
						<span class="rank-progress" aria-hidden="true"></span>
					</li>
				{/each}
			</ol>
			{#if rankWindow.end < ranked.length}
				<div
					class="rank-spacer"
					style={`height:${(ranked.length - rankWindow.end) * rankRowHeight}px`}
					aria-hidden="true"
				></div>
			{/if}
		</div>

		<div class="panel-foot">
			<span><i class="live-dot"></i>WEBGPU</span>
			<span>TICK {String(snapshot.tick).padStart(5, '0')}</span>
			<span>SEED {seedHex}</span>
		</div>
	</section>

	{#if eventFeed.length > 0}
		<section class="panel feed" aria-label="War feed">
			<div class="panel-head"><span>WAR FEED</span><span class="panel-meta">LIVE</span></div>
			<ul>
				{#each eventFeed as event (event.id)}
					<li
						class:elimination={event.kind === 'elimination'}
						class:structure={event.kind === 'structure'}
						class:build={event.kind === 'build'}
					>
						<span>{event.message}</span>
						<time>{formatClock(event.tick / TICK_RATE)}</time>
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</aside>

<style>
	@media (max-width: 1180px) {
		.right-rail {
			width: 272px;
		}
	}
	@media (max-width: 900px) {
		.right-rail {
			display: none;
		}
	}
	.right-rail {
		top: 92px;
		right: 22px;
		display: flex;
		flex-direction: column;
		gap: 11px;
		width: 302px;
		pointer-events: none;
	}
	.right-rail > * {
		pointer-events: auto;
	}
	.panel {
		position: relative;
		border: 1px solid var(--line-strong);
		background: rgba(5, 13, 18, 0.8);
		box-shadow: 0 25px 70px rgba(0, 0, 0, 0.33);
		backdrop-filter: blur(18px) saturate(0.82);
		animation: hud-in 550ms 100ms ease-out both;
	}
	.panel::before {
		content: '';
		position: absolute;
		top: -1px;
		left: -1px;
		width: 13px;
		height: 13px;
		border-top: 1px solid rgba(220, 233, 149, 0.68);
		border-left: 1px solid rgba(220, 233, 149, 0.68);
		pointer-events: none;
	}
	.panel-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 12px 14px 10px;
		border-bottom: 1px solid var(--line-soft);
		font-family: var(--font-mono);
		font-size: var(--text-8);
		font-weight: 600;
		letter-spacing: 0.14em;
		color: var(--ink-dim);
	}
	.panel-meta {
		color: var(--ink-faint);
		font-size: var(--text-7);
	}
	.world-meter {
		padding: 12px 14px 11px;
		border-bottom: 1px solid var(--line-soft);
	}
	.world-meter-copy {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
	}
	.world-meter-foot {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
	}
	.world-meter-copy span {
		font-family: var(--font-mono);
		font-size: var(--text-7);
		letter-spacing: 0.1em;
		color: var(--ink-faint);
	}
	.world-meter-foot {
		font-family: var(--font-mono);
		font-size: var(--text-7);
		letter-spacing: 0.1em;
		color: var(--ink-faint);
	}
	.world-meter-copy strong {
		font-family: var(--font-mono);
		font-size: var(--text-13);
		font-weight: 500;
		color: var(--signal);
	}
	.meter-track {
		position: relative;
		height: 3px;
		margin: 9px 0 6px;
		background: var(--alpha-white-08);
		overflow: hidden;
	}
	.meter-track span {
		display: block;
		height: 100%;
		background: linear-gradient(90deg, var(--success), var(--signal));
		box-shadow: 0 0 12px rgba(220, 233, 149, 0.4);
		transition: width 450ms ease;
	}
	.rank-scroll {
		max-height: min(40vh, 360px);
		overflow-y: auto;
		overscroll-behavior: contain;
		scrollbar-gutter: stable;
	}
	.rank-list {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.rank-list li {
		position: relative;
		display: grid;
		grid-template-columns: 25px 6px minmax(0, 1fr) 50px;
		align-items: center;
		gap: 8px;
		height: 28px;
		padding: 0 13px;
		overflow: hidden;
		font-size: var(--text-11);
		transition: background 150ms ease;
	}
	.rank-list li:hover {
		background: rgba(255, 255, 255, 0.025);
	}
	.rank-list li.is-human {
		background: color-mix(in srgb, var(--player-color) 9%, transparent);
	}
	.rank-list li.is-human::before {
		content: '';
		position: absolute;
		left: 0;
		top: 6px;
		bottom: 6px;
		width: 2px;
		background: var(--player-color);
	}
	.rank-list li.is-dead {
		opacity: 0.34;
		filter: grayscale(1);
	}
	.rank-progress {
		position: absolute;
		left: 0;
		bottom: 0;
		height: 1px;
		width: var(--share);
		background: var(--player-color);
		opacity: 0.35;
	}
	.rank-index {
		font-family: var(--font-mono);
		font-size: var(--text-8);
		color: var(--ink-faint);
	}
	.rank-swatch {
		width: 6px;
		height: 12px;
		background: var(--player-color);
	}
	.rank-name {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		font-family: var(--font-mono);
		font-size: var(--text-10);
		letter-spacing: 0.04em;
		color: var(--ink);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.rank-name em {
		flex: none;
		padding: 1px 3px;
		border: 1px solid color-mix(in srgb, var(--player-color) 40%, transparent);
		font-family: var(--font-mono);
		font-size: var(--text-6);
		font-style: normal;
		letter-spacing: 0.08em;
		color: var(--player-color);
	}
	.rank-name em.dead-tag {
		border-color: var(--line-strong);
		color: var(--ink-faint);
	}
	.rank-land {
		font-family: var(--font-mono);
		font-size: var(--text-9);
		text-align: right;
		color: var(--ink-dim);
	}
	.panel-foot {
		display: flex;
		justify-content: space-between;
		gap: 6px;
		padding: 9px 13px;
		border-top: 1px solid var(--line-soft);
		font-family: var(--font-mono);
		font-size: var(--text-2xs);
		letter-spacing: 0.08em;
		color: var(--ink-faint);
	}
	.live-dot {
		display: inline-block;
		width: 4px;
		height: 4px;
		margin-right: 5px;
		border-radius: 50%;
		background: var(--signal);
		box-shadow: 0 0 7px var(--signal);
		vertical-align: 1px;
	}
	.feed {
		animation-delay: 160ms;
	}
	.feed ul {
		margin: 0;
		padding: 7px 0;
		list-style: none;
	}
	.feed li {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 6px 13px;
		font-size: var(--text-10);
		line-height: 1.45;
		color: var(--ink-dim);
	}
	.feed li.elimination span {
		color: var(--danger-strong);
	}
	.feed li.structure span {
		color: var(--warning);
	}
	.feed li.build span {
		color: var(--success);
	}
	.feed time {
		flex: none;
		font-family: var(--font-mono);
		font-size: var(--text-7);
		color: var(--ink-faint);
	}
</style>
