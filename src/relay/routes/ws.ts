import type { FastifyInstance } from 'fastify';
import { log } from '@/shared/log';
import type { ServerMsg } from '@/shared/protocol';

// The gate stashes the verified address here for the handler to read.
declare module 'fastify' {
	interface FastifyRequest {
		authAddress?: string;
	}
}

interface WsQuery {
	token?: string;
}

export async function wsRoutes(app: FastifyInstance): Promise<void> {
	app.get<{ Querystring: WsQuery }>(
		'/ws',
		{
			websocket: true,
			preValidation: async (req, reply) => {
				try {
					const claims = app.jwt.verify<{ address?: string }>(
						req.query.token ?? '',
					);
					if (!claims.address) throw new Error('token has no address');
					req.authAddress = claims.address;
				} catch {
					await reply.code(401).send({ error: 'unauthorized' });
				}
			},
		},
		(socket, req) => {
			const address = req.authAddress ?? '';
			log('info', 'ws connected', address);

			const ready: ServerMsg = { t: 'ready', address };
			socket.send(JSON.stringify(ready));

			socket.on('close', () => log('info', 'ws disconnected', address));
		},
	);
}
