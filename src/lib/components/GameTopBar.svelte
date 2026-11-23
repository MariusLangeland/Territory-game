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

<style>
	@media (max-width: 1180px) {
		.topbar {
			grid-template-columns: minmax(170px, 1fr) auto minmax(220px, 1fr);
			gap: 10px;
		}
		.commander {
			min-width: 112px;
			padding: 0 11px;
		}
		.readout-stat {
			min-width: 62px;
			padding: 0 10px;
		}
		.readout-stat > span {
			font-size: var(--text-6);
		}
		.action-button span {
			display: none;
		}
		.pause-button {
			width: 36px;
			justify-content: center;
			padding: 0;
		}
	}
	@media (max-width: 900px) {
		.topbar {
			inset: 12px 14px auto;
			grid-template-columns: 1fr auto;
		}
		.brand-lockup {
			display: none;
		}
		.command-readout {
			justify-self: start;
		}
		.commander {
			display: none;
		}
		.top-actions {
			height: 42px;
		}
		.clock-block {
			display: none;
		}
	}
	@media (max-width: 620px) {
		.topbar {
			grid-template-columns: 1fr auto;
		}
		.readout-stat:nth-child(4) {
			display: none;
		}
		.new-world-button {
			display: none;
		}
		.command-readout {
			height: 42px;
		}
		.readout-stat strong {
			font-size: var(--text-12);
		}
	}
	.topbar {
		inset: 18px 22px auto;
		display: grid;
		grid-template-columns: minmax(205px, 1fr) auto minmax(270px, 1fr);
		align-items: start;
		gap: 18px;
		pointer-events: none;
		animation: hud-in 500ms ease-out both;
	}
	.topbar > * {
		pointer-events: auto;
	}
	.brand-lockup {
		display: flex;
		align-items: center;
		gap: 12px;
		min-width: 0;
		padding-top: 2px;
		filter: drop-shadow(0 2px 18px rgba(0, 0, 0, 0.78));
	}
	.brand-mark {
		position: relative;
		display: grid;
		place-items: center;
		flex: none;
		width: 37px;
		height: 37px;
		border: 1px solid var(--line-strong);
		background: rgba(6, 14, 18, 0.66);
		backdrop-filter: blur(12px);
		transform: rotate(45deg);
	}
	.brand-mark span {
		width: 9px;
		height: 9px;
		background: var(--signal);
		box-shadow: 0 0 16px rgba(220, 233, 149, 0.6);
	}
	.brand-mark::before {
		content: '';
		position: absolute;
		background: var(--line-strong);
	}
	.brand-mark::after {
		content: '';
		position: absolute;
		background: var(--line-strong);
	}
	.brand-mark::before {
		inset: 5px;
		border: 1px solid var(--line-soft);
	}
	.brand-mark::after {
		width: 49px;
		height: 1px;
		opacity: 0.5;
	}
	.brand-type {
		min-width: 0;
	}
	.brand-type h1 {
		margin: 1px 0 0;
		font-family: var(--font-display);
		font-size: var(--text-30);
		font-weight: 700;
		line-height: 0.9;
		letter-spacing: 0.035em;
	}
	.brand-type h1 span {
		color: var(--signal);
	}
	.command-readout {
		display: flex;
		align-items: stretch;
		height: 48px;
		border: 1px solid var(--line-strong);
		background: rgba(5, 13, 18, 0.76);
		box-shadow: 0 16px 50px rgba(0, 0, 0, 0.24);
		backdrop-filter: blur(18px) saturate(0.8);
		animation: hud-in 600ms 80ms ease-out both;
	}
	.commander {
		position: relative;
		display: flex;
		align-items: center;
		gap: 9px;
		min-width: 146px;
		padding: 0 16px 0 14px;
		background: linear-gradient(
			90deg,
			color-mix(in srgb, var(--player-color) 12%, transparent),
			transparent
		);
	}
	.commander::after {
		content: '';
		position: absolute;
		right: 0;
		top: 8px;
		bottom: 8px;
		width: 1px;
		background: var(--line-soft);
	}
	.commander-swatch {
		width: 8px;
		height: 22px;
		background: var(--player-color);
		box-shadow: 0 0 15px color-mix(in srgb, var(--player-color) 55%, transparent);
	}
	.commander-name {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.commander-name strong {
		font-family: var(--font-display);
		font-size: var(--text-17);
		letter-spacing: 0.08em;
		line-height: 1;
	}
	.commander-name small.lost {
		color: var(--danger-strong);
	}
	.commander-name small {
		font-family: var(--font-mono);
		font-size: var(--text-7);
		letter-spacing: 0.16em;
		color: var(--ink-faint);
	}
	.readout-stat > span {
		font-family: var(--font-mono);
		font-size: var(--text-7);
		letter-spacing: 0.16em;
		color: var(--ink-faint);
	}
	.clock-block > span {
		font-family: var(--font-mono);
		font-size: var(--text-7);
		letter-spacing: 0.16em;
		color: var(--ink-faint);
	}
	.readout-stat {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 3px;
		min-width: 73px;
		padding: 0 13px;
		border-left: 1px solid var(--line-soft);
	}
	.readout-stat strong {
		font-family: var(--font-mono);
		font-size: var(--text-14);
		font-weight: 500;
		letter-spacing: -0.03em;
		line-height: 1;
		color: var(--ink);
	}
	.readout-stat em {
		margin-left: 1px;
		font-style: normal;
		font-size: var(--text-9);
		color: var(--ink-faint);
	}
	.top-actions {
		justify-self: end;
		display: flex;
		align-items: center;
		gap: 7px;
		height: 48px;
		animation: hud-in 600ms 140ms ease-out both;
	}
	.clock-block {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 3px;
		margin-right: 4px;
	}
	.clock-block strong {
		font-family: var(--font-mono);
		font-size: var(--text-17);
		font-weight: 500;
		line-height: 1;
		letter-spacing: 0.03em;
	}
	.action-button {
		height: 36px;
		border: 1px solid var(--line-strong);
		background: rgba(5, 13, 18, 0.76);
		font-family: var(--font-mono);
		font-size: var(--text-9);
		letter-spacing: 0.1em;
		color: var(--ink-dim);
		backdrop-filter: blur(14px);
		cursor: pointer;
		transition:
			color 160ms ease,
			border-color 160ms ease,
			background 160ms ease;
	}
	.square-button {
		height: 36px;
		border: 1px solid var(--line-strong);
		background: rgba(5, 13, 18, 0.76);
		font-family: var(--font-mono);
		font-size: var(--text-9);
		letter-spacing: 0.1em;
		color: var(--ink-dim);
		backdrop-filter: blur(14px);
		cursor: pointer;
		transition:
			color 160ms ease,
			border-color 160ms ease,
			background 160ms ease;
	}
	.action-button {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		padding: 0 13px;
	}
	.action-button svg {
		width: 10px;
		height: 10px;
		fill: currentColor;
	}
	.action-button:hover {
		color: var(--ink);
		border-color: var(--signal-55);
		background: rgba(14, 26, 30, 0.9);
	}
	.square-button:hover {
		color: var(--ink);
		border-color: var(--signal-55);
		background: rgba(14, 26, 30, 0.9);
	}
	.action-button:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.square-button {
		display: grid;
		place-items: center;
		width: 36px;
		padding: 0;
		font-size: var(--text-14);
	}
	.new-world-button {
		color: var(--signal);
	}
	.clock-block small {
		font-family: var(--font-mono);
		font-size: var(--text-6);
		letter-spacing: 0.05em;
		color: var(--warning-strong);
	}
</style>
