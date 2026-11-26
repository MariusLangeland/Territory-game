import { TICK_RATE } from '../constants';
import { DEFAULT_GROWTH_MODE } from '../growth';
import { normalizeMatchSettings, type MatchSettings } from '../match-config';
import { difficultyGenomes, loadEvolutionBuckets } from '../ai/buckets';
import { loadGauntletSurvivors } from '../ai/gauntlet-survivors';
import type { BotGenome } from '../ai/genome';
import { WorkerLocalSimulation } from '../worker/local-simulation';
import type { LocalWorkerCommandType, LocalWorkerVisual } from '../worker/local-protocol';
import type { OnlineIntent } from '../net/online-protocol';

interface MatchViewHandlers {
	onReady: (simulation: WorkerLocalSimulation, seed: number) => void;
	onVisual: (visual: LocalWorkerVisual) => void;
	onTelemetry: () => void;
	onError: (error: Error) => void;
}

/**
 * Main-thread match view. It owns worker creation, bot roster loading, command
 * routing, viewer seat configuration, and generation-safe disposal. Transport
 * and ledger details stay behind the frontend/ledger boundaries.
 */
export class MatchView {
	private simulation: WorkerLocalSimulation | null = null;
	private generation = 0;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private authoritativeInput = false;
	private humanPlayerIds: readonly number[] | undefined;
	private viewerPlayerId: number | undefined;
	private playerNames: readonly string[] | undefined;
	private commandHandler:
		| ((
				type: LocalWorkerCommandType,
				args: Parameters<WorkerLocalSimulation['command']>[1]
		  ) => Promise<{ ok: boolean; reason?: string; message: string }>)
		| null = null;
	private readonly pendingRemoteIntents: {
		tick: number;
		playerId: number;
		intent: OnlineIntent;
	}[] = [];

	constructor(private readonly handlers: MatchViewHandlers) {}

	get current(): WorkerLocalSimulation | null {
		return this.simulation;
	}

	start(seed: number, settings: MatchSettings): void {
		const normalized = normalizeMatchSettings(settings);
		const generation = ++this.generation;
		this.clearTimer();
		this.simulation?.dispose();
		this.simulation = null;
		// Yield once so the loading screen paints before worker startup.
		this.timer = setTimeout(() => {
			void this.create(seed >>> 0, normalized, generation);
		}, 40);
	}

	private async create(seed: number, settings: MatchSettings, generation: number): Promise<void> {
		try {
			const botGenomes = await this.loadBotGenomes(seed, settings);
			if (generation !== this.generation) return;
			const next = await WorkerLocalSimulation.create(
				{
					seed,
					playerCount: settings.states,
					width: settings.mapWidth,
					height: settings.mapHeight,
					growthMode: DEFAULT_GROWTH_MODE,
					botDifficulty: settings.difficulty,
					matchDurationTicks: settings.timerMinutes * 60 * TICK_RATE,
					botGenomes,
					botCommandPostStacks: settings.botCommandPostStacks,
					humanPlayerIds: this.humanPlayerIds,
					viewerPlayerId: this.viewerPlayerId,
					playerNames: this.playerNames,
					authoritativeInput: this.authoritativeInput
				},
				{
					onVisual: (visual) => {
						if (generation === this.generation) this.handlers.onVisual(visual);
					},
					onTelemetry: () => {
						if (generation === this.generation) this.handlers.onTelemetry();
					},
					onError: (error) => {
						if (generation === this.generation) this.handlers.onError(error);
					}
				}
			);
			if (generation !== this.generation) {
				next.dispose();
				return;
			}
			this.simulation = next;
			next.pause();
			this.flushPendingIntents();
			this.handlers.onReady(next, seed);
		} catch (error) {
			if (generation !== this.generation) return;
			this.handlers.onError(error instanceof Error ? error : new Error(String(error)));
		}
	}

	private flushPendingIntents(): void {
		if (!this.simulation) return;
		for (const pending of this.pendingRemoteIntents.splice(0)) {
			this.simulation.applyRemoteIntent(pending.tick, pending.playerId, pending.intent);
		}
	}

	private async loadBotGenomes(
		seed: number,
		settings: MatchSettings
	): Promise<(BotGenome | null)[] | undefined> {
		const survivorPool = await loadGauntletSurvivors();
		const savedPool = difficultyGenomes(loadEvolutionBuckets(), settings.difficulty);
		const botPool = [...survivorPool, ...savedPool];
		if (botPool.length === 0) return undefined;
		return Array.from({ length: settings.states }, (_, index) =>
			index === 0 ? null : botPool[(seed + index) % botPool.length]
		);
	}

	pause(): void {
		this.simulation?.pause();
	}

	resume(): void {
		this.simulation?.resume();
	}

	setAuthoritativeInput(value: boolean): void {
		this.authoritativeInput = value;
	}

	setRoomPlayers(
		humanPlayerIds: readonly number[],
		viewerPlayerId: number,
		playerNames: readonly string[]
	): void {
		this.humanPlayerIds = [...humanPlayerIds];
		this.viewerPlayerId = viewerPlayerId;
		this.playerNames = [...playerNames];
	}

	setCommandHandler(
		handler:
			| ((
					type: LocalWorkerCommandType,
					args: Parameters<WorkerLocalSimulation['command']>[1]
			  ) => Promise<{ ok: boolean; reason?: string; message: string }>)
			| null
	): void {
		this.commandHandler = handler;
	}

	applyRemoteIntent(tick: number, playerId: number, intent: OnlineIntent): void {
		if (!this.simulation) {
			this.pendingRemoteIntents.push({ tick, playerId, intent });
			return;
		}
		this.simulation.applyRemoteIntent(tick, playerId, intent);
	}

	command(
		type: LocalWorkerCommandType,
		args: Parameters<WorkerLocalSimulation['command']>[1] = {}
	): Promise<{ ok: boolean; reason?: string; message: string }> {
		if (this.commandHandler) return this.commandHandler(type, args);
		if (!this.simulation) {
			return Promise.resolve({ ok: false, message: 'Match worker is not ready.' });
		}
		return this.simulation.command(type, args);
	}

	dispose(): void {
		this.generation++;
		this.clearTimer();
		this.simulation?.dispose();
		this.simulation = null;
		this.pendingRemoteIntents.length = 0;
	}

	private clearTimer(): void {
		if (!this.timer) return;
		clearTimeout(this.timer);
		this.timer = null;
	}
}
