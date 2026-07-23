import 'dotenv/config';
import { defineConfig } from 'prisma/config';

const DB_URL = process.env.DB_POSTGRES_URL;

if (!DB_URL) throw new Error('process.env.DB_POSTGRES_URL is not defined');

export default defineConfig({
	schema: 'src/relay/db/schema.prisma',
	migrations: {
		path: 'src/relay/db/migrations',
	},
	datasource: {
		url: DB_URL,
	},
});
