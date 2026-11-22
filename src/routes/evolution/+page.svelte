<script lang="ts">
	import { onMount } from 'svelte';
	import GameCanvas from '#lib/components/GameCanvas.svelte';
	import FitnessWeightsEditor from '#lib/components/FitnessWeightsEditor.svelte';
	import MarkovGraph from '#lib/components/MarkovGraph.svelte';
	import { RemoteEvolutionSimulation } from '#lib/game/ai/evolution-view';
	import type {
		EvolutionWorkerCommand,
		EvolutionWorkerMessage,
		WorkerEvolutionState,
		WorkerVisual
	} from '#lib/game/ai/evolution-worker-protocol';
	import {
		BOT_BUCKETS,
		DEFAULT_FITNESS_WEIGHTS,
		bucketCounts,
		bucketsFromReport,
		emptyBuckets,
		loadEvolutionBuckets,
		parseEvolutionCsv,
		saveEvolutionBuckets,
		serializeEvolutionCsv,
		type BotBucket,
		type BotGenome,
		type EvolutionBuckets,
		type EvolutionConfig,
		type EvolutionReport,
		type GenomePerformance
	} from '#lib/game/ai';
	import { GameCameraBridge } from '#lib/game/render/camera-bridge';
	import type { GameSnapshot, TerritorySimulation } from '#lib/game/simulation';

	const SPEEDS = [
		{ label: '1×', steps: 1 },
		{ label: '4×', steps: 4 },
		{ label: '16×', steps: 16 },
		{ label: '48×', steps: 48 },
		{ label: '120×', steps: 120 },
		{ label: '480×', steps: 480 },
		{ label: '1000×', steps: 1000 }
	] as const;

	interface RemoteVisual {
		revision: number;
		tick: number;
		snapshot: GameSnapshot;
		changes: Uint32Array;
		changeCount: number;
		overflow: boolean;
		districtTiles: number[];
	}

	let config = $state<EvolutionConfig>({
		seed: 1234,
		populationSize: 16,
		generations: 4,
		playerCount: 8,
		matchesPerRound: 2,
		ticks: 1600,
		width: 1280,
		height: 720,
		teamCount: 1,
		lineageDuels: true,
		fitnessWeights: { ...DEFAULT_FITNESS_WEIGHTS }
	});
	let worker: Worker | null = null;
	let started = $state(false);
	let phase = $state<'idle' | 'match' | 'generation-complete' | 'finished'>('idle');
	let generation = $state(0);
	let progress = $state({ match: 0, matches: 0, generation: 0 });
	let currentSeats = $state<BotGenome[]>([]);
	let population = $state<BotGenome[]>([]);
	let rows = $state<GenomePerformance[]>([]);
	let archiveRows = $state<GenomePerformance[]>([]);
	let markovStates = $state<(number | null)[]>([]);
	let lastReport = $state<EvolutionReport | null>(null);
	let remoteView = $state<RemoteEvolutionSimulation | null>(null);
	let remoteVisual = $state<RemoteVisual | null>(null);
	let snapshot = $state<GameSnapshot | null>(null);
	let cameraBridge = new GameCameraBridge();
	let running = $state(false);
	let speed = $state(4);
	let matchKey = $state(0);
	let activeMatchId = -1;
	let visualRevision = 0;
	let status = $state('Configure a population and start natural selection.');
	let notice = $state('');
	let fileInput: HTMLInputElement | null = null;
	let buckets = $state<EvolutionBuckets>(emptyBuckets());
	let selectedBuckets = $state<Record<BotBucket, boolean>>({
		poor: false,
		good: false,
		top: true
	});
	let selectedGenomeId = $state<string | null>(null);

	let counts = $derived(bucketCounts(buckets));
	let selectedOwnerId = $derived.by(() => {
		if (!selectedGenomeId) return null;
		const seat = currentSeats.findIndex((genome) => genome.id === selectedGenomeId);
		return seat >= 0 ? seat + 1 : null;
	});
	let selectedGenome = $derived.by<BotGenome | null>(() => {
		if (!selectedGenomeId) return null;
		return (
			population.find((genome) => genome.id === selectedGenomeId) ??
			currentSeats.find((genome) => genome.id === selectedGenomeId) ??
			rows.find((row) => row.genome.id === selectedGenomeId)?.genome ??
			null
		);
	});
	let selectedMarkovState = $derived.by(() => {
		if (!selectedOwnerId) return null;
		return markovStates[selectedOwnerId - 1] ?? null;
	});

	function send(command: EvolutionWorkerCommand): void {
		worker?.postMessage(command);
	}

	function applyState(state: WorkerEvolutionState): void {
		phase = state.phase;
		generation = state.generation;
		progress = state.progress;
		currentSeats = state.seats;
		population = state.population;
		rows = state.rows;
		archiveRows = state.archiveRows;
		markovStates = state.markovStates;
		started = true;
		if (state.report) {
			lastReport = state.report;
			buckets = bucketsFromReport(state.report);
			saveEvolutionBuckets(buckets);
		}
		if (!selectedGenomeId && currentSeats.length > 0) selectedGenomeId = currentSeats[0].id;
		if (phase === 'finished') {
			running = false;
			status = 'Evolution complete. Buckets saved locally.';
		} else if (phase === 'generation-complete') {
			status = `Generation ${generation + 1} complete — preparing next generation…`;
		} else if (phase === 'match') {
			status = `Generation ${generation + 1} · match ${progress.match}/${progress.matches || '?'}`;
		}
	}

	function handleMessage(message: EvolutionWorkerMessage): void {
		switch (message.type) {
			case 'state':
				applyState(message.state);
				break;
			case 'match':
				activeMatchId = message.matchId;
				remoteView = new RemoteEvolutionSimulation(message.init);
				snapshot = message.init.snapshot;
				remoteVisual = null;
				matchKey++;
				break;
			case 'visual': {
				if (!remoteView || message.visual.matchId !== activeMatchId) return;
				const visual: WorkerVisual = message.visual;
				remoteView.applyVisual(visual);
				snapshot = visual.snapshot;
				markovStates = visual.markovStates;
				remoteVisual = {
					revision: ++visualRevision,
					tick: visual.tick,
					snapshot: visual.snapshot,
					changes: visual.changes,
					changeCount: visual.changeCount,
					overflow: visual.overflow,
					districtTiles: visual.districtTiles
				};
				break;
			}
			case 'error':
				notice = message.message;
				running = false;
				status = 'Evolution worker stopped.';
				break;
		}
	}

	function connectWorker(): Worker {
		const instance = new Worker(new URL('../../lib/game/ai/evolution.worker.ts', import.meta.url), {
			type: 'module'
		});
		instance.onmessage = (event: MessageEvent<EvolutionWorkerMessage>) => handleMessage(event.data);
		instance.onerror = (event) => {
			notice = event.message || 'Evolution worker failed to start.';
			running = false;
			status = 'Evolution worker error.';
		};
		return instance;
	}

	function start(): void {
		selectedGenomeId = null;
		notice = '';
		lastReport = null;
		rows = [];
		archiveRows = [];
		population = [];
		currentSeats = [];
		remoteView = null;
		remoteVisual = null;
		started = true;
		running = true;
		send({ type: 'speed', speed });
		send({ type: 'start', config: { ...config, fitnessWeights: { ...config.fitnessWeights } } });
		status = 'Starting a new evolution…';
	}

	function continueEvolution(): void {
		if (!started) {
			notice = 'No previous evolution to continue. Start a new evolution first.';
			return;
		}
		send({ type: 'continue' });
		running = true;
		status = 'Continuing the previous run…';
	}

	function toggleRunning(): void {
		if (!started) {
			start();
			return;
		}
		running = !running;
		send({ type: running ? 'resume' : 'pause' });
		if (running) status = 'Resuming evolution…';
	}

	function setSpeed(value: number): void {
		speed = value;
		send({ type: 'speed', speed: value });
	}

	function selectGenome(id: string | null): void {
		selectedGenomeId = id;
	}

	function selectOwner(ownerId: number | null): void {
		if (!ownerId) {
			selectedGenomeId = null;
			notice = 'Canvas selection cleared.';
			return;
		}
		const genome = currentSeats[ownerId - 1];
		selectedGenomeId = genome?.id ?? null;
		notice = genome ? `Selected ${genome.id} from the map.` : 'No genome is seated there.';
	}

	function downloadCsv(): void {
		if (!lastReport) {
			notice = 'Finish at least one generation before exporting.';
			return;
		}
		const csv = serializeEvolutionCsv(lastReport);
		const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = `territory-evolution-${lastReport.config.seed}.csv`;
		link.click();
		URL.revokeObjectURL(url);
		notice = 'Spreadsheet exported.';
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
		const nextConfig = {
			...config,
			playerCount,
			populationSize: Math.max(playerCount, genomes.length)
		};
		selectedGenomeId = null;
		lastReport = null;
		rows = [];
		archiveRows = [];
		remoteView = null;
		remoteVisual = null;
		started = true;
		running = true;
		send({ type: 'speed', speed });
		send({ type: 'set-population', config: nextConfig, genomes });
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
		const nextConfig = {
			...config,
			playerCount,
			populationSize: Math.max(playerCount, pool.length)
		};
		selectedGenomeId = null;
		lastReport = null;
		rows = [];
		archiveRows = [];
		remoteView = null;
		remoteVisual = null;
		started = true;
		running = true;
		send({ type: 'speed', speed });
		send({ type: 'set-population', config: nextConfig, genomes: pool });
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
		worker = connectWorker();
		return () => {
			send({ type: 'dispose' });
			worker?.terminate();
			worker = null;
			cameraBridge.detach();
		};
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
			<a class="header-link" href="/duel">DUEL LAB</a>
		</div>
	</header>

	<main class="lab-body">
		<section class="viewport">
			{#if remoteView}
				{#key matchKey}
					<GameCanvas
						simulation={remoteView as unknown as TerritorySimulation}
						paused={!running}
						simulate={false}
						{remoteVisual}
						{cameraBridge}
						cameraFocus="map"
						{selectedOwnerId}
						onSelectOwner={selectOwner}
					/>
				{/key}
			{:else}
				<div class="empty">
					<span>NO ACTIVE MATCH</span>
					<p>Start a new evolution or continue the previous run.</p>
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
					<span>POP</span><strong>{population.length || config.populationSize}</strong>
				</div>
				<div class="speed-row">
					{#each SPEEDS as option (option.steps)}
						<button
							class:active={speed === option.steps}
							type="button"
							onclick={() => setSpeed(option.steps)}
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

		<aside class="context">
			<div class="context-actions">
				<button class="primary" type="button" onclick={start}>NEW EVOLUTION</button>
				<button class="continue" type="button" onclick={continueEvolution} disabled={!started}>
					CONTINUE EVOLUTION
				</button>
			</div>

			<div class="context-scroll">
				<details class="panel" open>
					<summary>RUN SETUP</summary>
					<div class="panel-body">
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
							<label class="toggle">
								<input type="checkbox" bind:checked={config.lineageDuels} />
								<span>LINEAGE DUELS (1v1)</span>
							</label>
						</div>
						<p class="hint">
							TEAM AI 1 = free-for-all. Lineage duels test each descendant against a parent; a
							losing record is culled.
						</p>
					</div>
				</details>

				<details class="panel">
					<summary>FITNESS WEIGHTS</summary>
					<div class="panel-body">
						<FitnessWeightsEditor
							weights={config.fitnessWeights}
							onupdate={(weights) => (config.fitnessWeights = weights)}
						/>
					</div>
				</details>

				<details class="panel" open>
					<summary>SPREADSHEET ({rows.length})</summary>
					<div class="panel-body">
						<div class="button-row">
							<button type="button" onclick={downloadCsv} disabled={!lastReport}>EXPORT CSV</button>
							<button type="button" onclick={() => fileInput?.click()}>IMPORT CSV</button>
						</div>
						<input
							bind:this={fileInput}
							class="hidden-file"
							type="file"
							accept=".csv,text/csv"
							onchange={importCsv}
						/>
						{#if notice}<p class="notice">{notice}</p>{/if}

						<div class="spreadsheet">
							<div class="sheet-head">
								<span>#</span><span>GENOME</span><span>FIT</span><span>BUCKET</span><span>
									MARKOV
								</span>
							</div>
							<div class="sheet-body">
								{#each rows as row, index (row.genome.id)}
									<button
										class="genome-row"
										class:selected={row.genome.id === selectedGenomeId}
										type="button"
										onclick={() => selectGenome(row.genome.id)}
									>
										<span>{index + 1}</span>
										<span class="mono">{row.genome.id}</span>
										<span>{row.fitness.toFixed(0)}</span>
										<span class={`pill ${row.bucket}`}>{row.bucket}</span>
										<span>{row.genome.markov ? `${row.genome.markov.states.length}s` : '—'}</span>
									</button>
								{/each}
								{#if rows.length === 0}
									<p class="hint">No scores yet. Start or finish a match to populate the sheet.</p>
								{/if}
							</div>
						</div>

						<div class="selected-panel">
							{#if selectedGenome}
								<div class="selected-title">
									<span>SELECTED</span>
									<strong>{selectedGenome.id}</strong>
									<span>GEN {selectedGenome.generation}</span>
									<span>{selectedGenome.markov?.states.length ?? 0} states</span>
								</div>
								<MarkovGraph
									controller={selectedGenome.markov}
									currentState={selectedMarkovState}
								/>
							{:else}
								<p class="hint">
									Select a spreadsheet row or click an occupied region on the map to inspect that
									bot's state graph.
								</p>
							{/if}
						</div>
					</div>
				</details>

				<details class="panel">
					<summary>PERFORMANCE BUCKETS</summary>
					<div class="panel-body">
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
					</div>
				</details>
			</div>
		</aside>
	</main>
</div>

<style>
	.lab {
		height: 100vh;
		overflow: hidden;
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
		flex: none;
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
	.header-link {
		color: #58c7e8;
		text-decoration: none;
		font-size: 9px;
		letter-spacing: 0.08em;
		border-bottom: 1px solid rgba(88, 199, 232, 0.4);
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
		grid-template-columns: minmax(0, 1fr) 390px;
		gap: 12px;
		padding: 12px;
		flex: 1;
		min-height: 0;
	}
	.viewport {
		position: relative;
		height: 100%;
		min-height: 0;
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
		max-width: calc(100% - 20px);
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
		flex-wrap: wrap;
		gap: 4px;
		margin-left: 10px;
	}
	.speed-row button.active,
	.play {
		border-color: #f3b74d;
		color: #f3b74d;
	}
	.context {
		display: flex;
		flex-direction: column;
		min-height: 0;
		border: 1px solid rgba(247, 238, 208, 0.12);
		background: rgba(7, 18, 22, 0.65);
	}
	.context-actions {
		display: flex;
		gap: 6px;
		padding: 9px;
		border-bottom: 1px solid rgba(247, 238, 208, 0.12);
		background: #071216;
		flex: none;
	}
	.context-actions .primary {
		flex: 1;
		background: #f3b74d !important;
		border-color: #f3b74d !important;
		color: #050b0e !important;
		font-weight: 700;
	}
	.context-actions .continue {
		flex: 1;
		color: #58c7e8;
		border-color: rgba(88, 199, 232, 0.45);
	}
	.context-scroll {
		min-height: 0;
		overflow-y: auto;
		padding: 9px;
		display: flex;
		flex-direction: column;
		gap: 7px;
	}
	.panel {
		border: 1px solid rgba(247, 238, 208, 0.12);
		background: rgba(7, 18, 22, 0.8);
	}
	.panel summary {
		cursor: pointer;
		list-style: none;
		padding: 8px 9px;
		font-size: 9px;
		letter-spacing: 0.16em;
		color: #58c7e8;
		user-select: none;
	}
	.panel summary::-webkit-details-marker {
		display: none;
	}
	.panel summary::after {
		content: '+';
		float: right;
		color: rgba(247, 238, 208, 0.4);
	}
	.panel[open] summary::after {
		content: '−';
	}
	.panel-body {
		padding: 0 9px 9px;
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
	.fields .toggle {
		display: flex;
		align-items: center;
		gap: 7px;
		grid-column: 1 / -1;
		padding-top: 2px;
	}
	.fields .toggle input {
		width: auto;
		margin: 0;
	}
	.fields .toggle span {
		color: #9bb3bd;
		font-size: 9px;
		letter-spacing: 0.08em;
	}
	.hint,
	.notice {
		margin: 7px 0 0;
		font-size: 8px;
		line-height: 1.45;
		color: rgba(247, 238, 208, 0.45);
	}
	.notice {
		color: #73c88f;
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
	.spreadsheet {
		margin-top: 8px;
		border: 1px solid rgba(247, 238, 208, 0.1);
	}
	.sheet-head,
	.genome-row {
		display: grid;
		grid-template-columns: 24px minmax(0, 1fr) 52px 48px 38px;
		align-items: center;
		gap: 4px;
	}
	.sheet-head {
		padding: 5px 6px;
		font-size: 8px;
		color: rgba(247, 238, 208, 0.45);
		border-bottom: 1px solid rgba(247, 238, 208, 0.1);
	}
	.sheet-body {
		max-height: 220px;
		overflow-y: auto;
	}
	.genome-row {
		width: 100%;
		padding: 5px 6px;
		border: 0;
		border-bottom: 1px solid rgba(247, 238, 208, 0.05);
		background: transparent;
		color: rgba(247, 238, 208, 0.82);
		font: inherit;
		font-size: 8px;
		text-align: left;
		cursor: pointer;
	}
	.genome-row:hover {
		background: rgba(88, 199, 232, 0.08);
	}
	.genome-row.selected {
		background: rgba(243, 183, 77, 0.14);
		color: #f3b74d;
	}
	.genome-row .mono {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.selected-panel {
		margin-top: 9px;
		padding-top: 8px;
		border-top: 1px solid rgba(247, 238, 208, 0.1);
	}
	.selected-title {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 5px 8px;
		margin-bottom: 6px;
		font-size: 8px;
		color: rgba(247, 238, 208, 0.5);
	}
	.selected-title strong {
		color: #f3b74d;
		font-size: 9px;
	}
	.buckets {
		display: flex;
		flex-direction: column;
		gap: 5px;
		margin-bottom: 7px;
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
	.pill {
		padding: 1px 4px;
		border: 1px solid currentColor;
		font-size: 7px;
		text-transform: uppercase;
		overflow: hidden;
		text-overflow: ellipsis;
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
	@media (max-width: 980px) {
		.lab {
			height: auto;
			overflow: auto;
		}
		.lab-body {
			grid-template-columns: 1fr;
			height: auto;
		}
		.viewport {
			height: clamp(340px, calc(100vh - 220px), 560px);
		}
		.context {
			max-height: 70vh;
		}
	}
</style>
