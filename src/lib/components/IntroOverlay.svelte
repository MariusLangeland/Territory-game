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
