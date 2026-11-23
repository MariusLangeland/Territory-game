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
		font-size: 9px;
		line-height: 1.5;
		letter-spacing: 0.03em;
		box-shadow: 0 14px 38px rgba(0, 0, 0, 0.45);
		animation: hud-in 180ms ease-out both;
	}
	.diplomacy-toast.warn {
		border-color: rgba(255, 208, 120, 0.46);
		border-left-color: #ffd078;
	}
	.diplomacy-toast.error {
		border-color: rgba(255, 120, 103, 0.5);
		border-left-color: #ff7867;
	}
</style>
