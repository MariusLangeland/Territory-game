<script lang="ts">
	import { TICK_RATE } from '#lib/game/constants';
	import {
		BOT_COMMAND_POST_STACK_OPTIONS,
		BOT_DIFFICULTY_OPTIONS,
		MAP_PRESETS,
		STATE_COUNT_OPTIONS,
		TIMER_OPTIONS,
		type MatchSettings
	} from '#lib/game/match-config';
	import { randomSeed } from '#lib/game/session/seed';

	interface Props {
		phase: 'loading' | 'ready' | 'error';
		stateCount: number;
		mapWidth: number;
		mapHeight: number;
		seedHex: string;
		rendererReady: boolean;
		canDeploy: boolean;
		deployLabel: string;
		seedInput?: string;
		matchSettings: MatchSettings;
		settingsDirty: boolean;
		onDeploy: () => void;
		onApplySeed: () => void;
		onPersistSettings: () => void;
		onApplyMapPreset: () => void;
		onApplySeedPreset: (seed: number) => void;
		onApplyMatchSettings: () => void;
	}
	let {
		phase,
		stateCount,
		mapWidth,
		mapHeight,
		seedHex,
		rendererReady,
		canDeploy,
		deployLabel,
		seedInput = $bindable(''),
		matchSettings = $bindable(),
		settingsDirty,
		onDeploy,
		onApplySeed,
		onPersistSettings,
		onApplyMapPreset,
		onApplySeedPreset,
		onApplyMatchSettings
	}: Props = $props();
</script>

