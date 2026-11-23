import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { subscribeRoom, validateSession } from '#lib/server/online';
import type { OnlineServerEvent } from '#lib/server/online';

export const GET: RequestHandler = ({ params, request, url }) => {
	const token = url.searchParams.get('token') ?? '';
	if (!validateSession(params.roomId, token)) {
		return json({ error: 'Unknown player session.' }, { status: 401 });
	}
	const encoder = new TextEncoder();
	let cleanup = () => {};
	let heartbeat: ReturnType<typeof setInterval> | null = null;
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			let closed = false;
			const close = () => {
				if (closed) return;
				closed = true;
				if (heartbeat) clearInterval(heartbeat);
				cleanup();
				try {
					controller.close();
				} catch {
					// Already closed by the client.
				}
			};
			const write = (event: OnlineServerEvent) => {
				if (closed) return;
				try {
					controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
				} catch {
					close();
				}
			};
			heartbeat = setInterval(() => {
				if (closed) return;
				try {
					controller.enqueue(encoder.encode(': keepalive\n\n'));
				} catch {
					close();
				}
			}, 15_000);
			request.signal.addEventListener('abort', close);
			try {
				cleanup = subscribeRoom(params.roomId, token, write);
			} catch {
				close();
			}
		},
		cancel() {
			cleanup();
			if (heartbeat) clearInterval(heartbeat);
		}
	});
	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-cache, no-transform',
			connection: 'keep-alive',
			'x-accel-buffering': 'no'
		}
	});
};
