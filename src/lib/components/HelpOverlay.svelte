<script lang="ts">
	import { TICK_RATE } from '#lib/game/constants';

	interface Props {
		stateCount: number;
		mapWidth: number;
		mapHeight: number;
		onClose: () => void;
		onExportLedger: () => void;
	}
	let { stateCount, mapWidth, mapHeight, onClose, onExportLedger }: Props = $props();
</script>

<div class="overlay help-overlay" role="dialog" aria-modal="true" aria-labelledby="help-title">
	<article class="modal help-modal">
		<header class="help-head">
			<div>
				<p class="overlay-kicker">FIELD MANUAL / FRONTAGE V1</p>
				<h2 id="help-title">HOW TO<br /><em>ATTACK.</em></h2>
			</div>
			<button
				class="square-button close-manual"
				type="button"
				onclick={onClose}
				aria-label="Close field manual"
			>
				×
			</button>
		</header>

		<div class="manual-grid">
			<section>
				<span class="manual-index">01 / THE MODEL</span>
				<h3>One supply. Durable fronts.</h3>
				<p>
					Supply is the only resource. It accrues from territory and structures, pays for cards,
					upgrades, and front launches, and has no global maximum; territory and War Academies raise
					the cap. Command Posts add supply income; Artillery is an active siege structure.
					Fortifications add district defense. Jammers project a global aura that subtracts one
					effective Barracks level from every enemy attacking you, without raising pixel defense.
					Cards are permanent. Click a district, or drop its matching card inside it, to upgrade;
					cost is the card price plus 15 × current level. The 1 / 5 / 10 / 25 buttons above the
					supply bar choose an atomic upgrade batch, and the cursor tooltip shows the total cost.
					While placing a card, hold Shift to build a new structure on the closest valid
					outside-district cell within 160 px; placement stays armed for repeated builds. Naval
					clicks snap to the nearest hostile/neutral shore within 32 px. Each capture spends both
					per-tick power and durable strength. Hold 70% of the land to win immediately.
				</p>
			</section>
			<section>
				<span class="manual-index">02 / FRONTS</span>
				<h3>Buy strength. Cancel for a refund.</h3>
				<p>
					Click neutral ground or a rival's border near your territory to launch a front. A launch
					costs 30 supply plus 15 per effective Barracks level. Barracks add attack strength
					linearly, while speed and defense piercing grow by floor(log2(levels + 1)) — infinite
					scaling with diminishing returns. Repeated clicks create separate fronts. When mutual
					fronts touch, both sides lose strength simultaneously; a front at zero dies and the
					survivor holds the contact line. Use CANCEL LAST or press X to refund the remaining
					strength share. Each State structure anchors its mainland and adds 20 defense. Artillery
					costs 1000 supply, needs 16 px of district-free ground, and covers a 64 px district. <kbd>
						A
					</kbd> or FIRE, then click an aim point in range. Each level fires one inaccurate shell at 300
					supply per level; shells damage structures but cannot destroy a State.
				</p>
			</section>
			<section>
				<span class="manual-index">03 / CAMERA</span>
				<h3>Read the whole atlas.</h3>
				<p>
					Drag to pan, scroll to zoom at the pointer, or use <kbd>F</kbd> to fit the world and
					<kbd>C</kbd> to return to your frontier. Click the minimap to jump anywhere. On touch,
					pinch with two fingers. Arrow keys move a keyboard cursor; <kbd>Enter</kbd> attacks or
					applies the selected upgrade batch, <kbd>Shift</kbd> moves faster and Shift+Enter
					shift-builds an armed card, and <kbd>Esc</kbd> clears it.
				</p>
			</section>
			<section>
				<span class="manual-index">04 / STRESS TEST</span>
				<h3>{stateCount} states, one tick.</h3>
				<p>
					{TICK_RATE} fixed ticks per second, {stateCount - 1} free-attacking AI states, and a seeded
					PRNG. The {(mapWidth * mapHeight).toLocaleString('en-US')} pixel atlas is rendered from a GPU
					control texture with only dirty tiles uploaded. Every second, land cut off from every live State
					structure is annexed by an adjacent protected mainland with the largest shared border. Capture
					a State structure to remove that state's annexation protection.
				</p>
			</section>
		</div>

		<div class="manual-footer">
			<span><kbd>SPACE</kbd> PAUSE / RESUME</span>
			<span><kbd>1</kbd>–<kbd>7</kbd> PLACE CARD · LMB BUILD · RMB CANCEL</span>
			<span><kbd>+</kbd> <kbd>−</kbd> ZOOM</span>
			<span><kbd>H</kbd> FIELD MANUAL</span>
			<button class="ledger-download" type="button" onclick={onExportLedger}>
				DOWNLOAD LEDGER
			</button>
			<span>WEBGPU / DETERMINISTIC CORE</span>
		</div>
	</article>
</div>

<style>
	.help-modal::before {
		content: '';
		position: absolute;
		top: -1px;
		left: -1px;
		width: 18px;
		height: 18px;
		border-top: 1px solid var(--signal);
		border-left: 1px solid var(--signal);
	}

	.help-overlay {
		z-index: 80;
	}

	.help-modal {
		width: min(96vw, 900px);
		max-height: 92vh;
		padding: clamp(24px, 3.5vw, 42px);
	}

	.help-head {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 20px;
		padding-bottom: 20px;
		border-bottom: 1px solid var(--line-soft);
	}

	.help-head h2 {
		margin-bottom: 0;
		font-size: var(--display-xs);
	}

	.close-manual {
		flex: none;
		font-size: var(--text-20);
		line-height: 1;
	}

	.manual-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0;
		margin-top: 4px;
	}

	.manual-grid section {
		padding: 22px 26px 20px 0;
		border-bottom: 1px solid var(--line-soft);
	}

	.manual-grid section:nth-child(even) {
		padding-left: 26px;
		border-left: 1px solid var(--line-soft);
	}

	.manual-grid section:nth-last-child(-n + 2) {
		border-bottom: 0;
	}

	.manual-index {
		font-family: var(--font-mono);
		font-size: var(--text-7);
		letter-spacing: 0.13em;
		color: var(--signal);
	}

	.manual-grid h3 {
		margin: 8px 0 8px;
		font-family: var(--font-display);
		font-size: var(--text-25);
		font-weight: 600;
		line-height: 1;
		letter-spacing: 0.02em;
	}

	.manual-grid p {
		margin: 0;
		font-size: var(--text-12);
		line-height: 1.65;
		color: var(--ink-dim);
	}

	.manual-footer {
		display: flex;
		flex-wrap: wrap;
		gap: 17px;
		margin-top: 20px;
		padding-top: 14px;
		border-top: 1px solid var(--line-soft);
		font-family: var(--font-mono);
		font-size: var(--text-7);
		letter-spacing: 0.07em;
		color: var(--ink-faint);
	}

	.manual-footer span:last-child {
		margin-left: auto;
	}

	.ledger-download {
		padding: 2px 7px;
		border: 1px solid var(--line-soft);
		background: var(--bg-raised);
		color: var(--ink-dim);
		font: inherit;
		letter-spacing: inherit;
		cursor: pointer;
	}

	.ledger-download:hover {
		border-color: var(--signal-55);
		color: var(--signal-strong);
	}

	@media (max-width: 900px) {
		.manual-grid {
			grid-template-columns: 1fr;
		}
		.manual-grid section:nth-child(even) {
			padding-left: 0;
			border-left: 0;
		}
		.manual-grid section:nth-last-child(2) {
			border-bottom: 1px solid var(--line-soft);
		}
	}
</style>
