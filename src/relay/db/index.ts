import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client, Pool } from 'pg';
import { sleep } from '@/shared/utils.ts';
import { config } from '../config.ts';

const migrationsFolder = fileURLToPath(
	new URL('./migrations', import.meta.url),
);

if (!config.db) throw new Error('db config not found!');

const pool = new Pool(config.db);
export const db = drizzle(pool);

/** A fresh dedicated connection for LISTEN/NOTIFY. The messaging service owns
 * its lifecycle (connect, LISTEN, reconnect) — the pool can't hold a session
 * open, and a `Client` can't be reused once its connection has ended. */
export const createListener = (): Client => new Client(config.db as never);

export const initDb = async (): Promise<void> => {
	let connected = false;
	while (!connected) {
		try {
			await pool.query('SELECT 1');
			connected = true;
		} catch {
			await sleep(2000);
		}
	}

	await migrate(db, { migrationsFolder });
};
