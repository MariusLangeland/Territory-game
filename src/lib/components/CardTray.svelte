<script lang="ts">
	import { flip } from 'svelte/animate';
	import { fly } from 'svelte/transition';
	import {
		STRUCTURE_ACCENTS,
		STRUCTURE_DEFINITIONS,
		type BuildableStructureType,
		type PublicCard
	} from '#lib/game/Structures';
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
