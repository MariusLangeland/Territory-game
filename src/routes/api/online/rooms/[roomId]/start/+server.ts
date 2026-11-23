import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { startRoom } from '#lib/server/online';

export const POST: RequestHandler = ({ params, request }) => {
	const token = request.headers.get('x-online-token') ?? '';
	try {
		return json({ room: startRoom(params.roomId, token) });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Could not start the match.';
		return json({ error: message }, { status: 400 });
	}
};
