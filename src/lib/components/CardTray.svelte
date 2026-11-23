<script lang="ts">
	import { flip } from 'svelte/animate';
	import { fly } from 'svelte/transition';
	import {
		STRUCTURE_ACCENTS,
		STRUCTURE_DEFINITIONS,
		type BuildableStructureType,
		type PublicCard
	} from '#lib/game/structures';
	import type { GameSnapshot } from '#lib/game/simulation';
	import { formatSupply } from '#lib/format';

	interface Props {
		snapshot: GameSnapshot;
		handRaised: boolean;
		handShellElement?: HTMLElement | null;
		draggingCardId: number | null;
		onStartDrag: (event: DragEvent, card: PublicCard) => void;
		onDrag: (event: DragEvent) => void;
		onDragEnd: () => void;
		onRaise: () => void;
	}
	let {
		snapshot,
		handRaised,
		handShellElement = $bindable(null),
		draggingCardId,
		onStartDrag,
		onDrag,
		onDragEnd,
		onRaise
	}: Props = $props();

	function cardDefinition(card: PublicCard) {
		return STRUCTURE_DEFINITIONS[card.type];
	}

	function cardCategory(type: BuildableStructureType): string {
		switch (type) {
			case 'artillery':
				return 'SIEGE';
			case 'barracks':
				return 'MILITARY';
			case 'fortification':
				return 'FORTIFICATION';
			case 'jammer':
				return 'SUPPRESSION';
			case 'command-post':
				return 'COMMAND';
			case 'war-academy':
				return 'DOCTRINE';
			case 'port':
				return 'NAVAL';
		}
	}
</script>