<div class="overlay intro-overlay" role="dialog" aria-modal="true" aria-labelledby="intro-title">
	<div class="intro-rail">
		<span>LAT 61.22 N</span>
		<span>LON 08.44 E</span>
		<span>WORLD {seedHex}</span>
	</div>

	<div class="intro-content">
		<div class="intro-copy">
			<p class="overlay-kicker">
				<span class="kicker-line"></span>FRONTAGE SYSTEM / SUPPLY WAR
			</p>
			<h2 id="intro-title">DRAW THE<br /><em>FRONTIER.</em></h2>
			<p class="intro-lede">
				Durable fronts spend supply, strength, and terrain defense against
				{stateCount} deterministic states fighting over the same pixel atlas.
			</p>

			<div class="spec-strip">
				<div><strong>{mapWidth} × {mapHeight}</strong><span>PIXEL ATLAS</span></div>
				<div><strong>{TICK_RATE} HZ</strong><span>FIXED SIMULATION</span></div>
				<div><strong>WEBGPU</strong><span>DIRTY-TILE RENDER</span></div>
				<div><strong>{stateCount}</strong><span>STATES DEPLOYED</span></div>
			</div>

			<div class="intro-actions">
				<button class="deploy-button" type="button" onclick={onDeploy} disabled={!canDeploy}>
					<span>{deployLabel}</span>
					<svg viewBox="0 0 16 16" aria-hidden="true">
						<path d="M2 8h11M9 3.5 13.5 8 9 12.5" />
					</svg>
				</button>
				<div class="seed-loader">
					<label for="seed-input">WORLD SEED / HEX</label>
					<div>
						<input
							id="seed-input"
							bind:value={seedInput}
							spellcheck="false"
							autocomplete="off"
							maxlength="10"
							inputmode="text"
						/>
						<button type="button" onclick={onApplySeed} disabled={!rendererReady}>LOAD</button>
					</div>
				</div>
			</div>

			<p class="intro-footnote">
				Frontage prototype: {stateCount - 1} AI states fight for 70% of the land while you build with
				a single supply economy. Fronts cost supply, trade strength on contact, and can be cancelled.
				Share a seed to replay the same test.
			</p>
		</div>

		<aside class="intro-brief">
			<div class="brief-head">
				<span>FIELD BRIEF / 01</span>
				<span class="brief-status"><i></i>{rendererReady ? 'READY' : 'LINKING'}</span>
			</div>
			<h3>SUPPLY IS<br />THE ONLY VERB.</h3>
			<ol>
				<li>
					<span>01</span>
					<p>Click any land touching your frontier to buy a front with supply.</p>
				</li>
				<li>
					<span>02</span>
					<p>
						Each front buys durable strength. Barracks add attack strength and logarithmic speed and
						piercing; fronts spend strength on captures and mutual attrition.
					</p>
				</li>
				<li>
					<span>03</span>
					<p>Take 70% of the land to win. Build cards and terrain defense shape the front.</p>
				</li>
			</ol>
			<div class="match-setup">
				<div class="setup-head">
					<span>MATCH SETUP</span>
					<span class:dirty={settingsDirty}>{settingsDirty ? 'CHANGED' : 'READY'}</span>
				</div>
				<label>
					<span>STATES</span>
					<select bind:value={matchSettings.states} onchange={onPersistSettings}>
						{#each STATE_COUNT_OPTIONS as count (count)}
							<option value={count}>{count} STATES</option>
						{/each}
					</select>
				</label>
				<label>
					<span>MAP SIZE</span>
					<select bind:value={matchSettings.mapPreset} onchange={onApplyMapPreset}>
						{#each MAP_PRESETS as preset (preset.id)}
							<option value={preset.id}>{preset.label}</option>
						{/each}
					</select>
				</label>
				<label>
					<span>WIDTH</span>
					<input
						type="number"
						min="512"
						max="8192"
						step="16"
						bind:value={matchSettings.mapWidth}
						onchange={onPersistSettings}
					/>
				</label>
				<label>
					<span>HEIGHT</span>
					<input
						type="number"
						min="256"
						max="8192"
						step="16"
						bind:value={matchSettings.mapHeight}
						onchange={onPersistSettings}
					/>
				</label>
				<label>
					<span>BOT DIFFICULTY</span>
					<select bind:value={matchSettings.difficulty} onchange={onPersistSettings}>
						{#each BOT_DIFFICULTY_OPTIONS as option (option.id)}
							<option value={option.id}>{option.label}</option>
						{/each}
					</select>
				</label>
				<label>
					<span>MATCH TIMER</span>
					<select bind:value={matchSettings.timerMinutes} onchange={onPersistSettings}>
						{#each TIMER_OPTIONS as minutes (minutes)}
							<option value={minutes}>{minutes === 0 ? 'NO TIMER' : `${minutes} MIN`}</option>
						{/each}
					</select>
				</label>
				<label>
					<span>BOT COMMAND POSTS</span>
					<select
						bind:value={matchSettings.botCommandPostStacks}
						onchange={onPersistSettings}
						title="Grants every AI commander a starting Command Post with this many stacks"
					>
						{#each BOT_COMMAND_POST_STACK_OPTIONS as stacks (stacks)}
							<option value={stacks}>
								{stacks === 0 ? 'STANDARD' : `${stacks}-STACK SURGE`}
							</option>
						{/each}
					</select>
				</label>
				<div class="seed-presets">
					<span>QUICK SEED</span>
					<div>
						<button type="button" onclick={() => onApplySeedPreset(1234)}>1234</button>
						<button type="button" onclick={() => onApplySeedPreset(0xbeef)}>BEEF</button>
						<button type="button" onclick={() => onApplySeedPreset(randomSeed())}>RANDOM</button>
					</div>
				</div>
				<p class="setup-victory">
					VICTORY: 70% OF LAND, LAST STATE STANDING{matchSettings.timerMinutes > 0
						? ', OR TIMER LEADER'
						: ''}
				</p>
				<button
					class="setup-apply"
					type="button"
					onclick={onApplyMatchSettings}
					disabled={!settingsDirty && phase === 'ready'}
				>
					{settingsDirty ? 'REBUILD MATCH' : 'SETTINGS APPLIED'}
				</button>
			</div>
			<div class="brief-footer">
				<span>MAP SEED</span>
				<strong>{seedHex}</strong>
			</div>
		</aside>
	</div>

	<div class="intro-footbar">
		<span>BUILD {__APP_VERSION__} / PROTOCOL 38</span>
		<span>WEBGPU RENDERER REQUIRED</span>
		<span>DRAG TO PAN · SCROLL TO ZOOM</span>
	</div>
</div>

<style>
	@media (max-width: 1180px) {
		.intro-content {
			grid-template-columns: minmax(0, 610px) minmax(240px, 290px);
			gap: 40px;
		}
		.intro-copy h2 {
			font-size: clamp(64px, 9.4vw, 120px);
		}
	}
	@media (max-width: 900px) {
		.intro-overlay {
			padding: 18px;
			overflow-y: auto;
		}
		.intro-content {
			grid-template-columns: 1fr;
			align-content: center;
			align-items: start;
			gap: 28px;
			min-height: 100%;
			padding: 40px 0 20px;
		}
		.intro-copy h2 {
			font-size: clamp(58px, 14vw, 100px);
		}
		.intro-brief {
			max-width: 520px;
		}
		.intro-footbar {
			display: none;
		}
		.intro-rail {
			display: none;
		}
		.intro-lede {
			font-size: 13px;
		}
	}
	@media (max-width: 620px) {
		.spec-strip div {
			padding: 8px 10px;
		}
		.spec-strip div:first-child {
			padding-left: 0;
		}
		.spec-strip strong {
			font-size: 14px;
		}
		.intro-actions {
			align-items: stretch;
			flex-direction: column;
		}
	}
	.intro-overlay {
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		align-items: stretch;
		padding: 24px 32px;
		background:
			linear-gradient(
				90deg,
				rgba(3, 9, 12, 0.9) 0%,
				rgba(3, 9, 12, 0.66) 38%,
				rgba(3, 9, 12, 0.26) 68%,
				rgba(3, 9, 12, 0.55) 100%
			),
			linear-gradient(0deg, rgba(3, 8, 11, 0.52), transparent 30%);
		backdrop-filter: blur(1px);
	}
	.intro-overlay::before {
		content: '';
		position: absolute;
		inset: 0;
		pointer-events: none;
		background-image:
			linear-gradient(rgba(183, 205, 184, 0.035) 1px, transparent 1px),
			linear-gradient(90deg, rgba(183, 205, 184, 0.035) 1px, transparent 1px);
		background-size: 80px 80px;
		mask-image: linear-gradient(90deg, black, transparent 62%);
	}
	.intro-rail {
		display: flex;
		gap: 22px;
		font-family: var(--font-mono);
		font-size: 7px;
		letter-spacing: 0.15em;
		color: var(--ink-faint);
	}
	.intro-rail span:first-child {
		color: var(--signal);
	}
	.intro-content {
		position: relative;
		display: grid;
		grid-template-columns: minmax(0, 690px) minmax(260px, 320px);
		justify-content: space-between;
		align-items: end;
		gap: clamp(40px, 9vw, 150px);
		width: 100%;
		max-width: 1680px;
		margin: 0 auto;
		padding: 24px 0;
	}
	.intro-copy {
		max-width: 720px;
	}
	.intro-copy .overlay-kicker {
		display: flex;
		align-items: center;
		gap: 9px;
		color: var(--signal);
	}
	.intro-copy h2 {
		margin: 15px 0 19px;
		font-family: var(--font-display);
		font-size: clamp(66px, 9.6vw, 148px);
		font-weight: 700;
		line-height: 0.79;
		letter-spacing: -0.015em;
		text-transform: uppercase;
	}
	.intro-copy h2 em {
		font-style: normal;
		color: transparent;
		-webkit-text-stroke: 1px rgba(241, 236, 217, 0.78);
	}
	.intro-lede {
		max-width: 515px;
		margin: 0 0 27px;
		font-size: 14px;
		font-weight: 350;
		line-height: 1.65;
		color: var(--ink-dim);
	}
	.spec-strip {
		display: flex;
		flex-wrap: wrap;
		gap: 0;
		max-width: 620px;
		margin-bottom: 27px;
		border-top: 1px solid var(--line-soft);
		border-bottom: 1px solid var(--line-soft);
	}
	.spec-strip div {
		display: flex;
		flex-direction: column;
		gap: 3px;
		padding: 10px 18px;
		border-right: 1px solid var(--line-soft);
	}
	.spec-strip div:first-child {
		padding-left: 0;
	}
	.spec-strip div:last-child {
		border-right: 0;
	}
	.spec-strip strong {
		font-family: var(--font-display);
		font-size: 17px;
		font-weight: 600;
		letter-spacing: 0.04em;
		color: var(--ink);
	}
	.spec-strip span {
		font-family: var(--font-mono);
		font-size: 6.5px;
		letter-spacing: 0.1em;
		color: var(--ink-faint);
	}
	.intro-actions {
		display: flex;
		align-items: flex-end;
		gap: 20px;
		flex-wrap: wrap;
	}
	.seed-loader {
		display: flex;
		flex-direction: column;
		gap: 5px;
	}
	.seed-loader label {
		font-family: var(--font-mono);
		font-size: 7px;
		letter-spacing: 0.12em;
		color: var(--ink-faint);
	}
	.seed-loader > div {
		display: flex;
		height: 30px;
	}
	.seed-loader input {
		width: 105px;
		padding: 0 8px;
		border: 1px solid var(--line-strong);
		border-right: 0;
		border-radius: 0;
		background: rgba(3, 9, 12, 0.65);
		font-family: var(--font-mono);
		font-size: 10px;
		letter-spacing: 0.12em;
		color: var(--ink);
	}
	.seed-loader button {
		padding: 0 11px;
		border: 1px solid var(--line-strong);
		background: transparent;
		font-family: var(--font-mono);
		font-size: 7px;
		letter-spacing: 0.08em;
		color: var(--ink-dim);
		cursor: pointer;
	}
	.seed-loader button:hover:not(:disabled) {
		color: var(--signal);
		border-color: var(--signal);
	}
	.seed-loader button:disabled {
		opacity: 0.35;
		cursor: wait;
	}
	.intro-footnote {
		margin: 18px 0 0;
		font-family: var(--font-mono);
		font-size: 7px;
		line-height: 1.6;
		letter-spacing: 0.03em;
		color: var(--ink-faint);
	}
	.intro-brief {
		position: relative;
		padding: 15px 16px 0;
		border: 1px solid var(--line-strong);
		background: rgba(5, 13, 18, 0.62);
		backdrop-filter: blur(16px);
	}
	.intro-brief::before {
		content: '';
		position: absolute;
		top: -1px;
		left: -1px;
		width: 18px;
		height: 18px;
		border-top: 1px solid var(--signal);
		border-left: 1px solid var(--signal);
	}
	.brief-head {
		display: flex;
		justify-content: space-between;
		padding-bottom: 11px;
		border-bottom: 1px solid var(--line-soft);
		font-family: var(--font-mono);
		font-size: 7px;
		letter-spacing: 0.12em;
		color: var(--ink-faint);
	}
	.brief-status {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		color: var(--signal);
	}
	.brief-status i {
		width: 4px;
		height: 4px;
		border-radius: 50%;
		background: var(--signal);
		box-shadow: 0 0 6px var(--signal);
	}
	.intro-brief h3 {
		margin: 18px 0 16px;
		font-family: var(--font-display);
		font-size: 27px;
		font-weight: 600;
		line-height: 0.94;
		letter-spacing: 0.035em;
	}
	.intro-brief ol {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.intro-brief li {
		display: flex;
		gap: 10px;
		padding: 10px 0;
		border-top: 1px solid var(--line-soft);
	}
	.intro-brief li > span {
		flex: none;
		font-family: var(--font-mono);
		font-size: 8px;
		color: var(--signal);
	}
	.intro-brief li p {
		margin: 0;
		font-size: 10px;
		line-height: 1.5;
		color: var(--ink-dim);
	}
	.match-setup {
		margin: 14px 0 8px;
		padding: 12px 0 10px;
		border-top: 1px solid var(--line-strong);
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.setup-head {
		display: flex;
		justify-content: space-between;
		font-family: var(--font-mono);
		font-size: 7px;
		letter-spacing: 0.08em;
		color: var(--ink-dim);
	}
	.setup-head span:last-child {
		color: var(--signal);
	}
	.setup-head .dirty {
		color: #ffd166;
	}
	.match-setup label {
		display: grid;
		grid-template-columns: 88px minmax(0, 1fr);
		align-items: center;
		gap: 8px;
		font-family: var(--font-mono);
		font-size: 7px;
		letter-spacing: 0.05em;
		color: var(--ink-dim);
	}
	.match-setup select {
		width: 100%;
		padding: 5px 6px;
		border: 1px solid var(--line-strong);
		border-radius: 0;
		background: rgba(5, 14, 18, 0.9);
		color: var(--ink);
		font-family: var(--font-mono);
		font-size: 8px;
		letter-spacing: 0.03em;
	}
	.seed-presets {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		font-family: var(--font-mono);
		font-size: 7px;
		letter-spacing: 0.05em;
		color: var(--ink-dim);
	}
	.seed-presets div {
		display: flex;
		gap: 4px;
	}
	.seed-presets button {
		padding: 4px 6px;
		border: 1px solid var(--line-strong);
		background: transparent;
		color: var(--ink-dim);
		font-family: var(--font-mono);
		font-size: 7px;
		cursor: pointer;
	}
	.seed-presets button:hover {
		color: var(--signal);
		border-color: var(--signal);
	}
	.setup-victory {
		margin: 2px 0;
		font-family: var(--font-mono);
		font-size: 6.5px;
		line-height: 1.5;
		letter-spacing: 0.04em;
		color: var(--ink-dim);
	}
	.setup-apply {
		padding: 7px 8px;
		border: 1px solid var(--line-strong);
		background: rgba(220, 233, 149, 0.08);
		color: var(--signal);
		font-family: var(--font-mono);
		font-size: 8px;
		letter-spacing: 0.06em;
		cursor: pointer;
	}
	.setup-apply:disabled {
		cursor: default;
		color: var(--ink-dim);
		opacity: 0.55;
	}
	.brief-footer {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		margin: 8px -16px 0;
		padding: 10px 16px;
		border-top: 1px solid var(--line-soft);
		font-family: var(--font-mono);
		font-size: 7px;
		letter-spacing: 0.1em;
		color: var(--ink-faint);
	}
	.brief-footer strong {
		font-size: 10px;
		font-weight: 500;
		color: var(--ink);
	}
	.intro-footbar {
		display: flex;
		justify-content: space-between;
		gap: 20px;
		padding-top: 14px;
		border-top: 1px solid var(--line-soft);
		font-family: var(--font-mono);
		font-size: 7px;
		letter-spacing: 0.1em;
		color: var(--ink-faint);
	}
</style>
