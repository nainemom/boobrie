/**
 * The service worker.
 *
 * Two jobs, one file:
 *   1. Serwist — precache + runtime caching. Right now it just makes the app
 *      shell cacheable; it's the seam where offline/PWA behaviour grows later.
 *   2. Web Push — turn the relay's offline nudge into a notification, and focus
 *      (or open) the app when it's clicked.
 *
 * The push payload is metadata only (see {@link PushPayload}); the SW can't
 * decrypt messages, so a click just brings the app forward, which reconnects to
 * the relay and pulls whatever was waiting.
 *
 * Excluded from the app's tsconfig and type-checked via tsconfig.worker.json,
 * because it runs in a Worker global, not the DOM.
 */

import { defaultCache } from '@serwist/vite/worker';
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist';
import { Serwist } from 'serwist';
import type { PushPayload } from '@/shared/type';

declare global {
	interface WorkerGlobalScope extends SerwistGlobalConfig {
		// Replaced at build time by the precache manifest (the `injectionPoint`).
		__SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
	}
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
	precacheEntries: self.__SW_MANIFEST,
	skipWaiting: true,
	clientsClaim: true,
	navigationPreload: true,
	runtimeCaching: defaultCache,
});

serwist.addEventListeners();

// --- Web Push --------------------------------------------------------------

self.addEventListener('push', (event) => {
	let payload: PushPayload | null = null;
	try {
		payload = (event.data?.json() as PushPayload | undefined) ?? null;
	} catch {
		// Non-JSON / empty payload — still worth a generic nudge.
	}

	event.waitUntil(
		self.registration.showNotification('boobrie', {
			body: 'You have a new message.',
			icon: '/favicon.svg',
			data: payload,
		}),
	);
});

self.addEventListener('notificationclick', (event) => {
	event.notification.close();
	event.waitUntil(
		(async () => {
			const clients = await self.clients.matchAll({
				type: 'window',
				includeUncontrolled: true,
			});
			// Prefer an existing tab; otherwise open a fresh one.
			const existing = clients.find((client) => 'focus' in client);
			if (existing) {
				await existing.focus();
				return;
			}
			await self.clients.openWindow('/');
		})(),
	);
});
