<script lang="ts">
	import { colorForPlayer } from '#lib/game/constants';
	import type { PublicPlayer } from '#lib/game/simulation';
	import { formatShare } from '#lib/format';

	interface Props {
		human: PublicPlayer;
		humanStructure: boolean;
		humanAllyName: string | null;
		humanAlliancePending: boolean;
		humanRank: number;
		aliveCount: number;
		stateCount: number;
		matchClock: string;
		matchTimeRemaining: string | null;
		paused: boolean;
		showResult: boolean;
		onTogglePause: () => void;
		onOpenHelp: () => void;
		onOnline: () => void;
		onEvolution: () => void;
		onNewWorld: () => void;
	}
	let {
		human,
		humanStructure,
		humanAllyName,
		humanAlliancePending,
		humanRank,
		aliveCount,
		stateCount,
		matchClock,
		matchTimeRemaining,
		paused,
		showResult,
		onTogglePause,
		onOpenHelp,
		onOnline,
		onEvolution,
		onNewWorld
	}: Props = $props();
</script>

<header class="hud topbar">
	<div class="brand-lockup">
		<div class="brand-mark" aria-hidden="true"><span></span></div>
		<div class="brand-type">
			<p class="eyebrow">FRONTAGE V1 / {stateCount} STATES</p>
			<h1>TERRITORY<span>.</span></h1>
		</div>
	</div>

	<div class="command-readout">
		<div class="commander" style={`--player-color:${colorForPlayer(human.id).hex}`}>
			<span class="commander-swatch" aria-hidden="true"></span>
			<span class="commander-name">
				<strong>{human.name}</strong>
				<small class:lost={!humanStructure}>
					{humanStructure ? 'COMMANDER / ANCHORED' : 'COMMANDER / NO ANCHOR'}
					{humanAllyName
						? ` · ALLIED ${humanAllyName}`
						: humanAlliancePending
							? ' · ALLIANCE PENDING'
							: ''}
				</small>
			</span>
		</div>
		<div class="readout-stat">
			<span>LAND</span>
			<strong>{formatShare(human.landShare)}<em>%</em></strong>
		</div>
		<div class="readout-stat">
			<span>RANK</span>
			<strong>#{humanRank}<em>/{aliveCount}</em></strong>
		</div>
		<div class="readout-stat">
			<span>STATES</span>
			<strong>{aliveCount}<em>/{stateCount}</em></strong>
		</div>
	</div>

	<div class="top-actions">
		<div class="clock-block">
			<span>WAR CLOCK</span>
			<strong>{matchClock}</strong>
			{#if matchTimeRemaining}
				<small>{matchTimeRemaining} LEFT</small>
			{/if}
		</div>
		<button
			class="action-button pause-button"
			type="button"
			onclick={onTogglePause}
			disabled={showResult}
			aria-label={paused ? 'Resume simulation' : 'Pause simulation'}
		>
			{#if paused}
				<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.5 10 6l-7 4.5z" /></svg>
				<span>RESUME</span>
			{:else}
				<svg viewBox="0 0 12 12" aria-hidden="true">
					<path d="M3 1.5h2.2v9H3zm3.8 0H9v9H6.8z" />
				</svg>
				<span>PAUSE</span>
			{/if}
		</button>
		<button class="square-button" type="button" onclick={onOpenHelp} aria-label="Open field manual">
			<span>?</span>
		</button>
		<button class="action-button" type="button" onclick={onOnline}>ONLINE</button>
		<button class="action-button" type="button" onclick={onEvolution}>AI LAB</button>
		<button class="action-button new-world-button" type="button" onclick={onNewWorld}>
			NEW WORLD
		</button>
	</div>
</header>
