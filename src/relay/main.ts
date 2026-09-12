import { H3, handleCors, serve } from 'h3';
import { log } from '@/shared/log.ts';
import { config } from './config.ts';
import { initDb } from './db/index.ts';
import {
	challengeHandler,
	editDiscoverableHandler,
	editHandleHandler,
	getMeHandler,
	requireAuth,
	verifyHandler,
} from './services/auth.ts';
import {
	presenceHandler,
	randomMatchHandler,
	readMessageHandler,
	sendMessageHandler,
	streamMessagesHandler,
	watchMessages,
} from './services/messaging.ts';
import { editPushSubscriptionHandler, initPush } from './services/push.ts';
import { getUserHandler, redirectUserHandler } from './services/user.ts';

/** Build the app: every endpoint, its middleware, and how errors become
 * responses. Separate from {@link main} so it can be built without opening a
 * port or connecting anything — the tests serve it themselves, so what they
 * exercise is this route table rather than a replica of it. */
export function createApp(): H3 {
	// Centralised error handling: every error — zod validation, an explicit
	// HTTPError, an unmatched route, or something unexpected — becomes a
	// `{ error }` JSON body with the right status.
	const app = new H3({
		onError: (error, event) => {
			event.res.status = error.status;
			if (error.unhandled) {
				log('error', 'unhandled error', error.cause ?? error);
				return { error: 'internal server error' };
			}
			const issues = (error.data as { issues?: { message?: string }[] })
				?.issues;
			return { error: issues?.[0]?.message ?? error.message };
		},
	});

	// CORS for every route; preflight requests are answered here and stop.
	app.use((event) => {
		const cors = handleCors(event, {
			origin: config.corsOrigin,
			methods: '*',
		});
		if (cors !== false) return cors;
	});

	app.post('/auth/challenge', challengeHandler);
	app.post('/auth/verify', verifyHandler);
	app.get('/auth/me', getMeHandler, { middleware: [requireAuth] });
	app.patch('/auth/me/handle', editHandleHandler, {
		middleware: [requireAuth],
	});
	app.patch('/auth/me/discoverable', editDiscoverableHandler, {
		middleware: [requireAuth],
	});
	app.put('/auth/me/push-subscription', editPushSubscriptionHandler, {
		middleware: [requireAuth],
	});
	app.put('/auth/me/handle', editPushSubscriptionHandler, {
		middleware: [requireAuth],
	});
	app.get('/messages', streamMessagesHandler, { middleware: [requireAuth] });
	app.post('/messages', sendMessageHandler, {
		middleware: [requireAuth],
	});
	app.delete('/messages/:id', readMessageHandler, {
		middleware: [requireAuth],
	});
	app.get('/presence/:address', presenceHandler, { middleware: [requireAuth] });
	app.post('/random', randomMatchHandler, { middleware: [requireAuth] });
	app.get('/handles/:handle', redirectUserHandler('/users/:address'));
	app.get('/users/:address', getUserHandler);

	return app;
}

async function main() {
	await initDb();
	initPush();
	await watchMessages();

	serve(createApp(), { port: config.port, hostname: config.host });

	log('info', `relay listening on http://${config.host}:${config.port}`);
}

// Only when this file *is* the process — so importing `createApp` (the tests
// do) never connects to anything or takes a port.
if (import.meta.filename === process.argv[1]) {
	main().catch((err) => {
		log('error', 'relay failed to start', err);
		process.exit(1);
	});
}
