import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createRoom, listRooms } from '#lib/server/online';
import type { OnlineRoomConfig } from '#lib/game/net/online-protocol';

const DEFAULT_CONFIG: OnlineRoomConfig = {
	totalStates: 8,
	maxHumans: 4,
	seed: 0,
	botDifficulty: 'standard',
	timerMinutes: 0,
	botCommandPostStacks: 0
};

function parseConfig(value: unknown): OnlineRoomConfig {
	if (!value || typeof value !== 'object') return DEFAULT_CONFIG;
	const input = value as Partial<OnlineRoomConfig>;
	const seed =
		Number.isSafeInteger(input.seed) && (input.seed ?? 0) >= 0
			? Number(input.seed)
			: Math.floor(Math.random() * 0xffffffff);
	return {
		totalStates: Number(input.totalStates ?? DEFAULT_CONFIG.totalStates),
		maxHumans: Number(input.maxHumans ?? DEFAULT_CONFIG.maxHumans),
		seed,
		botDifficulty:
			input.botDifficulty === 'relaxed' ||
			input.botDifficulty === 'ruthless' ||
			input.botDifficulty === 'standard'
				? input.botDifficulty
				: DEFAULT_CONFIG.botDifficulty,
		timerMinutes: Number(input.timerMinutes ?? DEFAULT_CONFIG.timerMinutes),
		botCommandPostStacks: Number(input.botCommandPostStacks ?? DEFAULT_CONFIG.botCommandPostStacks)
	};
}

export const GET: RequestHandler = () => {
	return json({ rooms: listRooms() });
};

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const name = typeof body?.displayName === 'string' ? body.displayName.trim().slice(0, 24) : '';
		if (!name) return json({ error: 'A display name is required.' }, { status: 400 });
		const created = createRoom(name, parseConfig(body?.config));
		return json(created, { status: 201 });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Could not create the room.';
		return json({ error: message }, { status: 400 });
	}
};
