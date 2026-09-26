/**
 * The service worker.
 *
 * Four jobs, one file:
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
 *   3. Updates — reload open windows onto a new build as soon as one takes
 *      over, so nobody has to force-refresh to get the latest version.
 *   4. Web Push — turn the relay's offline nudge into a notification, and focus
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

// --- Updates ---------------------------------------------------------------

/**
 * Whether this worker is replacing an earlier one, rather than being the first
 * to install. Read during `install`, the one moment it can be: there
 * `registration.active` is still the worker about to be replaced, and on a
 * first visit it is null.
 *
 * Losing it — the worker being torn down between the two events — degrades to
 * not reloading, which is where this started, so it does not need to survive.
 */
let replacing = false;

self.addEventListener('install', () => {
	replacing = Boolean(self.registration.active);
});

/**
 * Reload every open window onto the new build.
 *
 * `skipWaiting` and `clientsClaim` put this worker in charge of pages that are
 * still *running* the build it replaced — code only changes at a navigation,
 * so those pages keep the old version until one happens. And a plain reload
 * isn't enough on its own: it's answered from the precache before the browser
 * has finished checking whether `sw.js` changed, so the new build only shows
 * up on the reload *after* that. Hence force-refreshing, which skips the
 * worker entirely and was the only reliable way through.
 *
 * Doing it from here rather than listening for `controllerchange` in the page
 * keeps it to the one file that knows a handover happened, and costs the app
 * no boot code at all.
 */
self.addEventListener('activate', (event) => {
	if (!replacing) return;
	event.waitUntil(
		(async () => {
			// `navigate()` is only allowed on clients this worker already controls.
			// Serwist claims them in its own `activate` handler, inside a
			// `waitUntil` that hasn't necessarily settled by the time this one runs;
			// claiming again is free and settles the ordering.
			await self.clients.claim();
			for (const client of await self.clients.matchAll({ type: 'window' })) {
				// Deliberately not awaited. Each navigation is answered by this
				// worker's own fetch handler, which the browser holds back until this
				// `activate` has settled — so awaiting them here would leave both
				// sides waiting on the other. Starting them is enough.
				void client.navigate(client.url).catch(() => {
					// A client mid-navigation, or one the browser declines to move: it
					// reaches the new build on its own at the next one.
				});
			}
		})(),
	);
});

// --- Web Push --------------------------------------------------------------

self.addEventListener('push', (event) => {
	let payload: PushPayload | null = null;
	try {
		payload = (event.data?.json() as PushPayload | undefined) ?? null;
	} catch {
		// Non-JSON / empty payload — still worth a generic nudge.
	}

	event.waitUntil(
		Promise.all([
			// A badge that fails must not take the notification down with it.
			markUnread().catch(() => {}),
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
		]),
	);
});

/** Badge the app icon for a message that just arrived. The worker can't read
 * the encrypted local database, so it can't know the real total — a plain dot
 * says "something new" without guessing a number. Skipped when the app is on
 * screen: it's counting for itself then (`services/badge.ts`), and a dot landing
 * after its update would overwrite the real number. */
async function markUnread(): Promise<void> {
	if (!('setAppBadge' in self.navigator)) return;
	const clients = await self.clients.matchAll({ type: 'window' });
	if (clients.some((client) => client.visibilityState === 'visible')) return;
	await self.navigator.setAppBadge();
}

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
