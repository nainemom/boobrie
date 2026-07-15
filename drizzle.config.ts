import { defineConfig } from 'drizzle-kit';

if (!process.env.DB_URL) {
	throw new Error('DB_URL env is not found');
}

export default defineConfig({
	dialect: 'postgresql',
	schema: './src/relay/db/schema.ts',
	out: './src/relay/db/migrations',
	dbCredentials: {
		url: process.env.DB_URL,
	},
});
