<script lang="ts">
	import './game-page.css';
	import ReplayViewer from '#lib/components/ReplayViewer.svelte';
	import CardTray from '#lib/components/CardTray.svelte';
	import GameTopBar from '#lib/components/GameTopBar.svelte';
	import WorldRail from '#lib/components/WorldRail.svelte';
	import DiplomacyToast from '#lib/components/DiplomacyToast.svelte';
	import StructureMenu from '#lib/components/StructureMenu.svelte';
	import SupplyPanel from '#lib/components/SupplyPanel.svelte';
	import UpgradeBatchStrip from '#lib/components/UpgradeBatchStrip.svelte';
	import NavalTargetPreview from '#lib/components/NavalTargetPreview.svelte';
	import MapTools from '#lib/components/MapTools.svelte';
	import DragOverlay from '#lib/components/DragOverlay.svelte';
	import RoomSelectScreen from '#lib/components/RoomSelectScreen.svelte';
	import LoadingOverlay from '#lib/components/LoadingOverlay.svelte';
	import ErrorModal from '#lib/components/ErrorModal.svelte';
	import ResultModal from '#lib/components/ResultModal.svelte';
	import DefeatModal from '#lib/components/DefeatModal.svelte';
	import HelpOverlay from '#lib/components/HelpOverlay.svelte';
	import OnboardingHint from '#lib/components/OnboardingHint.svelte';
	import KeyboardCursor from '#lib/components/KeyboardCursor.svelte';
	import UpgradeTooltip from '#lib/components/UpgradeTooltip.svelte';
	import Minimap from '#lib/components/Minimap.svelte';
	import { createGamePage } from '#lib/game/page/game-page.svelte';

	const game = createGamePage();
</script>

<svelte:head>
	<title>TERRITORY — Frontage v1</title>
</svelte:head>

<main
	class="game-shell"
	ondragover={game.handleDragOver}
	ondrop={game.handleCardDrop}
	oncontextmenu={game.handleContextMenu}
