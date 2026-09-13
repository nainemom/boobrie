import { resolve } from 'node:path';
import { serwist } from '@serwist/vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { env } from './src/client/env.ts';

export default defineConfig(() => {
	return {
		server: {
			strictPort: true,
			port: env.CLIENT_PORT,
		},
		plugins: [
			react(),
			tailwindcss(),
			serwist({
				swSrc: 'src/client/sw.ts',
				swDest: 'sw.js',
				globDirectory: 'dist',
				// Precache every built file, not just Serwist's default js/css/html: the
				// app has to boot with no network, icons and all.
				globPatterns: ['**/*.{js,css,html,svg,png,ico,webp,woff,woff2,json}'],
				// The default 2 MiB cap drops oversized files from the manifest with only
				// a build warning — for the app's own bundle that would mean a silently
				// offline-broken build.
				maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
				injectionPoint: 'self.__SW_MANIFEST',
				rollupFormat: 'iife' as const,
			}),
		],
		resolve: {
			alias: {
				'@': resolve(__dirname, './src'),
			},
		},
		define: {
			'process.env': env,
		},
	};
});
