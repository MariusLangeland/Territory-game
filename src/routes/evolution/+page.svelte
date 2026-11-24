<script lang="ts">
	import ReplayViewer from '#lib/components/ReplayViewer.svelte';
	import FitnessWeightsEditor from '#lib/components/FitnessWeightsEditor.svelte';
	import FitnessHistoryGraph from '#lib/components/FitnessHistoryGraph.svelte';
	import MarkovGraph from '#lib/components/MarkovGraph.svelte';
	import { createEvolutionPage } from '#lib/game/evolution/page/lab-page.svelte';

	const lab = createEvolutionPage();
</script>

<svelte:head>
	<title>Territory — Evolution Lab</title>
</svelte:head>

<div class="lab">
	<header class="lab-header">
		<button class="back" type="button" onclick={lab.navigateHome}>← FRONTIER</button>
		<div class="title-block">
			<span class="eyebrow">NATURAL SELECTION SANDBOX</span>
			<h1>EVOLUTION LAB</h1>
			<p>Genomes are matched, scored, pruned, crossed, and mutated. Buckets feed difficulty.</p>
		</div>
		<div class="status-block">
			<span class:live={lab.running} class="live-dot"></span>
			<span>{lab.status}</span>
			<span class="phase">{lab.phase.toUpperCase()}</span>
			<span>{lab.config.mode === 'gauntlet' ? 'RUN' : 'GEN'} {lab.progress.generation || '—'}</span>
			<span>MATCH {lab.progress.match || '—'}/{lab.progress.matches || '—'}</span>
			<span>POP {lab.population.length || lab.config.populationSize}</span>
			<span>RATE {lab.effectiveTps > 0 ? `${lab.effectiveTps}/s` : '—'}</span>
			{#if lab.restoredSession}<span class="restored">RESTORED</span>{/if}
		</div>
	</header>

	<main class="lab-body">
		<section class="viewport">
			{#if lab.remoteView}
				{#key lab.matchKey}
					<ReplayViewer
						simulation={lab.remoteView}
						paused={!lab.running}
						simulate={false}
						remoteVisuals={lab.remoteVisualQueue}
						onRemoteVisualsApplied={lab.acknowledgeVisuals}
						cameraBridge={lab.cameraBridge}
						cameraFocus="map"
						selectedOwnerId={lab.selectedOwnerId}
						onSelectOwner={lab.selectOwner}
						playback={{
							playing: lab.running,
							speed: lab.speed,
							options: lab.speeds.map((option) => ({
								label: option.label,
								value: option.steps
							})),
							onToggle: lab.toggleRunning,
							onSpeed: (speed) => lab.setSpeed(speed)
						}}
					/>
				{/key}
			{:else}
				<div class="empty">
					<span>NO ACTIVE MATCH</span>
					<p>Start a new evolution or continue the previous run.</p>
				</div>
			{/if}
		</section>

		<aside class="context">
			<div class="context-actions">
				{#if lab.simulationActive}
					<button class="stop" type="button" onclick={lab.stopRun}>STOP</button>
					<button class="stop-now" type="button" onclick={lab.stopNow}>STOP IMMEDIATE</button>
				{:else}
					<button class="primary" type="button" onclick={lab.start}>
						{lab.config.mode === 'gauntlet' ? 'NEW GAUNTLET' : 'NEW EVOLUTION'}
					</button>
				{/if}
				<button
					class="continue"
					type="button"
					onclick={lab.continueEvolution}
					disabled={!lab.started || (lab.config.mode === 'gauntlet' && lab.population.length < 2)}
				>
					CONTINUE
				</button>
				<button class="discard" type="button" onclick={lab.discardSession} disabled={!lab.started}>
					DISCARD
				</button>
			</div>

			<div class="context-scroll">
				<details class="panel" open>
					<summary>RUN SETUP</summary>
					<div class="panel-body">
						<div class="fields">
							<label class="mode-field">
								<span>MODE</span>
								<select value={lab.config.mode} onchange={lab.handleModeChange}>
									<option value="evolution">EVOLUTION</option>
									<option value="gauntlet">GAUNTLET · 64 FFA</option>
								</select>
							</label>
							<label><span>SEED</span><input type="number" bind:value={lab.config.seed} /></label>
							{#if lab.config.mode === 'gauntlet'}
								<label>
									<span>LIVES</span><input
										type="number"
										min="1"
										max="9"
										bind:value={lab.config.gauntletLives}
									/>
								</label>
								<label>
									<span>TOP RECOVERY</span><input
										type="number"
										min="1"
										max="64"
										bind:value={lab.config.gauntletRecoveryCount}
									/>
								</label>
								<label>
									<span>REMAIN TARGET</span><input
										type="number"
										min="1"
										max="64"
										bind:value={lab.config.gauntletRemainingTarget}
									/>
								</label>
								<label>
									<span>TICKS / RUN</span><input
										type="number"
										min="200"
										max="30000"
										step="100"
										bind:value={lab.config.ticks}
									/>
								</label>
							{:else}
								<label>
									<span>POPULATION</span><input
										type="number"
										min="4"
										max="64"
										bind:value={lab.config.populationSize}
									/>
								</label>
								<label>
									<span>GENERATIONS</span><input
										type="number"
										min="1"
										max="50"
										bind:value={lab.config.generations}
									/>
								</label>
								<label>
									<span>PLAYERS</span><input
										type="number"
										min="2"
										max="51"
										bind:value={lab.config.playerCount}
									/>
								</label>
								<label>
									<span>MATCHES / ROUND</span><input
										type="number"
										min="1"
										max="8"
										bind:value={lab.config.matchesPerRound}
									/>
								</label>
								<label>
									<span>TICKS / MATCH</span><input
										type="number"
										min="200"
										max="30000"
										step="100"
										bind:value={lab.config.ticks}
									/>
								</label>
								<label>
									<span>TEAM AI</span><input
										type="number"
										min="1"
										max="8"
										bind:value={lab.config.teamCount}
									/>
								</label>
								<label class="toggle">
									<input type="checkbox" bind:checked={lab.config.lineageDuels} />
									<span>LINEAGE DUELS (1v1)</span>
								</label>
							{/if}
						</div>
						<p class="hint">
							{#if lab.config.mode === 'gauntlet'}
								Every run seats all remaining genomes in one 64-bot FFA. Eliminated bots lose a
								life; the top {lab.config.gauntletRecoveryCount} surviving fitness bots recover one (max
								{lab.config.gauntletLives}).
							{:else}
								TEAM AI 1 = free-for-all. Lineage duels test each descendant against a parent; a
								losing record is culled.
							{/if}
						</p>
						{#if lab.config.mode === 'gauntlet'}
							<button
								class="fill-seats"
								type="button"
								onclick={lab.fillSeats}
								disabled={lab.emptySeats === 0 || lab.phase === 'match'}
							>
								FILL {lab.emptySeats} EMPTY SEAT{lab.emptySeats === 1 ? '' : 'S'}
							</button>
						{/if}
					</div>
				</details>

				<details class="panel">
					<summary>FITNESS WEIGHTS</summary>
					<div class="panel-body">
						<FitnessWeightsEditor
							weights={lab.config.fitnessWeights}
							onupdate={lab.setFitnessWeights}
						/>
					</div>
				</details>

				<details class="panel" open>
					<summary>SPREADSHEET ({lab.rows.length})</summary>
					<div class="panel-body">
						{#if lab.config.mode === 'gauntlet'}
							<div class="button-row">
								<button
									type="button"
									onclick={lab.exportGauntletState}
									disabled={!lab.lastReport || lab.simulationActive}
								>
									EXPORT STATE
								</button>
								<button
									type="button"
									onclick={() => lab.stateFileInput?.click()}
									disabled={lab.simulationActive}
								>
									IMPORT STATE
								</button>
							</div>
							<input
								bind:this={lab.stateFileInput}
								class="hidden-file"
								type="file"
								accept=".json,application/json"
								onchange={lab.importGauntletState}
							/>
						{:else}
							<div class="button-row">
								<button type="button" onclick={lab.downloadCsv} disabled={!lab.lastReport}>
									EXPORT CSV
								</button>
								<button type="button" onclick={() => lab.fileInput?.click()}>IMPORT CSV</button>
							</div>
							<input
								bind:this={lab.fileInput}
								class="hidden-file"
								type="file"
								accept=".csv,text/csv"
								onchange={lab.importCsv}
							/>
						{/if}
						{#if lab.notice}<p class="notice">{lab.notice}</p>{/if}

						<div class="spreadsheet" class:gauntlet={lab.config.mode === 'gauntlet'}>
							<div class="sheet-head">
								<span>#</span><span>GENOME</span><span>FIT</span><span>BUCKET</span><span>
									MARKOV
								</span>{#if lab.config.mode === 'gauntlet'}<span>LIFE</span>{/if}
							</div>
							<div class="sheet-body">
								{#each lab.rows as row, index (row.genome.id)}
									<button
										class="genome-row"
										class:selected={row.genome.id === lab.selectedGenomeId}
										type="button"
										onclick={() => lab.selectGenome(row.genome.id)}
									>
										<span>{index + 1}</span>
										<span class="mono">{row.genome.id}</span>
										<span>{row.fitness.toFixed(0)}</span>
										<span class={`pill ${row.bucket}`}>{row.bucket}</span>
										<span>{row.genome.markov ? `${row.genome.markov.states.length}s` : '—'}</span>
										{#if lab.config.mode === 'gauntlet'}
											<span class:removed={row.gauntletRemoved}>
												{row.gauntletLives ?? '—'}{row.gauntletRecovered ? '+' : ''}
											</span>
										{/if}
									</button>
								{/each}
								{#if lab.rows.length === 0}
									<p class="hint">No scores yet. Start or finish a match to populate the sheet.</p>
								{/if}
							</div>
						</div>

						<div class="selected-panel">
							{#if lab.selectedGenome}
								<div class="selected-title">
									<span>SELECTED</span>
									<strong>{lab.selectedGenome.id}</strong>
									<span>GEN {lab.selectedGenome.generation}</span>
									<span>{lab.selectedGenome.markov?.states.length ?? 0} states</span>
								</div>
								<MarkovGraph
									controller={lab.selectedGenome.markov}
									currentState={lab.selectedMarkovState}
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

				<details class="panel" open>
					<summary>FITNESS HISTORY</summary>
					<div class="panel-body">
						<FitnessHistoryGraph points={lab.historyPoints} />
					</div>
				</details>

				<details class="panel">
					<summary>PERFORMANCE BUCKETS</summary>
					<div class="panel-body">
						<div class="buckets">
							{#each lab.botBuckets as bucket (bucket)}
								<div class="bucket">
									<label>
										<input
											type="checkbox"
											checked={lab.selectedBuckets[bucket]}
											onchange={(event) =>
												lab.selectAll(bucket, (event.currentTarget as HTMLInputElement).checked)}
										/>
										<span class={`bucket-name ${bucket}`}>{bucket.toUpperCase()}</span>
									</label>
									<strong>{lab.counts[bucket]}</strong>
								</div>
							{/each}
						</div>
						<button
							type="button"
							onclick={lab.useBuckets}
							disabled={lab.counts.poor + lab.counts.good + lab.counts.top === 0}
						>
							RUN WITH SELECTED BUCKETS
						</button>
						<p class="hint">
							Relaxed difficulty uses poor, standard good, ruthless top. Finished buckets are saved
							locally and used by the main match setup. QD archive: {lab.archiveRows.length} strategy
							descriptors.
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
		background: var(--bg-deep);
		color: var(--accent-bone);
		font-family: 'IBM Plex Mono', 'Cascadia Mono', monospace;
		display: flex;
		flex-direction: column;
	}
	.lab-header {
		display: flex;
		align-items: center;
		gap: 18px;
		padding: 12px 18px;
		border-bottom: 1px solid var(--bone-12);
		background: linear-gradient(180deg, var(--bg-raised-alt), var(--bg-deep));
		flex: none;
	}
	.back,
	.lab button {
		background: transparent;
		border: 1px solid rgba(247, 238, 208, 0.22);
		color: var(--accent-bone);
		font: inherit;
		font-size: var(--text-10);
		letter-spacing: 0.08em;
		padding: 7px 10px;
		cursor: pointer;
	}
	.lab button:hover:not(:disabled) {
		border-color: var(--accent-gold);
		color: var(--accent-gold);
	}
	.lab button:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.title-block h1 {
		margin: 0;
		font-size: var(--text-22);
		letter-spacing: 0.14em;
	}
	.eyebrow {
		font-size: var(--text-9);
		letter-spacing: 0.24em;
		color: var(--accent-cyan);
	}
	.title-block p {
		margin: 3px 0 0;
		font-size: var(--text-10);
		color: var(--bone-55);
	}
	.status-block {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 9px;
		font-size: var(--text-10);
		color: rgba(247, 238, 208, 0.72);
	}
	.header-link {
		color: var(--accent-cyan);
		text-decoration: none;
		font-size: var(--text-9);
		letter-spacing: 0.08em;
		border-bottom: 1px solid rgba(88, 199, 232, 0.4);
	}
	.phase {
		color: var(--accent-cyan);
	}
	.live-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--danger);
	}
	.live-dot.live {
		background: var(--accent-mint);
		box-shadow: 0 0 8px var(--accent-mint);
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
		border: 1px solid var(--bone-12);
		background: var(--bg-abyss);
		overflow: hidden;
	}
	.empty {
		position: absolute;
		inset: 0;
		display: grid;
		place-content: center;
		text-align: center;
		color: var(--bone-50);
		font-size: var(--text-11);
		letter-spacing: 0.14em;
	}
	.context {
		display: flex;
		flex-direction: column;
		min-height: 0;
		border: 1px solid var(--bone-12);
		background: rgba(7, 18, 22, 0.65);
	}
	.context-actions {
		display: flex;
		gap: 6px;
		padding: 9px;
		border-bottom: 1px solid var(--bone-12);
		background: var(--bg-raised-alt);
		flex: none;
	}
	.context-actions .primary {
		flex: 1;
		background: var(--accent-gold) !important;
		border-color: var(--accent-gold) !important;
		color: var(--bg-deep) !important;
		font-weight: 700;
	}
	.context-actions .continue {
		flex: 1;
		color: var(--accent-cyan);
		border-color: rgba(88, 199, 232, 0.45);
	}
	.context-actions .stop {
		flex: 1;
		color: var(--accent-gold);
		border-color: rgba(243, 183, 77, 0.5);
		font-size: var(--text-8);
	}
	.context-actions .stop-now {
		flex: 1;
		color: var(--danger);
		border-color: rgba(255, 98, 95, 0.5);
		font-size: var(--text-8);
	}
	.context-actions .discard {
		flex: none;
		padding-inline: 7px;
		color: var(--bone-55);
		font-size: var(--text-8);
	}
	.restored {
		padding: 2px 5px;
		border: 1px solid rgba(115, 200, 143, 0.45);
		color: var(--accent-mint);
		font-size: var(--text-8);
		letter-spacing: 0.08em;
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
		border: 1px solid var(--bone-12);
		background: rgba(7, 18, 22, 0.8);
	}
	.panel summary {
		cursor: pointer;
		list-style: none;
		padding: 8px 9px;
		font-size: var(--text-9);
		letter-spacing: 0.16em;
		color: var(--accent-cyan);
		user-select: none;
	}
	.panel summary::-webkit-details-marker {
		display: none;
	}
	.panel summary::after {
		content: '+';
		float: right;
		color: var(--bone-40);
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
		font-size: var(--text-9);
		color: var(--bone-55);
	}
	.fields input,
	.fields select {
		background: var(--bg-abyss);
		border: 1px solid rgba(247, 238, 208, 0.18);
		color: var(--accent-bone);
		font: inherit;
		font-size: var(--text-11);
		padding: 5px 6px;
		min-width: 0;
	}
	.fields .mode-field {
		grid-column: 1 / -1;
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
		color: var(--ink-dim);
		font-size: var(--text-9);
		letter-spacing: 0.08em;
	}
	.fill-seats {
		width: 100%;
		margin-top: 7px;
		border-color: rgba(115, 200, 143, 0.45);
		color: var(--accent-mint);
		font-size: var(--text-9);
	}
	.hint,
	.notice {
		margin: 7px 0 0;
		font-size: var(--text-8);
		line-height: 1.45;
		color: rgba(247, 238, 208, 0.45);
	}
	.notice {
		color: var(--accent-mint);
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
		border: 1px solid var(--bone-10);
	}
	.sheet-head,
	.genome-row {
		display: grid;
		grid-template-columns: 24px minmax(0, 1fr) 52px 48px 38px;
		align-items: center;
		gap: 4px;
	}
	.spreadsheet.gauntlet .sheet-head,
	.spreadsheet.gauntlet .genome-row {
		grid-template-columns: 24px minmax(0, 1fr) 52px 44px 40px 26px;
	}
	.sheet-head {
		padding: 5px 6px;
		font-size: var(--text-8);
		color: rgba(247, 238, 208, 0.45);
		border-bottom: 1px solid var(--bone-10);
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
		font-size: var(--text-8);
		text-align: left;
		cursor: pointer;
	}
	.genome-row:hover {
		background: rgba(88, 199, 232, 0.08);
	}
	.genome-row.selected {
		background: rgba(243, 183, 77, 0.14);
		color: var(--accent-gold);
	}
	.genome-row .removed {
		color: var(--danger);
	}
	.genome-row .mono {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.selected-panel {
		margin-top: 9px;
		padding-top: 8px;
		border-top: 1px solid var(--bone-10);
	}
	.selected-title {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 5px 8px;
		margin-bottom: 6px;
		font-size: var(--text-8);
		color: var(--bone-50);
	}
	.selected-title strong {
		color: var(--accent-gold);
		font-size: var(--text-9);
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
		font-size: var(--text-10);
	}
	.bucket label {
		display: flex;
		align-items: center;
		gap: 7px;
	}
	.bucket-name.top {
		color: var(--accent-mint);
	}
	.bucket-name.good {
		color: var(--accent-cyan);
	}
	.bucket-name.poor {
		color: var(--danger);
	}
	.pill {
		padding: 1px 4px;
		border: 1px solid currentColor;
		font-size: var(--text-7);
		text-transform: uppercase;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.pill.top {
		color: var(--accent-mint);
	}
	.pill.good {
		color: var(--accent-cyan);
	}
	.pill.poor {
		color: var(--danger);
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
