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
