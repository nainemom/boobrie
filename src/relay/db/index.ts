import { PrismaPg } from '@prisma/adapter-pg';
import { Client, Pool } from 'pg';
import { log } from '@/shared/log.ts';
import { sleep } from '@/shared/utils.ts';
import { env } from '../env.ts';
import { PrismaClient } from './generated/client.ts';

// The host on its own, for the "waiting for the database" line below. A
// connection string carries the password with it, and that has no business in
// a log. Set and well-formed is `env.ts`'s business, not this file's.
const dbHost = new URL(env.DATABASE_URL).host;

const pool = new Pool({
	connectionString: env.DATABASE_URL,
});
export const db = new PrismaClient({ adapter: new PrismaPg(pool) });

/** A fresh dedicated connection for LISTEN/NOTIFY. The messaging service owns
 * its lifecycle (connect, LISTEN, reconnect) — the pool can't hold a session
 * open, and a `Client` can't be reused once its connection has ended. */
export const createListener = (): Client =>
	new Client({
		connectionString: env.DATABASE_URL,
	});

/** Let go of the pool. The relay itself never needs this — the process ends and
 * the sockets go with it — but anything that starts the relay and then carries
 * on afterwards does, since a live pool keeps the process alive on its own. */
export const closeDb = async (): Promise<void> => {
	await db.$disconnect();
	await pool.end();
};

export const initDb = async (): Promise<void> => {
	for (let attempt = 1; ; attempt += 1) {
		try {
			await pool.query('SELECT 1');
			return;
		} catch (error) {
			// Said once, not on every retry: the usual cause is a database that
			// hasn't been started, and the usual fix is one command.
			if (attempt === 1) {
				log(
					'warn',
					`waiting for the database at ${dbHost} — ` +
						'if it is not running, `npm run db:start` starts it',
					error,
				);
			}
			await sleep(2000);
		}
	}
};
