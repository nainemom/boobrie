import { defineConfig } from 'prisma/config';
import { env } from './src/relay/env';

export default defineConfig({
	schema: 'src/relay/db/schema.prisma',
	migrations: {
		path: 'src/relay/db/migrations',
	},
	datasource: {
		url: env.RELAY_DB_URL,
	},
});
