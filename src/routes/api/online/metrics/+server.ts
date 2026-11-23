import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { onlineMetrics } from '#lib/server/online';

export const GET: RequestHandler = () => {
	return json({ ...onlineMetrics(), tickRate: 10 });
};
