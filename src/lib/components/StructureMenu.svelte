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
