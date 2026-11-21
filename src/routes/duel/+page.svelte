<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import GameCanvas from '#lib/components/GameCanvas.svelte';
	import FitnessWeightsEditor from '#lib/components/FitnessWeightsEditor.svelte';
	import {
		DEFAULT_DUEL_CONFIG,
		DEFAULT_FITNESS_WEIGHTS,
		DuelLab,
		type DuelConfig,
		type DuelNode
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

	let config = $state<DuelConfig>({
		...DEFAULT_DUEL_CONFIG,
		names: ['ALPHA', 'BETA'],
		fitnessWeights: { ...DEFAULT_FITNESS_WEIGHTS }
	});
	let lab = $state<DuelLab | null>(null);
	let currentSimulation = $state<TerritorySimulation | null>(null);
	let snapshot = $state<GameSnapshot | null>(null);
	let cameraBridge = new GameCameraBridge();
	let running = $state(false);
	let speed = $state(4);
	let matchKey = $state(0);
	let revision = $state(0);
	let status = $state('Name the characters and start the duel.');
	let matchHandled = false;
	let pendingTimer: ReturnType<typeof setTimeout> | null = null;

	let characters = $derived.by(() => {
		void revision;
		return lab ? lab.characters.map((character) => ({ ...character })) : null;
	});
	let nodes = $derived.by(() => {
		void revision;
		return lab ? [...lab.nodes] : [];
	});
	let rounds = $derived.by(() => {
		void revision;
		return lab ? [...lab.rounds] : [];
	});
	let mutations = $derived.by(() => {
		void revision;
		return lab ? [...lab.mutations] : [];
	});
	let progress = $derived.by(() => {
		void revision;
		return (
			lab?.progress ?? {
				round: 0,
				rounds: config.rounds,
				block: 0,
				blockSize: config.roundsPerMutation
			}
		);
	});
	let graph = $derived.by(() => {
		void revision;
		const width = 660;
		const height = 152;
		const laneY = [46, 110];
		const pad = 42;
		const maxRound = Math.max(1, config.rounds - 1);
		const positions = nodes.map((node) => ({
			node,
			x: pad + (node.createdRound / maxRound) * (width - pad * 2),
			y: laneY[node.characterIndex]
		}));
		const byId = new Map(positions.map((entry) => [entry.node.id, entry]));
		const edges = positions
			.filter((entry) => entry.node.parentId)
			.map((entry) => {
				const parent = byId.get(entry.node.parentId!);
				return parent
					? { from: parent, to: entry, key: `${parent.node.id}->${entry.node.id}` }
					: null;
			})
			.filter((edge): edge is NonNullable<typeof edge> => edge !== null);
		return {
			width,
			height,
			positions,
			edges,
			currentIds: new Set([
				characters?.[0]?.currentNodeId ?? '',
				characters?.[1]?.currentNodeId ?? ''
			])
		};
	});
	let lastRounds = $derived(rounds.slice(-8).reverse());

	function start(): void {
		stopTimer();
		const next = new DuelLab(config);
		next.begin();
		lab = next;
		currentSimulation = next.currentSimulation;
		running = true;
		matchHandled = false;
		snapshot = null;
		matchKey++;
		revision++;
		status = `${next.config.names[0]} vs ${next.config.names[1]} — round 1.`;
	}

	function pause(): void {
		running = !running;
		if (!running) stopTimer();
	}

	function handleTick(nextSnapshot: GameSnapshot): void {
		snapshot = nextSnapshot;
		if (!nextSnapshot.ended || matchHandled || !lab) return;
		matchHandled = true;
		status = 'Round complete — scoring characters…';
		const continueDelay = speed >= 480 ? 20 : speed >= 120 ? 70 : speed >= 48 ? 160 : 650;
		pendingTimer = setTimeout(() => {
			pendingTimer = null;
			if (!lab) return;
			lab.finishRound();
			revision++;
			if (lab.phase === 'finished') {
				running = false;
				const [alpha, beta] = lab.characters;
				const tiedWins = alpha.wins === beta.wins;
				const winner =
					alpha.wins !== beta.wins
						? alpha.wins > beta.wins
							? 0
							: 1
						: alpha.totalFitness >= beta.totalFitness
							? 0
							: 1;
				const score = `${lab.characters[winner].wins}–${lab.characters[winner].losses}`;
				status = tiedWins
					? `${lab.characters[winner].name} wins on fitness (${score}).`
					: `${lab.characters[winner].name} takes the duel ${score}.`;
				return;
			}
			lab.nextRound();
			currentSimulation = lab.currentSimulation;
			matchKey++;
			matchHandled = false;
			status = `Round ${lab.currentRoundIndex + 1}/${config.rounds} — ${
				lab.config.names[0]
			} vs ${lab.config.names[1]}.`;

			if (lab.currentRoundIndex >= 1) {
				const latest = lab.mutations[lab.mutations.length - 1];
				if (latest && latest.round === lab.rounds.length) {
					const name = lab.characters[latest.characterIndex].name;
					status += ` ${name} mutated after ${config.roundsPerMutation} rounds.`;
				}
			}
		}, continueDelay);
	}

	function stopTimer(): void {
		if (pendingTimer !== null) {
			clearTimeout(pendingTimer);
			pendingTimer = null;
		}
	}

	function setCharacterName(index: 0 | 1, value: string): void {
		config.names[index] = value;
	}

	function close(): void {
		stopTimer();
	}

	onMount(() => {
		window.scrollTo(0, 0);
		window.addEventListener('beforeunload', close);
		return () => {
			window.removeEventListener('beforeunload', close);
			stopTimer();
		};
	});

	onDestroy(() => {
		stopTimer();
	});

	function nodeTitle(node: DuelNode): string {
		return `${node.label} · created before round ${node.createdRound + 2}`;
	}
</script>

<svelte:head>
	<title>Territory — Duel Lab</title>
</svelte:head>

<main>
	<header>
		<div>
			<p class="eyebrow">TWO CHARACTERS / ONE MUTATION PATH</p>
			<h1>DUEL LAB</h1>
			<p class="sub">
				No culling. Every {config.roundsPerMutation} rounds, the less fit character must mutate.
			</p>
		</div>
		<div class="header-actions">
			<a class="link" href="/evolution">← EVOLUTION LAB</a>
			<a class="link" href="/">FRONTIER</a>
		</div>
	</header>

	<div class="shell">
		<section class="stage">
			<div class="canvas-wrap">
				{#if currentSimulation}
					{#key matchKey}
						<GameCanvas
							simulation={currentSimulation}
							paused={!running}
							{cameraBridge}
							speedMultiplier={speed}
							maxStepsPerFrame={Math.max(4, Math.min(4096, speed * 2))}
							cameraFocus="map"
							onTick={handleTick}
						/>
					{/key}
				{:else}
					<div class="empty">
						<span>NO ACTIVE DUEL</span>
						<p>Start a duel to watch two characters fight and mutate.</p>
					</div>
				{/if}
			</div>
			<div class="controls">
				<div class="readout">
					<span>ROUND</span><strong>{progress.round}/{progress.rounds}</strong>
					<span>BLOCK</span><strong>{progress.block}/{progress.blockSize}</strong>
					<span>MUTATIONS</span><strong>{mutations.length}</strong>
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
				</div>
				<button type="button" class="play" onclick={pause}>
					{running ? 'PAUSE' : 'PLAY'}
				</button>
			</div>
		</section>

		<aside class="side">
			<section class="panel">
				<h2>Roster</h2>
				<div class="character-grid">
					{#each [0, 1] as index (index)}
						<div class="character">
							<label>
								<span>CHARACTER {index + 1}</span>
								<input
									type="text"
									maxlength="16"
									value={config.names[index]}
									oninput={(event) => setCharacterName(index as 0 | 1, event.currentTarget.value)}
								/>
							</label>
							{#if characters}
								<div class="stat-line">
									<span>W–L</span><strong>
										{characters[index].wins}–{characters[index].losses}
									</strong>
								</div>
								<div class="stat-line">
									<span>VERSION</span><strong>v{characters[index].mutations + 1}</strong>
								</div>
								<div class="stat-line">
									<span>MUTATIONS</span><strong>{characters[index].mutations}</strong>
								</div>
							{/if}
						</div>
					{/each}
				</div>
				<div class="fields">
					<label><span>SEED</span><input type="number" bind:value={config.seed} /></label>
					<label>
						<span>ROUNDS</span><input type="number" min="2" max="200" bind:value={config.rounds} />
					</label>
					<label>
						<span>MUTATE EVERY</span><input
							type="number"
							min="1"
							max="20"
							bind:value={config.roundsPerMutation}
						/>
					</label>
					<label>
						<span>TICKS / ROUND</span><input
							type="number"
							min="200"
							max="30000"
							step="100"
							bind:value={config.ticks}
						/>
					</label>
				</div>
				<div class="run-actions">
					<button class="primary" type="button" onclick={start}>START DUEL</button>
				</div>
				<p class="hint">
					Characters alternate seats each round. The weaker block fitness mutates; nobody is
					eliminated.
				</p>
				<p class="status">{status}</p>
			</section>

			<section class="panel">
				<h2>Fitness weights</h2>
				<FitnessWeightsEditor
					weights={config.fitnessWeights}
					onupdate={(weights) => (config.fitnessWeights = weights)}
					compact
				/>
			</section>
		</aside>
	</div>

	<section class="lower">
		<section class="panel graph-panel">
			<div class="panel-title">
				<h2>Mutation graph</h2>
				<span>{nodes.length} versions / {mutations.length} mutations</span>
			</div>
			{#if nodes.length > 0}
				<svg
					viewBox={`0 0 ${graph.width} ${graph.height}`}
					role="img"
					aria-label="Character mutation graph"
				>
					<line class="lane" x1="20" x2={graph.width - 20} y1="46" y2="46" />
					<line class="lane" x1="20" x2={graph.width - 20} y1="110" y2="110" />
					<text class="lane-label" x="18" y="28">ALPHA PATH</text>
					<text class="lane-label" x="18" y="92">BETA PATH</text>
					{#each graph.edges as edge (edge.key)}
						<line class="edge" x1={edge.from.x} y1={edge.from.y} x2={edge.to.x} y2={edge.to.y} />
					{/each}
					{#each graph.positions as entry (entry.node.id)}
						<g class:current={graph.currentIds.has(entry.node.id)}>
							<circle class="node-halo" cx={entry.x} cy={entry.y} r="18" />
							<circle class="node" cx={entry.x} cy={entry.y} r="9" />
							<text class="node-label" x={entry.x} y={entry.y + 24} text-anchor="middle">
								{entry.node.label}
							</text>
							<text class="node-sub" x={entry.x} y={entry.y + 34} text-anchor="middle">
								{entry.node.parentId === null ? 'start' : `after R${entry.node.createdRound}`}
							</text>
						</g>
					{/each}
				</svg>
			{:else}
				<p class="empty-graph">Start a duel to grow the mutation path.</p>
			{/if}
		</section>

		<section class="panel">
			<div class="panel-title">
				<h2>Round log</h2>
				<span>last 8</span>
			</div>
			{#if lastRounds.length > 0}
				<table>
					<thead><tr><th>ROUND</th><th>SEATS</th><th>WINNER</th><th>FITNESS Δ</th></tr></thead>
					<tbody>
						{#each lastRounds as round (round.round)}
							<tr>
								<td>{round.round + 1}</td>
								<td class="mono">{round.nodeIds[0]} ↔ {round.nodeIds[1]}</td>
								<td>{lab?.characters[round.winner].name}</td>
								<td class="mono">
									{Math.round(round.fitness[0])} / {Math.round(round.fitness[1])}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{:else}
				<p class="empty-graph">No rounds played yet.</p>
			{/if}
		</section>
	</section>

	{#if mutations.length > 0}
		<section class="mutation-strip">
			{#each mutations.slice(-10) as mutation (mutation.toNodeId)}
				<span>
					{lab?.characters[mutation.characterIndex].name} mutated after round {mutation.round}:
					<strong>{mutation.fromNodeId}</strong> → <strong>{mutation.toNodeId}</strong>
				</span>
			{/each}
		</section>
	{/if}
</main>

<style>
	main {
		min-height: 100vh;
		padding: 20px 22px 30px;
		background: #050b0e;
		color: #c7d6dc;
		font-family: 'IBM Plex Mono', 'Courier New', monospace;
	}

	header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 20px;
		margin-bottom: 18px;
	}

	.eyebrow {
		margin: 0 0 4px;
		color: #58c7e8;
		font-size: 10px;
		letter-spacing: 0.22em;
	}

	h1 {
		margin: 0;
		font-size: 30px;
		letter-spacing: 0.08em;
	}

	.sub {
		margin: 6px 0 0;
		color: #78919a;
		font-size: 11px;
	}

	.header-actions {
		display: flex;
		gap: 8px;
	}

	.link {
		border: 1px solid #29404a;
		padding: 7px 10px;
		color: #9bb3bd;
		text-decoration: none;
		font-size: 10px;
		letter-spacing: 0.08em;
	}

	.link:hover {
		border-color: #f3b74d;
		color: #f3b74d;
	}

	.shell {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 360px;
		gap: 16px;
	}

	.stage {
		border: 1px solid #1b2b33;
		background: #071015;
	}

	.canvas-wrap {
		position: relative;
		height: 560px;
		overflow: hidden;
	}

	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		height: 100%;
		color: #566a72;
		font-size: 11px;
		letter-spacing: 0.08em;
	}

	.empty span {
		color: #9bb3bd;
	}

	.empty p {
		margin: 8px 0 0;
	}

	.controls {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px;
		border-top: 1px solid #1b2b33;
		flex-wrap: wrap;
	}

	.readout {
		display: flex;
		align-items: baseline;
		gap: 6px;
		margin-right: 4px;
	}

	.readout span {
		color: #6c838c;
		font-size: 9px;
		letter-spacing: 0.1em;
	}

	.readout strong {
		color: #d8e7ec;
		font-size: 12px;
	}

	.speed-row {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}

	.speed-row button,
	.play,
	.primary {
		border: 1px solid #29404a;
		background: #071015;
		color: #9bb3bd;
		padding: 5px 8px;
		font: inherit;
		font-size: 10px;
		cursor: pointer;
	}

	.speed-row button.active,
	.play {
		border-color: #f3b74d;
		color: #f3b74d;
	}

	.play {
		margin-left: auto;
	}

	.side {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.panel {
		border: 1px solid #1b2b33;
		background: #071015;
		padding: 13px;
	}

	.panel h2 {
		margin: 0 0 9px;
		font-size: 12px;
		letter-spacing: 0.12em;
		color: #f3b74d;
	}

	.panel-title {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 10px;
	}

	.panel-title span {
		color: #6c838c;
		font-size: 9px;
		letter-spacing: 0.08em;
	}

	.character-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
		margin-bottom: 10px;
	}

	.character {
		border: 1px solid #1b2b33;
		padding: 8px;
		background: #08141a;
	}

	.character label span,
	.fields span {
		display: block;
		color: #6c838c;
		font-size: 8px;
		letter-spacing: 0.1em;
		margin-bottom: 3px;
	}

	.character input,
	.fields input {
		width: 100%;
		border: 1px solid #29404a;
		background: #050b0e;
		color: #d8e7ec;
		padding: 5px;
		font: inherit;
		font-size: 11px;
	}

	.stat-line {
		display: flex;
		justify-content: space-between;
		margin-top: 5px;
		color: #78919a;
		font-size: 9px;
	}

	.stat-line strong {
		color: #c7d6dc;
	}

	.fields {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 7px;
	}

	.run-actions {
		margin-top: 9px;
	}

	.primary {
		width: 100%;
		background: #f3b74d;
		border-color: #f3b74d;
		color: #050b0e;
		font-weight: 700;
		padding: 8px;
	}

	.hint,
	.status {
		margin: 8px 0 0;
		color: #6c838c;
		font-size: 9px;
		line-height: 1.5;
	}

	.status {
		color: #9bb3bd;
		min-height: 22px;
	}

	.lower {
		display: grid;
		grid-template-columns: minmax(0, 1.3fr) minmax(330px, 1fr);
		gap: 16px;
		margin-top: 16px;
	}

	.graph-panel svg {
		display: block;
		width: 100%;
		height: auto;
		min-height: 150px;
	}

	.lane {
		stroke: #1b2b33;
		stroke-width: 1;
	}

	.edge {
		stroke: #58c7e8;
		stroke-width: 1.5;
	}

	.node {
		fill: #071015;
		stroke: #58c7e8;
		stroke-width: 2;
	}

	.node-halo {
		fill: none;
		stroke: transparent;
	}

	.current .node-halo {
		stroke: #f3b74d;
		stroke-width: 1;
	}

	.current .node {
		fill: #f3b74d;
		stroke: #f3b74d;
	}

	.lane-label,
	.node-label,
	.node-sub {
		fill: #9bb3bd;
		font-family: 'IBM Plex Mono', 'Courier New', monospace;
		font-size: 9px;
	}

	.lane-label {
		fill: #6c838c;
		letter-spacing: 0.1em;
	}

	.node-sub {
		fill: #566a72;
		font-size: 8px;
	}

	.empty-graph {
		color: #566a72;
		font-size: 10px;
		margin: 10px 0;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 9px;
	}

	th {
		text-align: left;
		color: #6c838c;
		font-weight: 400;
		letter-spacing: 0.08em;
		border-bottom: 1px solid #1b2b33;
		padding: 5px 4px;
	}

	td {
		padding: 5px 4px;
		border-bottom: 1px solid rgba(27, 43, 51, 0.6);
		color: #a9bec7;
	}

	.mono {
		font-size: 9px;
	}

	.mutation-strip {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 16px;
		padding: 10px 12px;
		border: 1px solid #29404a;
		color: #78919a;
		font-size: 9px;
	}

	.mutation-strip strong {
		color: #f3b74d;
		font-weight: 400;
	}

	@media (max-width: 980px) {
		.shell,
		.lower {
			grid-template-columns: 1fr;
		}

		.canvas-wrap {
			height: 420px;
		}
	}

	@media (max-width: 620px) {
		main {
			padding: 14px;
		}

		header {
			display: block;
		}

		.header-actions {
			margin-top: 10px;
		}

		.canvas-wrap {
			height: 300px;
		}

		.play {
			margin-left: 0;
		}

		.fields,
		.character-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
