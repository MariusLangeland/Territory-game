<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import GameCanvas from '#lib/components/GameCanvas.svelte';
	import {
		BOT_BUCKETS,
		EvolutionSandbox,
		bucketCounts,
		bucketsFromReport,
		emptyBuckets,
		loadEvolutionBuckets,
		parseEvolutionCsv,
		saveEvolutionBuckets,
		serializeEvolutionCsv,
		type BotBucket,
		type EvolutionBuckets,
		type EvolutionConfig
	} from '#lib/game/ai';
	import { GameCameraBridge } from '#lib/game/render/camera-bridge';
	import type { GameSnapshot, TerritorySimulation } from '#lib/game/simulation';

	const SPEEDS = [
		{ label: '1×', steps: 1 },
		{ label: '4×', steps: 4 },
		{ label: '16×', steps: 16 },
		{ label: '48×', steps: 48 }
	] as const;

	let config = $state<EvolutionConfig>({
		seed: 1234,
		populationSize: 16,
		generations: 4,
		playerCount: 8,
		matchesPerRound: 2,
		ticks: 1600,
		width: 1280,
		height: 720,
		teamCount: 1
	});
	let sandbox = $state<EvolutionSandbox | null>(null);
	let currentSimulation = $state<TerritorySimulation | null>(null);
	let snapshot = $state<GameSnapshot | null>(null);
	let cameraBridge = new GameCameraBridge();
	let running = $state(false);
	let speed = $state(4);
	let matchKey = $state(0);
	let revision = $state(0);
	let status = $state('Configure a population and start natural selection.');
	let notice = $state('');
	let matchHandled = false;
	let pendingTimer: ReturnType<typeof setTimeout> | null = null;
	let fileInput: HTMLInputElement | null = null;
	let buckets = $state<EvolutionBuckets>(emptyBuckets());
	let selectedBuckets = $state<Record<BotBucket, boolean>>({
		poor: false,
		good: false,
		top: true
	});

	let rows = $derived.by(() => {
		void revision;
		return sandbox?.latestRows ?? [];
	});
	let archiveRows = $derived.by(() => {
		void revision;
		return Array.from(sandbox?.archive.values() ?? []).sort(
			(left, right) => right.fitness - left.fitness
		);
	});
	let progress = $derived.by(() => {
		void revision;
		return sandbox?.progress ?? { match: 0, matches: 0, generation: 0 };
	});
	let counts = $derived(bucketCounts(buckets));
	let phase = $derived.by(() => {
		void revision;
		return sandbox?.phase ?? 'idle';
	});

	function start(): void {
		stopTimer();
		const next = new EvolutionSandbox(config);
		next.begin();
		sandbox = next;
		currentSimulation = next.currentSimulation;
		running = true;
		matchHandled = false;
		snapshot = null;
		matchKey++;
		revision++;
		status = 'Generation 1 — natural selection in progress.';
	}

	function stopTimer(): void {
		if (pendingTimer !== null) {
			clearTimeout(pendingTimer);
			pendingTimer = null;
		}
	}

	function handleTick(nextSnapshot: GameSnapshot): void {
		snapshot = nextSnapshot;
		if (!nextSnapshot.ended || matchHandled || !sandbox) return;
		matchHandled = true;
		status = 'Match complete — scoring genomes…';
		pendingTimer = setTimeout(() => {
			pendingTimer = null;
			if (!sandbox) return;
			sandbox.finishMatch();
			if (sandbox.phase === 'generation-complete' || sandbox.phase === 'finished') {
				buckets = bucketsFromReport(sandbox.report());
				saveEvolutionBuckets(buckets);
			}
			revision++;
			if (sandbox.phase === 'finished') {
				running = false;
				status = 'Evolution complete. Buckets saved locally.';
				return;
			}
			sandbox.nextMatch();
			currentSimulation = sandbox.currentSimulation;
			matchKey++;
			matchHandled = false;
			status = `Generation ${sandbox.generation + 1} · match ${
				sandbox.currentMatchIndex + 1
			}/${sandbox.progress.matches || '?'}`;
			revision++;
		}, 650);
	}

	function toggleRunning(): void {
		if (!sandbox) {
			start();
			return;
		}
		running = !running;
	}

	function downloadCsv(): void {
		if (!sandbox) return;
		const csv = serializeEvolutionCsv(sandbox.report());
		const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = `territory-evolution-${sandbox.config.seed}.csv`;
		link.click();
		URL.revokeObjectURL(url);
		notice = 'Spreadsheet exported. Import it later to resume or inspect.';
	}

	async function importCsv(event: Event): Promise<void> {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		const genomes = parseEvolutionCsv(await file.text());
		input.value = '';
		if (genomes.length < 2) {
			notice = 'Could not find genomes in that CSV. Expected the exported header.';
			return;
		}
		const playerCount = Math.max(2, Math.min(config.playerCount, genomes.length));
		const next = new EvolutionSandbox({
			...config,
			playerCount,
			populationSize: Math.max(playerCount, genomes.length)
		});
		if (!next.setPopulation(genomes)) {
			notice = 'The spreadsheet needs at least as many genomes as players.';
			return;
		}
		sandbox = next;
		currentSimulation = next.currentSimulation;
		running = true;
		matchHandled = false;
		matchKey++;
		revision++;
		notice = `Imported ${genomes.length} genomes from spreadsheet.`;
		status = 'Imported population — running.';
	}

	function useBuckets(): void {
		const pool = BOT_BUCKETS.flatMap((bucket) => (selectedBuckets[bucket] ? buckets[bucket] : []));
		if (pool.length < 2) {
			notice = 'Select at least two bucket genomes (run an evolution first).';
			return;
		}
		const playerCount = Math.max(2, Math.min(config.playerCount, pool.length));
		const next = new EvolutionSandbox({
			...config,
			playerCount,
			populationSize: Math.max(playerCount, pool.length)
		});
		if (!next.setPopulation(pool)) return;
		sandbox = next;
		currentSimulation = next.currentSimulation;
		running = true;
		matchHandled = false;
		matchKey++;
		revision++;
		notice = `Loaded ${pool.length} genomes from selected buckets.`;
	}

	function selectAll(bucket: BotBucket, enabled: boolean): void {
		selectedBuckets = { ...selectedBuckets, [bucket]: enabled };
	}

	function navigateHome(): void {
		window.location.href = '/?seed=1234';
	}

	onMount(() => {
		buckets = loadEvolutionBuckets();
	});

	onDestroy(() => {
		stopTimer();
		cameraBridge.detach();
	});
