<script lang="ts">
	interface Props {
		message: string;
		tone: 'success' | 'warn' | 'error';
	}
	let { message, tone }: Props = $props();
</script>

<div
	class="diplomacy-toast"
	class:warn={tone === 'warn'}
	class:error={tone === 'error'}
	role="status"
>
	{message}
</div>

<style>
	.diplomacy-toast {
		position: fixed;
		top: 78px;
		left: 50%;
		z-index: 42;
		transform: translateX(-50%);
		max-width: min(420px, calc(100vw - 28px));
		padding: 9px 14px;
		border: 1px solid rgba(61, 219, 217, 0.46);
		border-left: 3px solid var(--signal);
		background: rgba(4, 13, 18, 0.94);
		backdrop-filter: blur(14px);
		color: var(--ink);
		font-family: var(--font-mono);
		font-size: var(--text-9);
		line-height: 1.5;
		letter-spacing: 0.03em;
		box-shadow: 0 14px 38px var(--alpha-black-45);
		animation: hud-in 180ms ease-out both;
	}
	.diplomacy-toast.warn {
		border-color: rgba(255, 208, 120, 0.46);
		border-left-color: var(--warning);
	}
	.diplomacy-toast.error {
		border-color: var(--danger-50);
		border-left-color: var(--danger);
	}
</style>
