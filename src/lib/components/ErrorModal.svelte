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
