<script lang="ts">
	interface Props {
		message: string;
		onReload: () => void;
	}
	let { message, onReload }: Props = $props();
</script>

<div
	class="overlay error-overlay"
	role="alertdialog"
	aria-modal="true"
	aria-labelledby="error-title"
>
	<article class="modal error-modal">
		<p class="overlay-kicker">RENDERER OFFLINE</p>
		<h2 id="error-title">WEBGPU<br /><em>UNAVAILABLE.</em></h2>
		<p>
			This prototype draws its territory map directly with WebGPU. The browser could not start a
			compatible graphics device.
		</p>
		<pre>{message}</pre>
		<p class="error-hint">
			Try a current Chromium-based browser with hardware acceleration enabled, or check <a
				href="https://caniuse.com/webgpu"
				target="_blank"
				rel="noreferrer"
			>
				WebGPU support
			</a>.
		</p>
		<div class="modal-actions">
			<button class="deploy-button" type="button" onclick={onReload}><span>RELOAD</span></button>
		</div>
	</article>
</div>

<style>
	.error-modal::before {
		content: '';
		position: absolute;
		top: -1px;
		left: -1px;
		width: 18px;
		height: 18px;
		border-top: 1px solid var(--signal);
		border-left: 1px solid var(--signal);
	}
	.error-modal {
		max-width: 590px;
	}
	.error-modal h2 {
		color: var(--danger);
	}
	.error-modal h2 em {
		-webkit-text-stroke-color: rgba(255, 120, 103, 0.8);
	}
	.error-modal pre {
		padding: 13px;
		border: 1px solid rgba(255, 120, 103, 0.22);
		background: rgba(255, 120, 103, 0.055);
		white-space: pre-wrap;
		font-family: var(--font-mono);
		font-size: 10px;
		line-height: 1.5;
		color: #ffb3a5;
	}
	.error-hint {
		font-size: 11px !important;
		color: var(--ink-faint) !important;
	}
	.error-hint a {
		color: var(--signal);
	}
</style>
