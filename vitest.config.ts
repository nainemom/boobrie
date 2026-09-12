import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: {
		alias: { '@': resolve(import.meta.dirname, './src') },
	},
	test: {
		include: ['src/test/*.test.ts'],
		environment: 'happy-dom',
		globalSetup: ['src/test/setup/global.ts'],
		setupFiles: ['src/test/setup/app.ts'],
		fileParallelism: false,
		testTimeout: 15_000,
	},
});