>
	{#if game.landing}
		<RoomSelectScreen onConnect={game.connectRoom} />
	{/if}

	{#if game.diplomacyToast}
		<DiplomacyToast message={game.diplomacyToast.message} tone={game.diplomacyToast.tone} />
	{/if}
	{#if game.upgradeTooltip}
		<UpgradeTooltip tooltip={game.upgradeTooltip} />
	{/if}
	{#if game.structureMenu}
		<StructureMenu
			bind:menuElement={game.contextMenuEl}
			menu={game.structureMenu}
			paused={game.paused}
			diplomacyRemaining={game.diplomacyRemaining}
			onRequestDemolish={game.requestDemolish}
			onCancelDemolish={game.cancelDemolishConfirm}
			onConfirmDemolish={game.demolishStructure}
			onRequestAlliance={game.requestAlliance}
			onBreakAlliance={game.breakAlliance}
			onClose={game.closeStructureMenu}
		/>
	{/if}
	{#if game.sim}
		{#key game.sim}
			<ReplayViewer
				simulation={game.sim}
				paused={game.paused}
				simulate={false}
				remoteVisuals={game.workerVisuals}
				onRemoteVisualsApplied={game.acknowledgeWorkerVisuals}
				targeting={game.artilleryTargeting}
				allyTarget={game.hoverIsAlly}
				mergeDistricts={!game.ctrlHeld}
				highlightType={game.draggingCard?.type ?? null}
				cameraBridge={game.cameraBridge}
				onTick={game.handleTick}
				onHover={game.handleHover}
				onAttack={game.replayMode ? undefined : game.actions.handleAttack}
				onReady={game.handleReady}
				onError={game.handleError}
				onPerf={game.handlePerf}
				replay={game.replayMode
					? {
							tick: game.replayTick,
							maxTick: game.replayMaxTick,
							playing: game.replayPlaying,
							speed: game.replaySpeed,
							complete: game.replayComplete,
							blocks: game.replayBlocks,
							currentTick: game.replayTick,
							onSeek: game.seekReplay,
							onToggle: game.toggleReplayPlay,
							onStep: game.stepReplay,
							onSpeed: game.setReplaySpeed
						}
					: null}
			/>
			{#if game.keyboardCursorScreen && game.keyboardCursor}
				<KeyboardCursor
					position={game.keyboardCursorScreen}
					allied={game.keyboardCursorAllied}
					status={game.keyboardCursorStatus}
				/>
			{/if}
		{/key}
	{/if}

	<div class="map-atmosphere" aria-hidden="true"></div>

	{#if game.gameStarted && !game.showIntro && game.phase === 'ready' && game.sim && game.snapshot && game.human}
		<GameTopBar
			human={game.human}
			humanStructure={Boolean(game.humanStructure)}
			humanAllyName={game.humanAllyName ?? null}
			humanAlliancePending={Boolean(game.humanAlliancePending)}
			humanRank={game.humanRank}
			aliveCount={game.aliveCount}
			stateCount={game.stateCount}
			matchClock={game.matchClock}
			matchTimeRemaining={game.matchTimeRemaining}
			paused={game.paused}
			showResult={game.showResult}
			roomName={game.activeRoom?.name ?? null}
			onLeaveRoom={game.leaveRoom}
			onTogglePause={game.togglePause}
			onOpenHelp={() => (game.showHelp = true)}
			onOnline={() => game.goto('/online')}
			onEvolution={() => game.goto('/evolution')}
			onNewWorld={game.newWorld}
		/>

		{#if game.replayMode}
			<div class="replay-banner hud">
				<span>LEDGER REPLAY</span>
				<strong>{game.replayName}</strong>
				{#if game.replayComplete}<em>COMPLETE</em>{/if}
				<button type="button" onclick={game.rematch}>EXIT REPLAY</button>
			</div>
		{/if}

		{#if game.onboardingVisible && game.onboardingCopy}
			<OnboardingHint copy={game.onboardingCopy} onSkip={game.finishOnboarding} />
		{/if}

		<WorldRail
			snapshot={game.snapshot}
			human={game.human}
			ranked={game.ranked}
			visibleRanked={game.visibleRanked}
			rankWindow={game.rankWindow}
			rankRowHeight={game.RANK_ROW_HEIGHT}
			bind:rankScrollElement={game.rankScrollEl}
			worldClaim={game.worldClaim}
			aliveCount={game.aliveCount}
			seedHex={game.seedHex}
			eventFeed={game.eventFeed}
			onRankScroll={game.handleRankScroll}
		/>

		<div class="minimap-dock hud">
			<Minimap
				simulation={game.sim}
				snapshot={game.snapshot}
				cameraView={game.cameraView}
				onNavigate={game.navigateFromMinimap}
			/>
			<div class="minimap-meta">
				<span>ATLAS / {game.mapWidth} × {game.mapHeight}</span>
				<span>{game.scaleLegend}</span>
			</div>
		</div>

		<MapTools
			perf={game.perf}
			onZoomIn={() => game.cameraBridge.zoomIn()}
			onZoomOut={() => game.cameraBridge.zoomOut()}
			onFit={() => game.cameraBridge.fitMap()}
			onFocus={() => game.cameraBridge.focusHuman()}
		/>

		{#if !game.replayMode}
			<SupplyPanel
				snapshot={game.snapshot}
				supplyBar={game.supplyBar}
				supplyPreview={game.supplyPreview}
				humanFronts={game.humanFronts}
				humanArtillery={game.humanArtillery}
				readyArtillery={game.readyArtillery}
				readyArtilleryShells={game.readyArtilleryShells}
				artilleryVolleyCost={game.artilleryVolleyCost}
				artilleryTargeting={game.artilleryTargeting}
				onCancelFront={game.actions.cancelLatestFront}
				onToggleArtillery={game.actions.toggleArtilleryTargeting}
			/>
			{#if !game.showResult && !game.defeatOpen && !game.showHelp}
				<UpgradeBatchStrip
					upgradeBatch={game.upgradeBatch}
					onSetUpgradeBatch={(batch) => (game.upgradeBatch = batch)}
				/>
			{/if}
			<CardTray
				snapshot={game.snapshot}
				handRaised={game.handRaised}
				bind:handShellElement={game.handShellEl}
				draggingCardId={game.draggingCardId}
				onStartDrag={game.startCardDrag}
				onDrag={game.updateDragHover}
				onDragEnd={game.endCardDrag}
				onRaise={() => (game.handRaised = true)}
			/>
			{#if game.draggingCardId !== null && game.dragOrigin && game.dragPointer && game.dragArrow}
				<DragOverlay
					origin={game.dragOrigin}
					landing={game.dragLanding}
					arrow={game.dragArrow}
					accent={game.dragAccent}
				/>
			{/if}
			{#if game.navalPreviewScreen}
				<NavalTargetPreview x={game.navalPreviewScreen.x} y={game.navalPreviewScreen.y} />
			{/if}
		{/if}
		{#if game.paused && !game.showResult}
			<div class="paused-flag hud">SIMULATION PAUSED <span>SPACE TO RESUME</span></div>
		{/if}
	{/if}

	{#if game.phase === 'loading'}
		<LoadingOverlay
			mapWidth={game.mapWidth}
			mapHeight={game.mapHeight}
			stateCount={game.stateCount}
		/>
	{/if}

	{#if game.phase === 'error'}
		<ErrorModal message={game.errorMessage} onReload={game.reload} />
	{/if}

	{#if game.showResult && game.snapshot}
		<ResultModal
			humanId={game.snapshot.humanId}
			winner={game.winner}
			humanRank={game.humanRank}
			worldClaim={game.worldClaim}
			matchClock={game.matchClock}
			seedHex={game.seedHex}
			ranked={game.ranked}
			aiPostMatch={game.aiPostMatch}
			aiOptionSummary={game.aiOptionSummary}
			onRematch={game.rematch}
			onCopySeed={game.copySeed}
			onNewWorld={game.newWorld}
			onOpenHelp={() => (game.showHelp = true)}
		/>
	{/if}

	{#if game.defeatOpen && !game.showResult && game.human && game.snapshot}
		<DefeatModal
			human={game.human}
			tick={game.snapshot.tick}
			matchClock={game.matchClock}
			humanRank={game.humanRank}
			aliveCount={game.aliveCount}
			onSpectate={game.spectate}
			onRematch={game.rematch}
			onNewWorld={game.newWorld}
		/>
	{/if}

	{#if game.showHelp}
		<HelpOverlay
			stateCount={game.stateCount}
			mapWidth={game.mapWidth}
			mapHeight={game.mapHeight}
			onClose={() => (game.showHelp = false)}
			onExportLedger={() => void game.exportLedger()}
			onUploadLedger={(file) => void game.startReplayFile(file)}
		/>
	{/if}
</main>
