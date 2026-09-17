/**
 * Everything the flow tests need standing up before any of them run: a
 * database with the schema on it, and a relay in front of it.
 *
 * Both are configured out of the environment the app itself reads, through the
 * relay's own {@link env} — `RELAY_DB_URL`, `RELAY_PORT`, `RELAY_HOST`,
 * `RELAY_JWT_SECRET`, checked there and nowhere else. Nothing here holds a test's
 * idea of any of them, so there is nothing for a test environment to drift away
 * from: whatever `npm run dev:relay` would connect to and listen on is what
 * these tests get.
 *
 * The database is the one `compose.dev.yml` serves — a real Postgres, so the
 * relay's raw SQL and its LISTEN/NOTIFY fanout are exercised against the thing
 * they run against in production. It is created on first use and never emptied.
 * Tests don't need it to be: each one signs up the people it needs, with fresh
 * keys nobody else holds, and asserts about those people only — so a run leaves
 * rows behind, the next run doesn't care, and pointing this at a database with
 * a history in it (the development one, which is exactly what `.env` names)
 * changes nothing.
 *
 * App code is imported inside `setup` rather than at the top because importing
 * `db/index.ts` opens a pool, and until the migration below has run there may
 * be no database for it to open one against.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from 'pg';
import { env as clientEnv } from '@/client/env.ts';
import { env } from '@/relay/env.ts';

const run = promisify(execFile);

/**
 * Refuse to run unless the client under test will be talking to the relay these
 * tests serve.
 */
function requireClientPointsHere(): void {
	const url = new URL(clientEnv.CLIENT_RELAY_URL);
	const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
	const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
	if (!local || port !== env.RELAY_PORT) {
		throw new Error(
			`CLIENT_RELAY_URL is ${url.origin}, but the tests serve their own relay ` +
				`on port ${env.RELAY_PORT} and the client has to reach that one.`,
		);
	}
}

/** Create the test database if this is the first run on this server, then bring
 * it up to the current schema. `migrate deploy` is what production runs and is
 * a no-op once there is nothing new to apply. */
async function migrate(): Promise<void> {
	const client = new Client({ connectionString: env.RELAY_DB_URL });
	try {
		await client.connect();
		await client.end();
	} catch (error) {
		// 3D000 is "database does not exist" — the only failure worth answering
		// for. Anything else (no server, wrong password) is the developer's to fix.
		if ((error as { code?: string }).code !== '3D000') throw error;
		const url = new URL(env.RELAY_DB_URL);
		const name = url.pathname.slice(1);
		url.pathname = '/postgres';
		const maintenance = new Client({ connectionString: url.toString() });
		await maintenance.connect();
		await maintenance.query(`create database "${name}"`);
		await maintenance.end();
	}
	// No environment passed: the child reads `RELAY_DB_URL` from this process,
	// which is where the relay read it from too.
	await run('npx', ['prisma', 'migrate', 'deploy']);
}

let stop: (() => Promise<void>) | undefined;

export async function setup(): Promise<void> {
	requireClientPointsHere();
	await migrate();
	// Web Push is left unconfigured on purpose. `main.ts` is what calls
	// `initPush()` and nothing here does, so the relay under test can never
	// reach out to whatever endpoint a subscription names — whatever VAPID keys
	// the environment happens to be carrying.

	const { serve } = await import('h3');
	const { createApp } = await import('@/relay/main.ts');
	const { closeDb } = await import('@/relay/db/index.ts');
	const { stopWatching, watchMessages } = await import(
		'@/relay/services/messaging.ts'
	);

	const relay = await serve(createApp(), {
		port: env.RELAY_PORT,
		hostname: env.RELAY_HOST,
	})
		.ready()
		.catch((error: NodeJS.ErrnoException) => {
			if (error.code !== 'EADDRINUSE') throw error;
			throw new Error(
				`Port ${env.RELAY_PORT} is taken — a development relay is probably ` +
					'still running. The tests need it for one of their own.',
			);
		});
	// The cross-pod subscription, so a message sent to a connected client arrives
	// now rather than on its next reconnect.
	await watchMessages();

	stop = async () => {
		// Outermost first. Each of these holds a connection open, and nothing else
		// would let the run's process go.
		await relay.close(true);
		await stopWatching();
		await closeDb();
	};
}

export async function teardown(): Promise<void> {
	await stop?.();
}
