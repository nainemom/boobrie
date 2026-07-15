import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { log } from '@/shared/log.ts';
import { config } from '../config.ts';

const pool = new Pool({ connectionString: config.dbUrl });

export const db = drizzle(pool, {
	schema: {},
});

const migrationsFolder = fileURLToPath(
	new URL('./migrations', import.meta.url),
);

export async function initDb(): Promise<void> {
	const maxAttempts = 30;
	for (let attempt = 1; ; attempt += 1) {
		try {
			await pool.query('SELECT 1');
			break;
		} catch (err) {
			if (attempt >= maxAttempts) throw err;
			log('warn', `waiting for postgres (attempt ${attempt}/${maxAttempts})…`);
			await new Promise((resolve) => setTimeout(resolve, 2000));
		}
	}
	await migrate(db, { migrationsFolder });
}
