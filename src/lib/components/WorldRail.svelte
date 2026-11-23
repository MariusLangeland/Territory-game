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
