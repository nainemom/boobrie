import { defineConfig } from 'drizzle-kit';

export default defineConfig({
	dialect: 'postgresql',
	schema: './src/relay/db/schema.ts',
	out: './src/relay/db/migrations',
	dbCredentials: {
		database: process.env.DB_DATABASE as string,
		host: process.env.DB_HOST as string,
		user: process.env.DB_USER as string,
		password: process.env.DB_PASSWORD as string,
		port: +(process.env.DB_PORT as string),
		ssl: !!process.env.DB_SSL,
	},
});
