import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { roomView } from '#lib/server/online';

export const GET: RequestHandler = ({ params }) => {
	try {
		return json({ room: roomView(params.roomId) });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Match not found.';
		return json({ error: message }, { status: 404 });
	}
};
