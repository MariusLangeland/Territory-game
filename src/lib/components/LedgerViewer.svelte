<script lang="ts">
	import type { LedgerBlock } from '#lib/game/ledger/agent';

	interface Props {
		blocks: LedgerBlock[];
		currentTick: number;
		onSeek: (tick: number) => void;
	}
	let { blocks, currentTick, onSeek }: Props = $props();

	let selectedTick = $derived.by(() => {
		let selected: number | null = null;
		for (const block of blocks) {
			if (block.tick <= currentTick) selected = block.tick;
			else break;
		}
		return selected;
	});
</script>

<section class="ledger-viewer" aria-label="Ledger blocks">
	<header>
		<span>LEDGER BLOCKS</span>
		<span>{blocks.length} BLOCKS</span>
	</header>
	<div class="ledger-list">
		{#if blocks.length === 0}
			<p class="ledger-empty">No transaction blocks in this ledger.</p>
		{/if}
		{#each blocks as block}
			<button
				type="button"
				class="ledger-row"
				class:selected={block.tick === selectedTick}
				onclick={() => onSeek(block.tick)}
			>
				<span class="block-index">#{block.index}</span>
				<span class="block-tick">T{block.tick}</span>
				<span class="block-transactions">
					{block.transactions.length} TX
					{#each block.transactions.slice(0, 3) as transaction}
						· P{transaction.playerId} {transaction.intent.type}
					{/each}
					{#if block.transactions.length > 3}…{/if}
				</span>
				<span class="block-checksum">{block.checksum === null ? 'OPEN' : 'SEALED'}</span>
			</button>
		{/each}
	</div>
</section>

<style>
	.ledger-viewer {
		display: flex;
		flex-direction: column;
		min-height: 0;
		border-top: 1px solid var(--line-soft);
	}

	.ledger-viewer header {
		display: flex;
		justify-content: space-between;
		padding: 4px 0;
		color: var(--ink-faint);
		font-family: var(--font-mono);
		font-size: var(--text-8);
		letter-spacing: 0.12em;
	}

	.ledger-list {
		overflow-y: auto;
		min-height: 48px;
		max-height: 112px;
	}

	.ledger-empty {
		margin: 8px 0;
		color: var(--ink-faint);
		font-family: var(--font-mono);
		font-size: var(--text-8);
	}

	.ledger-row {
		display: grid;
		grid-template-columns: 44px 44px 1fr auto;
		gap: 8px;
		width: 100%;
		padding: 2px 4px;
		border: 0;
		border-left: 2px solid transparent;
		background: none;
		color: var(--ink-dim);
		font-family: var(--font-mono);
		font-size: var(--text-8);
		text-align: left;
		cursor: pointer;
	}

	.ledger-row:hover {
		background: var(--alpha-white-035);
		color: var(--ink);
	}

	.ledger-row.selected {
		border-left-color: var(--signal);
		background: color-mix(in srgb, var(--signal) 10%, transparent);
		color: var(--ink);
	}

	.block-index,
	.block-tick {
		color: var(--ink-faint);
	}

	.block-transactions {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.block-checksum {
		color: var(--ink-faint);
		font-size: var(--text-8);
	}
</style>
