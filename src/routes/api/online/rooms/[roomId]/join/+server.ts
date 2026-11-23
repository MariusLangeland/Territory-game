import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { joinRoom } from '#lib/server/online';

export const POST: RequestHandler = async ({ params, request }) => {
	try {
		const body = await request.json();
		const name = typeof body?.displayName === 'string' ? body.displayName.trim().slice(0, 24) : '';
		if (!name) return json({ error: 'A display name is required.' }, { status: 400 });
		return json(joinRoom(params.roomId, name), { status: 201 });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Could not join the room.';
		return json({ error: message }, { status: 400 });
	}
};