<div class="card-tray hud" aria-label="Build cards">
	<div
		class="hand-shell"
		class:collapsed={!handRaised}
		bind:this={handShellElement}
		aria-label="Card hand"
	>
		<div class="hand-row">
			{#each snapshot.hand as card, index (card.id)}
				{@const definition = cardDefinition(card)}
				{@const accent = STRUCTURE_ACCENTS[card.type]}
				<article
					class="build-card"
					data-card-id={card.id}
					class:unaffordable={snapshot.supply < definition.cost}
					class:dragging={draggingCardId === card.id}
					style={`--card-accent:${accent};--card-tilt:${(index - (snapshot.hand.length - 1) / 2) * 2.2}deg`}
					draggable={snapshot.supply >= definition.cost}
					in:fly={{ y: 42, duration: 360, delay: Math.min(index, 2) * 55 }}
					out:fly={{ y: 28, duration: 240 }}
					animate:flip={{ duration: 260 }}
					ondragstart={(event) => onStartDrag(event, card)}
					ondrag={onDrag}
					ondragend={onDragEnd}
					onpointerdown={onRaise}
					title={`Drag ${definition.label} into your territory`}
				>
					<div class="card-face">
						<div class="card-banner">
							<span>BUILD CARD</span>
							<b class="card-hotkey" title={`Press ${index + 1} to place`}>{index + 1}</b>
							<div class="card-cost">
								<b title={String(definition.cost)}>{formatSupply(definition.cost)}</b><small>
									S
								</small>
							</div>
						</div>
						<h3 class="card-title">{definition.label}</h3>
						<div class="card-art" aria-hidden="true">
							<span class="card-art-icon">
								{#if card.type === 'artillery'}
									<svg viewBox="0 0 24 24">
										<path
											d="M3 19h8M5 19a3 3 0 0 1 6 0M11 18 20 7M17 5l3 2-2 3M4 12c3-5 8-7 16-7"
										/>
									</svg>
								{:else if card.type === 'barracks'}
									<svg viewBox="0 0 24 24">
										<path d="M5 19 19 5M8 5l11 11M5 16l3 3M16 5l3 3" />
									</svg>
								{:else if card.type === 'fortification'}
									<svg viewBox="0 0 24 24">
										<path d="M12 3 19 6v5c0 5-3 8-7 10-4-2-7-5-7-10V6z" />
									</svg>
								{:else if card.type === 'jammer'}
									<svg viewBox="0 0 24 24">
										<path
											d="M12 12v9M4 8a11 11 0 0 1 16 0M7 11a7 7 0 0 1 10 0M10 14a3 3 0 0 1 4 0"
										/>
									</svg>
								{:else if card.type === 'command-post'}
									<svg viewBox="0 0 24 24">
										<path d="M12 21V9M8 9a6 6 0 0 1 8 0M5 6a10 10 0 0 1 14 0M9 21h6" />
									</svg>
								{:else if card.type === 'port'}
									<svg viewBox="0 0 24 24">
										<path d="M12 3v15M8 6a4 4 0 0 1 8 0M5 12h14M5 15c0 4 3 6 7 6s7-2 7-6" />
									</svg>
								{:else}
									<svg viewBox="0 0 24 24">
										<path d="M12 4 20 8l-8 4-8-4zM4 12l8 4 8-4M4 16l8 4 8-4" />
									</svg>
								{/if}
							</span>
						</div>
						<div class="card-type">STRUCTURE / {cardCategory(card.type)}</div>
						<p class="card-rules">{definition.description}</p>
						<div class="card-footer">
							<span>DRAG OR {index + 1} TO BUILD</span><span>◆</span>
						</div>
					</div>
				</article>
			{/each}
		</div>
	</div>
</div>

<style>
	.card-tray {
		left: 50%;
		bottom: 12px;
		transform: translateX(-50%);
		display: flex;
		align-items: flex-end;
		gap: 16px;
		padding: 0;
		border: 0;
		background: none;
		backdrop-filter: none;
		box-shadow: none;
		pointer-events: none;
		animation: hud-fade 600ms 200ms ease-out both;
	}

	.hand-shell {
		display: flex;
		align-items: flex-end;
		pointer-events: none;
	}

	.hand-row {
		display: flex;
		align-items: flex-end;
		gap: 8px;
		padding: 0 4px 10px;
		pointer-events: none;
		transform: translateY(0);
		transition:
			transform 360ms cubic-bezier(0.2, 0.72, 0.2, 1),
			opacity 260ms ease;
		will-change: transform;
	}

	.hand-shell.collapsed .hand-row {
		transform: translateY(calc(100% - 30px));
		opacity: 0.92;
	}

	.build-card {
		position: relative;
		z-index: 1;
		flex: none;
		width: 136px;
		height: 204px;
		cursor: grab;
		user-select: none;
		transform: translateY(0) rotate(var(--card-tilt));
		transform-origin: 50% 100%;
		transition:
			transform 220ms cubic-bezier(0.2, 0.75, 0.25, 1),
			filter 200ms ease,
			opacity 160ms ease;
		filter: drop-shadow(0 18px 20px var(--alpha-black-42));
		pointer-events: auto;
	}

	.build-card:hover {
		z-index: 6;
		transform: translateY(-18px) rotate(0deg) scale(1.035);
		filter: drop-shadow(0 26px 30px var(--alpha-black-55));
	}

	.card-hotkey {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 12px;
		height: 12px;
		padding: 0 2px;
		border: 1px solid rgba(255, 248, 220, 0.35);
		border-radius: 2px;
		font-family: var(--font-mono);
		font-size: var(--text-7);
		font-weight: 500;
		line-height: 1;
		color: var(--ink-dim);
	}

	.build-card.dragging {
		z-index: 8;
		opacity: 0.4;
		transform: translateY(-28px) rotate(4deg) scale(0.94);
		filter: drop-shadow(0 30px 38px rgba(0, 0, 0, 0.65));
		cursor: grabbing;
	}

	.build-card.unaffordable {
		cursor: not-allowed;
		filter: saturate(0.46) brightness(0.8) drop-shadow(0 12px 16px rgba(0, 0, 0, 0.38));
	}

	.build-card.unaffordable:hover {
		filter: saturate(0.62) brightness(0.9) drop-shadow(0 20px 24px rgba(0, 0, 0, 0.5));
	}

	.card-face {
		position: relative;
		display: flex;
		flex-direction: column;
		height: 100%;
		padding: 9px;
		overflow: hidden;
		border: 1px solid color-mix(in srgb, var(--card-accent) 58%, var(--ink-dim) 42%);
		background:
			radial-gradient(
				circle at 50% 8%,
				color-mix(in srgb, var(--card-accent) 16%, transparent),
				transparent 48%
			),
			linear-gradient(150deg, rgba(255, 255, 255, 0.055), transparent 34%),
			linear-gradient(
				165deg,
				var(--bg-online-raised) 0%,
				var(--bg-online-panel) 55%,
				var(--bg-raised) 100%
			);
		box-shadow:
			inset 0 0 0 1px rgba(255, 248, 220, 0.08),
			inset 0 0 32px var(--alpha-black-45);
		clip-path: polygon(
			11px 0,
			calc(100% - 11px) 0,
			100% 11px,
			100% calc(100% - 11px),
			calc(100% - 11px) 100%,
			11px 100%,
			0 calc(100% - 11px),
			0 11px
		);
	}

	.card-face::before {
		content: '';
		position: absolute;
		inset: 3px;
		border: 1px solid color-mix(in srgb, var(--card-accent) 24%, transparent);
		clip-path: inherit;
		pointer-events: none;
	}

	.card-face::after {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(
			115deg,
			transparent 35%,
			var(--alpha-white-08) 48%,
			transparent 58%
		);
		opacity: 0;
		transition: opacity 220ms ease;
		pointer-events: none;
	}

	.build-card:hover .card-face::after {
		opacity: 1;
	}

	.card-banner {
		position: relative;
		z-index: 1;
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		min-height: 28px;
		font-family: var(--font-mono);
		font-size: var(--text-6);
		letter-spacing: 0.16em;
		color: color-mix(in srgb, var(--card-accent) 72%, var(--accent-bone) 28%);
	}

	.card-cost {
		display: flex;
		align-items: baseline;
		justify-content: center;
		gap: 1px;
		width: 30px;
		height: 34px;
		margin-top: -7px;
		margin-right: -5px;
		padding-top: 4px;
		background: radial-gradient(
			circle at 34% 28%,
			var(--gold-bright) 0%,
			var(--gold) 34%,
			var(--gold-dark) 72%,
			var(--gold-deep) 100%
		);
		clip-path: polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%);
		color: var(--gold-shadow);
		box-shadow: 0 0 16px color-mix(in srgb, var(--card-accent) 38%, transparent);
	}

	.card-cost b {
		font-family: var(--font-display);
		font-size: var(--text-15);
		line-height: 1;
	}

	.card-cost small {
		font-family: var(--font-mono);
		font-size: var(--text-3xs);
		letter-spacing: 0;
	}

	.card-title {
		position: relative;
		z-index: 1;
		margin: 1px 0 5px;
		font-family: var(--font-display);
		font-size: var(--text-17);
		font-weight: 500;
		line-height: 0.95;
		letter-spacing: 0.02em;
		color: var(--ink-strong);
		text-shadow: 0 1px 12px var(--alpha-black-60);
	}

	.card-art {
		position: relative;
		display: grid;
		place-items: center;
		flex: none;
		height: 78px;
		margin-bottom: 5px;
		overflow: hidden;
		border-top: 1px solid color-mix(in srgb, var(--card-accent) 30%, transparent);
		border-bottom: 1px solid color-mix(in srgb, var(--card-accent) 30%, transparent);
		background:
			repeating-linear-gradient(135deg, transparent 0 7px, rgba(255, 255, 255, 0.02) 7px 8px),
			radial-gradient(
				circle at 50% 45%,
				color-mix(in srgb, var(--card-accent) 30%, transparent),
				transparent 65%
			),
			linear-gradient(180deg, var(--alpha-white-035), rgba(0, 0, 0, 0.18));
	}

	.card-art::before {
		content: '';
		position: absolute;
		width: 82px;
		height: 82px;
		border: 1px solid color-mix(in srgb, var(--card-accent) 20%, transparent);
		border-radius: 50%;
		box-shadow: 0 0 0 10px color-mix(in srgb, var(--card-accent) 4%, transparent);
	}

	.card-art-icon {
		position: relative;
		z-index: 1;
		display: grid;
		place-items: center;
		width: 48px;
		height: 48px;
		color: var(--card-accent);
		filter: drop-shadow(0 0 14px color-mix(in srgb, var(--card-accent) 45%, transparent));
	}

	.card-art-icon svg {
		width: 100%;
		height: 100%;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.35;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.card-type {
		position: relative;
		z-index: 1;
		margin-bottom: 4px;
		padding-bottom: 4px;
		border-bottom: 1px solid rgba(255, 248, 220, 0.11);
		font-family: var(--font-mono);
		font-size: var(--text-6);
		letter-spacing: 0.1em;
		color: color-mix(in srgb, var(--card-accent) 68%, var(--accent-bone) 32%);
	}

	.card-rules {
		position: relative;
		z-index: 1;
		flex: 1;
		margin: 0;
		font-size: var(--text-9);
		line-height: 1.32;
		color: var(--ink-dim);
	}

	.card-footer {
		position: relative;
		z-index: 1;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin-top: 4px;
		padding-top: 4px;
		border-top: 1px solid rgba(255, 248, 220, 0.1);
		font-family: var(--font-mono);
		font-size: var(--text-5);
		letter-spacing: 0.12em;
		color: var(--ink-faint);
	}

	.card-footer span:last-child {
		color: var(--card-accent);
	}

	@media (max-width: 1180px) {
		.build-card {
			width: 138px;
			height: 198px;
		}
		.card-title {
			font-size: var(--text-15);
		}
		.card-art {
			height: 64px;
		}
		.card-rules {
			font-size: var(--text-8);
		}
	}

	@media (max-width: 900px) {
		.card-tray {
			left: 8px;
			right: 8px;
			bottom: 10px;
			width: auto;
			max-width: calc(100vw - 16px);
			transform: none;
			justify-content: safe center;
			overflow-x: auto;
			gap: 8px;
			padding: 0;
			scrollbar-width: none;
		}
		.card-tray::-webkit-scrollbar {
			display: none;
		}
		.hand-row {
			gap: 7px;
			padding-bottom: 8px;
		}
		.build-card {
			width: 116px;
			height: 174px;
		}
		.card-face {
			padding: 8px;
		}
		.card-title {
			font-size: var(--text-14);
		}
		.card-art {
			height: 56px;
		}
		.card-art-icon {
			width: 40px;
			height: 40px;
		}
		.card-rules {
			font-size: var(--text-8);
		}
	}

	@media (max-width: 620px) {
		.card-tray {
			left: 0;
			right: 0;
			bottom: 8px;
			transform: none;
			width: 100vw;
			max-width: 100vw;
			overflow-x: auto;
			overflow-y: hidden;
			justify-content: flex-start;
			gap: 7px;
			padding: 0 8px;
			pointer-events: auto;
			scrollbar-width: thin;
		}
		.hand-shell {
			min-width: max-content;
		}
		.hand-row {
			gap: 6px;
			padding-bottom: 6px;
			width: max-content;
		}
		.build-card {
			width: 98px;
			height: 150px;
		}
		.card-face {
			padding: 6px;
		}
		.card-banner {
			min-height: 22px;
			font-size: var(--text-5);
		}
		.card-cost {
			width: 25px;
			height: 28px;
			margin-top: -5px;
			margin-right: -4px;
			padding-top: 2px;
		}
		.card-cost b {
			font-size: var(--text-12);
		}
		.card-title {
			margin-bottom: 3px;
			font-size: var(--text-12);
		}
		.card-art {
			height: 44px;
			margin-bottom: 3px;
		}
		.card-art::before {
			width: 54px;
			height: 54px;
		}
		.card-art-icon {
			width: 32px;
			height: 32px;
		}
		.card-type {
			margin-bottom: 2px;
			padding-bottom: 2px;
			font-size: var(--text-5);
		}
		.card-rules {
			font-size: var(--text-2xs);
			line-height: 1.22;
		}
		.card-footer {
			display: none;
		}
	}

	@media (max-width: 480px) {
		.card-tray {
			gap: 6px;
		}
		.hand-row {
			gap: 4px;
		}
		.build-card {
			width: 82px;
			height: 132px;
		}
		.card-face {
			padding: 5px;
		}
		.card-banner {
			min-height: 19px;
			font-size: var(--text-4);
		}
		.card-cost {
			width: 22px;
			height: 25px;
			margin-top: -4px;
			margin-right: -3px;
		}
		.card-cost b {
			font-size: var(--text-10);
		}
		.card-title {
			font-size: var(--text-10);
			margin-bottom: 2px;
		}
		.card-art {
			height: 34px;
			margin-bottom: 2px;
		}
		.card-art::before {
			width: 40px;
			height: 40px;
		}
		.card-art-icon {
			width: 24px;
			height: 24px;
		}
		.card-type {
			font-size: var(--text-4);
			margin-bottom: 1px;
			padding-bottom: 1px;
		}
		.card-rules {
			font-size: var(--text-6);
			line-height: 1.18;
		}
	}
</style>
