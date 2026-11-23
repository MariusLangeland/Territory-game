import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { submitIntent } from '#lib/server/online';
import { isOnlineIntent } from '#lib/game/net/online-protocol';

export const POST: RequestHandler = async ({ params, request }) => {
	try {
		const token = request.headers.get('x-online-token') ?? '';
		const body = await request.json();
		if (!Number.isSafeInteger(body?.sequence) || body.sequence < 0) {
			return json({ error: 'sequence must be a non-negative integer.' }, { status: 400 });
		}
		if (!isOnlineIntent(body?.intent)) {
			return json({ error: 'Unknown command.' }, { status: 400 });
		}
		return json(submitIntent(params.roomId, token, body));
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Could not submit the command.';
		return json({ error: message }, { status: 400 });
	}
};
