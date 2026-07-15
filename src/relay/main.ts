import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import websocket from '@fastify/websocket';
import createFastifyApp from 'fastify';
import { log } from '@/shared/log.ts';
import { config } from './config.ts';
import { initDb } from './db/index.ts';
import { authRoutes } from './routes/auth.ts';
import { wsRoutes } from './routes/ws.ts';

async function main() {
	const app = createFastifyApp({ logger: false });

	await initDb();

	await app.register(cors, { origin: config.corsOrigin });
	await app.register(jwt, { secret: config.jwtSecret });
	await app.register(websocket);
	await app.register(authRoutes);
	await app.register(wsRoutes);

	await app.listen({ port: config.port, host: config.host });

	log('info', `relay listening on http://${config.host}:${config.port}`);
}

main().catch((err) => {
	log('error', 'relay failed to start', err);
	process.exit(1);
});
