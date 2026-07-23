import 'dotenv/config';
import { defineConfig } from 'prisma/config';

const DB_URL = process.env.DB_POSTGRES_URL;

export default defineConfig({
	schema: 'src/relay/db/schema.prisma',
	migrations: {
		path: 'src/relay/db/migrations',
	},
	datasource: {
		url: DB_URL,
	},
});
