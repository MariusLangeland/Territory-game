import { onMount } from 'svelte';
import { createLabActions, type LabActionsController } from './lab-actions.svelte';
import { createEvolutionPageState, type EvolutionPageState } from './lab-state.svelte';
import {
	createLabWorkerController,
	type LabWorkerController
} from './lab-worker-controller.svelte';

export type EvolutionPageApi = EvolutionPageState & LabWorkerController & LabActionsController;

/**
 * Composition root for the Evolution Lab route, mirroring the main-game
 * `src/lib/game/page/game-page.svelte.ts` facade. The merge target is the state
 * object itself, so its live getter/setter accessors survive and `bind:` values
 * in the route keep working: the derived/static additions are methods only.
 */
export function createEvolutionPage(): EvolutionPageApi {
	const state = createEvolutionPageState();
	const worker = createLabWorkerController(state);
	const actions = createLabActions(state, worker);
	const page = Object.assign(state, worker, actions);

	onMount(() => {
		worker.attach();
		return () => worker.dispose();
	});

	return page;
}
