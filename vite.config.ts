import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const port = +(process.env.CLIENT_PORT as `${number}`);

export default defineConfig({
	server: {
		strictPort: true,
		port,
	},
	plugins: [react()],
	resolve: {
		alias: {
			'@': resolve(__dirname, './src'),
		},
	},
});
