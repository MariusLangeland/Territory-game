<script lang="ts">
	interface Copy {
		index: string | number;
		title: string;
		body: string;
	}
	interface Props {
		copy: Copy;
		onSkip: () => void;
	}
	let { copy, onSkip }: Props = $props();
</script>

<aside class="onboarding-hint hud" aria-live="polite">
	<div class="onboarding-meta">
		<span>FIRST MATCH / {copy.index}</span>
		<button type="button" onclick={onSkip} aria-label="Skip first-match hints">SKIP</button>
	</div>
	<h2>{copy.title}</h2>
	<p>{copy.body}</p>
</aside>

<style>
	.onboarding-hint {
		position: fixed;
		top: 94px;
		left: 50%;
		z-index: 26;
		width: min(430px, calc(100vw - 28px));
		padding: 13px 15px 14px;
		transform: translateX(-50%);
		background: rgba(9, 19, 23, 0.95);
		border: 1px solid rgba(220, 233, 149, 0.42);
		box-shadow: 0 16px 44px var(--alpha-black-42);
		backdrop-filter: blur(16px);
		animation: hint-in 220ms ease-out both;
	}

	.onboarding-meta {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		color: var(--ink-faint);
		font-size: var(--text-7);
		letter-spacing: 0.16em;
	}

	.onboarding-meta button {
		padding: 2px 0;
		background: none;
		border: 0;
		color: var(--ink-faint);
		font: inherit;
		letter-spacing: 0.16em;
		cursor: pointer;
	}

	.onboarding-meta button:hover {
		color: var(--ink);
	}

	.onboarding-hint h2 {
		margin: 7px 0 5px;
		color: var(--ink);
		font-size: var(--text-17);
		font-weight: 600;
		letter-spacing: 0.06em;
	}

	.onboarding-hint p {
		margin: 0;
		color: var(--ink-dim);
		font-size: var(--text-10);
		line-height: 1.45;
	}

	@media (max-width: 620px) {
		.onboarding-hint {
			top: 74px;
			padding: 11px 13px 12px;
		}
		.onboarding-hint h2 {
			font-size: var(--text-15);
		}
		.onboarding-hint p {
			font-size: var(--text-9);
		}
	}
</style>
