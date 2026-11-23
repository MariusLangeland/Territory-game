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
