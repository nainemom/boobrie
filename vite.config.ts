import { resolve } from 'node:path';
import { serwist } from '@serwist/vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const port = +(process.env.CLIENT_PORT as `${number}`);

export default defineConfig({
	server: {
		strictPort: true,
		port,
	},
	plugins: [
		react(),
		tailwindcss(),
		serwist({
			swSrc: 'src/client/sw.ts',
			swDest: 'sw.js',
			globDirectory: 'dist',
			injectionPoint: 'self.__SW_MANIFEST',
			rollupFormat: 'iife',
		}),
	],
	resolve: {
		alias: {
			'@': resolve(__dirname, './src'),
		},
	},
});
