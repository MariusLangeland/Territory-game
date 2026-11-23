<script lang="ts">
	import type { StructureContextMenu } from '#lib/game/ui/structure-menu';

	interface Props {
		menu: StructureContextMenu;
		paused: boolean;
		menuElement?: HTMLElement | null;
		diplomacyRemaining: (expiresAtTick: number | null) => string;
		onRequestDemolish: () => void;
		onCancelDemolish: () => void;
		onConfirmDemolish: () => void;
		onRequestAlliance: () => void;
		onBreakAlliance: () => void;
		onClose: () => void;
	}

	let {
		menu,
		paused,
		menuElement = $bindable(null),
		diplomacyRemaining,
		onRequestDemolish,
		onCancelDemolish,
		onConfirmDemolish,
		onRequestAlliance,
		onBreakAlliance,
		onClose
	}: Props = $props();
</script>

<div
	class="context-menu"
	bind:this={menuElement}
	role="menu"
	tabindex="-1"
	aria-label={menu.structureId !== null ? `${menu.typeLabel} actions` : 'Rival territory actions'}
	style={`left:${menu.x}px;top:${menu.y}px`}
	oncontextmenu={(event) => event.preventDefault()}
	onpointerdown={(event) => event.stopPropagation()}
>
	{#if menu.confirmingDemolish}
		<div class="context-info context-info-warning">
			<span>CONFIRM DEMOLITION</span>
			<small>{menu.typeLabel} · LV.{menu.stacks} · NO REFUND</small>
		</div>
		<button
			type="button"
			class="context-item context-demolish context-confirm"
			role="menuitem"
			aria-label={`Confirm demolition of ${menu.typeLabel} level ${menu.stacks}. No refund.`}
			onclick={onConfirmDemolish}
		>
			<span>CONFIRM / DEMOLISH</span>
			<small>NO REFUND · PERMANENT</small>
		</button>
		<button
			type="button"
			class="context-item"
			role="menuitem"
			aria-label="Back to structure actions"
			onclick={onCancelDemolish}
		>
			<span>BACK</span>
			<small>RETURN TO ACTIONS</small>
		</button>
	{:else}
		{#if menu.structureId !== null}
			<div class="context-info">
				<span>{menu.typeLabel} · LV.{menu.stacks}</span>
				{#if menu.allianceOwnerId !== null}
					<small>{menu.allianceName} · RIVAL STRUCTURE</small>
				{:else}
					<small>YOUR STRUCTURE</small>
				{/if}
				{#if menu.isState}<small>CAPITAL · CANNOT BE DEMOLISHED</small>{/if}
			</div>
			<button
				type="button"
				class="context-item context-demolish"
				role="menuitem"
				disabled={!menu.isOwn || menu.isState || paused}
				aria-label={`Demolish ${menu.typeLabel} level ${menu.stacks}`}
				title={!menu.isOwn
					? 'You can only demolish your own structures.'
					: menu.isState
						? 'The State structure cannot be demolished.'
						: paused
							? 'Resume the simulation first.'
							: 'Remove this structure. No supply refund.'}
				onclick={onRequestDemolish}
			>
				<span>DEMOLISH STRUCTURE</span>
				<small>
					{menu.typeLabel} · LV.{menu.stacks}
					{menu.isState ? ' · CAPITAL' : !menu.isOwn ? ' · RIVAL' : ' · NO REFUND'}
				</small>
			</button>
		{:else if menu.allianceOwnerId !== null}
			<div class="context-info">
				<span>RIVAL TERRITORY</span>
				<small>{menu.allianceName}</small>
			</div>
		{/if}
		{#if menu.allianceOwnerId !== null}
			{#if menu.allianceStatus === 'active'}
				<button
					type="button"
					class="context-item context-alliance"
					role="menuitem"
					aria-label={`Break alliance with ${menu.allianceName}`}
					title={`Alliance expires in ${diplomacyRemaining(menu.allianceExpiresAtTick)}`}
					onclick={onBreakAlliance}
				>
					<span>BREAK ALLIANCE</span>
					<small>
						{menu.allianceName} · ACTIVE · {diplomacyRemaining(menu.allianceExpiresAtTick)} LEFT
					</small>
				</button>
			{:else if menu.allianceStatus === 'pending'}
				<button
					type="button"
					class="context-item context-alliance"
					role="menuitem"
					disabled
					aria-label={`Alliance request with ${menu.allianceName} pending`}
					title={`Bot response window: ${diplomacyRemaining(menu.allianceExpiresAtTick)}`}
				>
					<span>ALLIANCE PENDING</span>
					<small>
						{menu.allianceName} · AWAITING RESPONSE ·
						{diplomacyRemaining(menu.allianceExpiresAtTick)} LEFT
					</small>
				</button>
			{:else if menu.allianceStatus === 'busy'}
				<button
					type="button"
					class="context-item context-alliance"
					role="menuitem"
					disabled
					aria-label={`Diplomatic commitment with ${menu.allianceName} unavailable`}
				>
					<span>ALLIANCE UNAVAILABLE</span>
					<small>{menu.allianceName} · ALREADY COMMITTED</small>
				</button>
			{:else}
				<button
					type="button"
					class="context-item context-alliance"
					role="menuitem"
					aria-label={`Request alliance with ${menu.allianceName}`}
					onclick={onRequestAlliance}
				>
					<span>REQUEST ALLIANCE</span>
					<small>{menu.allianceName} · SEND REQUEST</small>
				</button>
			{/if}
		{/if}
		<div class="context-divider"></div>
		<button
			type="button"
			class="context-item"
			role="menuitem"
			aria-label="Close menu"
			onclick={onClose}
		>
			<span>CANCEL</span>
		</button>
	{/if}
</div>

<style>
	.context-menu {
		position: fixed;
		z-index: 140;
		width: 264px;
		max-height: calc(100vh - 16px);
		overflow-y: auto;
		padding: 6px;
		border: 1px solid var(--line-strong);
		background: rgba(4, 12, 16, 0.97);
		box-shadow:
			0 18px 42px var(--alpha-black-55),
			inset 0 1px 0 rgba(255, 255, 255, 0.04);
		font-family: var(--font-mono);
		backdrop-filter: blur(12px);
	}

	.context-item {
		display: grid;
		gap: 3px;
		width: 100%;
		padding: 9px 10px;
		border: 1px solid transparent;
		background: transparent;
		color: var(--ink-dim);
		font-family: var(--font-mono);
		font-size: var(--text-10);
		font-weight: 700;
		letter-spacing: 0.08em;
		text-align: left;
		text-transform: uppercase;
		cursor: pointer;
	}

	.context-item:hover:not(:disabled) {
		border-color: var(--signal-35);
		background: var(--alpha-white-05);
		color: var(--ink);
		outline: none;
	}

	.context-item:focus-visible:not(:disabled) {
		border-color: var(--signal-35);
		background: var(--alpha-white-05);
		color: var(--ink);
		outline: none;
	}

	.context-item:focus:not(:disabled) {
		border-color: var(--signal-35);
		background: var(--alpha-white-05);
		color: var(--ink);
		outline: none;
	}

	.context-item:disabled {
		cursor: not-allowed;
		opacity: 0.42;
	}

	.context-item small {
		font-size: var(--text-7);
		font-weight: 500;
		letter-spacing: 0.05em;
		color: var(--ink-faint);
	}

	.context-info {
		display: grid;
		gap: 2px;
		padding: 8px 10px 9px;
		margin-bottom: 2px;
		border-bottom: 1px solid var(--line-soft);
		pointer-events: none;
	}

	.context-info span {
		font-size: var(--text-9);
		font-weight: 700;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: var(--ink-dim);
	}

	.context-info small {
		font-size: var(--text-7);
		font-weight: 500;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--ink-faint);
	}

	.context-info-warning span {
		color: var(--danger-strong);
	}

	.context-info-warning small {
		color: rgba(255, 176, 159, 0.72);
	}

	.context-confirm:not(:disabled) {
		border-color: rgba(255, 120, 103, 0.42);
		background: rgba(255, 120, 103, 0.14);
		color: var(--danger-soft);
	}

	.context-demolish:not(:disabled) {
		color: var(--danger-strong);
	}

	.context-demolish:hover:not(:disabled) {
		border-color: var(--danger-45);
		background: var(--danger-11);
		color: var(--danger-soft);
	}

	.context-demolish:focus-visible:not(:disabled) {
		border-color: var(--danger-45);
		background: var(--danger-11);
		color: var(--danger-soft);
	}

	.context-demolish:focus:not(:disabled) {
		border-color: var(--danger-45);
		background: var(--danger-11);
		color: var(--danger-soft);
	}

	.context-alliance:hover {
		border-color: var(--success-42);
		background: var(--success-10);
		color: var(--success);
	}

	.context-alliance:focus-visible {
		border-color: var(--success-42);
		background: var(--success-10);
		color: var(--success);
	}

	.context-alliance:focus {
		border-color: var(--success-42);
		background: var(--success-10);
		color: var(--success);
	}

	.context-divider {
		height: 1px;
		margin: 5px 4px;
		background: var(--line-soft);
	}
</style>
