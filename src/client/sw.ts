/**
 * The service worker.
 *
 * Three jobs, one file:
 *   1. Precache — every built file (shell, bundles, styles, icons) is stored on
 *      install, so a cold start with no network at all still boots the app.
 *   2. Runtime caching — one rule, drawn along the app/data line:
 *        · *local* requests (this origin: bundles, styles, images, the shell)
 *          are answered from the cache whenever there is a copy, and refreshed
 *          in the background for the next load. Offline is the normal case, not
 *          a fallback.
 *        · everything else — the relay's API and its message stream — is not
 *          routed at all, so it goes straight to the network, untouched and
 *          uncached. No connection means no answer, which is what we want:
 *          chat data is either live or absent, never stale.
 *   3. Web Push — turn the relay's offline nudge into a notification, and focus
 *      (or open) the app when it's clicked.
 *
 * The push payload is metadata only (see {@link PushPayload}); the SW can't
 * decrypt messages, so a click just brings the app forward, which reconnects to
 * the relay and pulls whatever was waiting.
 *
 * Excluded from the app's tsconfig, because it runs in a Worker global, not the
 * DOM.
 */

import type {
	PrecacheEntry,
	RouteMatchCallbackOptions,
	SerwistGlobalConfig,
} from 'serwist';
import { NetworkOnly, Serwist, StaleWhileRevalidate } from 'serwist';
import type { PushPayload } from '../shared/types';

declare global {
	interface WorkerGlobalScope extends SerwistGlobalConfig {
		// Replaced at build time by the precache manifest (the `injectionPoint`).
		__SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
	}
}

declare const self: ServiceWorkerGlobalScope;

/** Same-origin paths that are data rather than app. Nothing serves these today
 * — the relay lives on its own origin — but should it ever move under this one,
 * this keeps its responses out of the cache instead of silently staling them. */
const API_PATH = /^\/api\//;

/** Everything the app is *made of*, as opposed to the data it talks to. */
const isLocal = ({ sameOrigin, url }: RouteMatchCallbackOptions) =>
	sameOrigin && !API_PATH.test(url.pathname);

/**
 * Cache first, revalidate in the background: a cached copy answers straight
 * away (offline included) while a fresh one is fetched for next time.
 *
 * Deliberately without an {@link ExpirationPlugin} — every entry here is part
 * of the app itself, so an age limit would be a scheduled way to break offline.
 * Outdated builds are dropped by `cleanupOutdatedCaches`, and the browser
 * evicts the whole origin under storage pressure.
 */
const offlineFirst = [
	{
		matcher: isLocal,
		handler: new StaleWhileRevalidate({ cacheName: 'local-assets' }),
	},
];

/** Dev has no precache manifest, and Vite's modules change on every save, so
 * the SW stays out of the way entirely — as Serwist's own `defaultCache` does. */
const dev = import.meta.env.DEV;

const serwist = new Serwist({
	precacheEntries: self.__SW_MANIFEST,
	precacheOptions: dev
		? undefined
		: {
				cleanupOutdatedCaches: true,
				// `/i/:address` and `/:handle` are client-side routes: any navigation
				// the precache doesn't recognise is answered with the shell, which is
				// also what the host's rewrite does when it is online.
				navigateFallback: '/index.html',
				navigateFallbackDenylist: [API_PATH],
			},
	skipWaiting: true,
	clientsClaim: true,
	// No `navigationPreload`: navigations are answered from the precache, so a
	// preloaded response would be fetched and then thrown away every time.
	runtimeCaching: dev
		? [{ matcher: /.*/i, handler: new NetworkOnly() }]
		: offlineFirst,
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
		self.registration.showNotification('Boobrie', {
			body: 'You have a new message.',
			// One of the icons unplugin-favicons renders from `public/logo.svg` (see
			// `vite.config.ts`), picked because notification icons want a bitmap —
			// Chrome ignores an SVG here — and because the precache covers it, so
			// the notification still draws with no network. Moving the generator's
			// `outputPath` means moving this too.
			icon: '/favicons/android-chrome-192x192.png',
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