</script>

<svelte:head>
	<title>Territory — Evolution Lab</title>
</svelte:head>

<div class="lab">
	<header class="lab-header">
		<button class="back" type="button" onclick={navigateHome}>← FRONTIER</button>
		<div class="title-block">
			<span class="eyebrow">NATURAL SELECTION SANDBOX</span>
			<h1>EVOLUTION LAB</h1>
			<p>Genomes are matched, scored, pruned, crossed, and mutated. Buckets feed difficulty.</p>
		</div>
		<div class="status-block">
			<span class:live={running} class="live-dot"></span>
			<span>{status}</span>
			<span class="phase">{phase.toUpperCase()}</span>
		</div>
	</header>

	<main class="lab-body">
		<section class="viewport">
			{#if currentSimulation}
				{#key matchKey}
					<GameCanvas
						simulation={currentSimulation}
						paused={!running}
						{cameraBridge}
						speedMultiplier={speed}
						maxStepsPerFrame={Math.max(4, speed * 2)}
						cameraFocus="map"
						onTick={handleTick}
					/>
				{/key}
			{:else}
				<div class="empty">
					<span>NO ACTIVE MATCH</span>
					<p>Start a run to watch evolved genomes fight for land.</p>
				</div>
			{/if}
			<div class="spectator-hud">
				<div class="stat">
					<span>GEN</span><strong>{progress.generation || '—'}</strong>
				</div>
				<div class="stat">
					<span>MATCH</span><strong>{progress.match || '—'}/{progress.matches || '—'}</strong>
				</div>
				<div class="stat">
					<span>POP</span><strong>{sandbox?.population.length ?? config.populationSize}</strong>
				</div>
				<div class="speed-row">
					{#each SPEEDS as option (option.steps)}
						<button
							class:active={speed === option.steps}
							type="button"
							onclick={() => (speed = option.steps)}
						>
							{option.label}
						</button>
					{/each}
					<button class="play" type="button" onclick={toggleRunning}>
						{running ? 'PAUSE' : 'PLAY'}
					</button>
				</div>
			</div>
		</section>

		<aside class="side">
			<section class="panel">
				<h2>Run setup</h2>
				<div class="fields">
					<label><span>SEED</span><input type="number" bind:value={config.seed} /></label>
					<label>
						<span>POPULATION</span><input
							type="number"
							min="4"
							max="64"
							bind:value={config.populationSize}
						/>
					</label>
					<label>
						<span>GENERATIONS</span><input
							type="number"
							min="1"
							max="50"
							bind:value={config.generations}
						/>
					</label>
					<label>
						<span>PLAYERS</span><input
							type="number"
							min="2"
							max="51"
							bind:value={config.playerCount}
						/>
					</label>
					<label>
						<span>MATCHES / ROUND</span><input
							type="number"
							min="1"
							max="8"
							bind:value={config.matchesPerRound}
						/>
					</label>
					<label>
						<span>TICKS / MATCH</span><input
							type="number"
							min="200"
							max="30000"
							step="100"
							bind:value={config.ticks}
						/>
					</label>
					<label>
						<span>TEAM AI</span><input
							type="number"
							min="1"
							max="8"
							bind:value={config.teamCount}
						/>
					</label>
				</div>
				<button class="primary" type="button" onclick={start}>START EVOLUTION</button>
				<p class="hint">
					Fitness = land + income + attack + wins + survival +
					economy/defense/naval/aggression/cooperation. TEAM AI 1 = free-for-all.
				</p>
			</section>

			<section class="panel">
				<h2>Spreadsheet</h2>
				<div class="button-row">
					<button type="button" onclick={downloadCsv} disabled={!sandbox}>EXPORT CSV</button>
					<button type="button" onclick={() => fileInput?.click()}>IMPORT CSV</button>
				</div>
				<input
					bind:this={fileInput}
					class="hidden-file"
					type="file"
					accept=".csv,text/csv"
					onchange={importCsv}
				/>
				<p class="hint">
					The exported sheet contains each genome’s traits, module weights, bucket, and fitness.
					Re-import it to run those bots again.
				</p>
			</section>

			<section class="panel">
				<h2>Performance buckets</h2>
				<div class="buckets">
					{#each BOT_BUCKETS as bucket (bucket)}
						<div class="bucket">
							<label>
								<input
									type="checkbox"
									checked={selectedBuckets[bucket]}
									onchange={(event) =>
										selectAll(bucket, (event.currentTarget as HTMLInputElement).checked)}
								/>
								<span class={`bucket-name ${bucket}`}>{bucket.toUpperCase()}</span>
							</label>
							<strong>{counts[bucket]}</strong>
						</div>
					{/each}
				</div>
				<button
					type="button"
					onclick={useBuckets}
					disabled={counts.poor + counts.good + counts.top === 0}
				>
					RUN WITH SELECTED BUCKETS
				</button>
				<p class="hint">
					Relaxed difficulty uses poor, standard good, ruthless top. Finished buckets are saved
					locally and used by the main match setup. QD archive: {archiveRows.length} strategy descriptors.
				</p>
			</section>
		</aside>
	</main>

	<section class="results">
		<div class="results-head">
			<h2>GENOME PERFORMANCE</h2>
			{#if notice}<span class="notice">{notice}</span>{/if}
			<button type="button" onclick={downloadCsv} disabled={!sandbox}>DOWNLOAD SPREADSHEET</button>
		</div>
		<div class="table-wrap">
			<table>
				<thead>
					<tr>
						<th>#</th><th>GENOME</th><th>GEN</th><th>BUCKET</th><th>DESCRIPTOR</th><th>FITNESS</th>
						<th>LAND</th><th>INCOME</th><th>ECO</th><th>DEF</th><th>NAV</th><th>ATT</th><th>
							COOP
						</th><th>WINS</th>
						<th>MODULES (INC/DEF/DET/OPP/EXP/RET)</th>
					</tr>
				</thead>
				<tbody>
					{#each rows.slice(0, 24) as row, index (row.genome.id)}
						<tr>
							<td>{index + 1}</td>
							<td class="mono">{row.genome.id}</td>
							<td>{row.genome.generation}</td>
							<td><span class={`pill ${row.bucket}`}>{row.bucket}</span></td>
							<td class="mono">{row.descriptor}</td>
							<td>{row.fitness.toFixed(1)}</td>
							<td>{(row.landShare * 100).toFixed(2)}%</td>
							<td>{row.income.toFixed(1)}/s</td>
							<td>{row.economy.toFixed(1)}</td>
							<td>{row.defense.toFixed(1)}</td>
							<td>{row.naval.toFixed(1)}</td>
							<td>{Math.round(row.aggression)}</td>
							<td>{Math.round(row.cooperation)}</td>
							<td>{row.wins}</td>
							<td class="mono modules">
								{Math.round(row.genome.modules.income)}/{Math.round(
									row.genome.modules.defense
								)}/{Math.round(row.genome.modules.deterrence)}/{Math.round(
									row.genome.modules.opportunity
								)}/{Math.round(row.genome.modules.expansion)}/{Math.round(
									row.genome.modules.retaliation
								)}
							</td>
						</tr>
					{/each}
					{#if rows.length === 0}
						<tr>
							<td colspan="15" class="empty-row">
								No scores yet. Start a run and finish at least one match.
							</td>
						</tr>
					{/if}
				</tbody>
			</table>
		</div>
	</section>
</div>

<style>
	.lab {
		min-height: 100vh;
		background: #050b0e;
		color: #f7eed0;
		font-family: 'IBM Plex Mono', 'Cascadia Mono', monospace;
		display: flex;
		flex-direction: column;
	}
	.lab-header {
		display: flex;
		align-items: center;
		gap: 18px;
		padding: 12px 18px;
		border-bottom: 1px solid rgba(247, 238, 208, 0.12);
		background: linear-gradient(180deg, #071216, #050b0e);
	}
	.back,
	.lab button {
		background: transparent;
		border: 1px solid rgba(247, 238, 208, 0.22);
		color: #f7eed0;
		font: inherit;
		font-size: 10px;
		letter-spacing: 0.08em;
		padding: 7px 10px;
		cursor: pointer;
	}
	.lab button:hover:not(:disabled) {
		border-color: #f3b74d;
		color: #f3b74d;
	}
	.lab button:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.title-block h1 {
		margin: 0;
		font-size: 22px;
		letter-spacing: 0.14em;
	}
	.eyebrow {
		font-size: 9px;
		letter-spacing: 0.24em;
		color: #58c7e8;
	}
	.title-block p {
		margin: 3px 0 0;
		font-size: 10px;
		color: rgba(247, 238, 208, 0.55);
	}
	.status-block {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 9px;
		font-size: 10px;
		color: rgba(247, 238, 208, 0.72);
	}
	.phase {
		color: #58c7e8;
	}
	.live-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: #d05d52;
	}
	.live-dot.live {
		background: #73c88f;
		box-shadow: 0 0 8px #73c88f;
	}
	.lab-body {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 320px;
		gap: 12px;
		padding: 12px;
		min-height: 420px;
	}
	.viewport {
		position: relative;
		min-height: 440px;
		border: 1px solid rgba(247, 238, 208, 0.12);
		background: #03080a;
		overflow: hidden;
	}
	.empty {
		position: absolute;
		inset: 0;
		display: grid;
		place-content: center;
		text-align: center;
		color: rgba(247, 238, 208, 0.5);
		font-size: 11px;
		letter-spacing: 0.14em;
	}
	.spectator-hud {
		position: absolute;
		left: 10px;
		bottom: 10px;
		display: flex;
		align-items: center;
		gap: 12px;
		background: rgba(3, 8, 10, 0.82);
		border: 1px solid rgba(247, 238, 208, 0.15);
		padding: 8px 10px;
	}
	.stat {
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: 9px;
		color: rgba(247, 238, 208, 0.5);
	}
	.stat strong {
		font-size: 13px;
		color: #f7eed0;
	}
	.speed-row {
		display: flex;
		gap: 4px;
		margin-left: 10px;
	}
	.speed-row button.active,
	.play {
		border-color: #f3b74d;
		color: #f3b74d;
	}
	.side {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.panel {
		border: 1px solid rgba(247, 238, 208, 0.12);
		background: rgba(7, 18, 22, 0.8);
		padding: 10px;
	}
	.panel h2,
	.results h2 {
		margin: 0 0 8px;
		font-size: 10px;
		letter-spacing: 0.18em;
		color: #58c7e8;
	}
	.fields {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 6px;
	}
	.fields label {
		display: flex;
		flex-direction: column;
		gap: 3px;
		font-size: 9px;
		color: rgba(247, 238, 208, 0.55);
	}
	.fields input {
		background: #03080a;
		border: 1px solid rgba(247, 238, 208, 0.18);
		color: #f7eed0;
		font: inherit;
		font-size: 11px;
		padding: 5px 6px;
		min-width: 0;
	}
	.primary {
		width: 100%;
		margin-top: 9px;
		background: #f3b74d !important;
		border-color: #f3b74d !important;
		color: #050b0e !important;
		font-weight: 700;
	}
	.hint {
		margin: 7px 0 0;
		font-size: 9px;
		line-height: 1.45;
		color: rgba(247, 238, 208, 0.45);
	}
	.button-row {
		display: flex;
		gap: 6px;
	}
	.button-row button {
		flex: 1;
	}
	.hidden-file {
		display: none;
	}
	.buckets {
		display: flex;
		flex-direction: column;
		gap: 5px;
	}
	.bucket {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: 10px;
	}
	.bucket label {
		display: flex;
		align-items: center;
		gap: 7px;
	}
	.bucket-name.top {
		color: #73c88f;
	}
	.bucket-name.good {
		color: #58c7e8;
	}
	.bucket-name.poor {
		color: #d05d52;
	}
	.results {
		margin: 0 12px 12px;
		border: 1px solid rgba(247, 238, 208, 0.12);
		background: rgba(7, 18, 22, 0.8);
	}
	.results-head {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 9px 10px;
		border-bottom: 1px solid rgba(247, 238, 208, 0.1);
	}
	.results-head h2 {
		margin: 0;
	}
	.notice {
		font-size: 9px;
		color: #73c88f;
	}
	.results-head button {
		margin-left: auto;
	}
	.table-wrap {
		max-height: 280px;
		overflow: auto;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 9px;
	}
	th {
		position: sticky;
		top: 0;
		background: #071216;
		color: rgba(247, 238, 208, 0.5);
		text-align: left;
		padding: 6px 8px;
		font-weight: 500;
		letter-spacing: 0.06em;
	}
	td {
		padding: 5px 8px;
		border-top: 1px solid rgba(247, 238, 208, 0.06);
		color: rgba(247, 238, 208, 0.82);
	}
	.mono {
		font-family: inherit;
	}
	.modules {
		color: rgba(88, 199, 232, 0.8);
	}
	.pill {
		padding: 1px 5px;
		border: 1px solid currentColor;
		font-size: 8px;
		text-transform: uppercase;
	}
	.pill.top {
		color: #73c88f;
	}
	.pill.good {
		color: #58c7e8;
	}
	.pill.poor {
		color: #d05d52;
	}
	.empty-row {
		text-align: center;
		color: rgba(247, 238, 208, 0.35);
		padding: 24px;
	}
	@media (max-width: 980px) {
		.lab-body {
			grid-template-columns: 1fr;
		}
		.viewport {
			min-height: 340px;
		}
	}
</style>
