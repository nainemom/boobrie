import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { PrismaPg } from '@prisma/adapter-pg';
import { Client, Pool } from 'pg';
import { sleep } from '@/shared/utils.ts';
import { config } from '../config.ts';
import { PrismaClient } from './generated/client.ts';

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

if (!config.dbUrl) throw new Error('db config not found!');

const pool = new Pool({
	connectionString: config.dbUrl,
});
export const db = new PrismaClient({ adapter: new PrismaPg(pool) });

/** A fresh dedicated connection for LISTEN/NOTIFY. The messaging service owns
 * its lifecycle (connect, LISTEN, reconnect) — the pool can't hold a session
 * open, and a `Client` can't be reused once its connection has ended. */
export const createListener = (): Client =>
	new Client({
		connectionString: config.dbUrl,
	});

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

	await execFileAsync('npx', ['prisma', 'migrate', 'deploy'], {
		cwd: repoRoot,
	});
};
