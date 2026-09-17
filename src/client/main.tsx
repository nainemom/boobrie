import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { log } from '@/shared/log';
import { App } from './App.tsx';
import { env } from './env.ts';
import { pushSupported, registerServiceWorker } from './services/push.ts';
import { startSync } from './services/sync.ts';

const root = document.getElementById('root');
if (!root) throw new Error('Failed to find the root element');

const domain = new URL(window.location.href);
const allowdDomain = new URL(env.CLIENT_PUBLIC_URL);
if (domain.origin !== allowdDomain.origin) {
	document.body.innerHTML = `Domain mismatch. Visit <a href="${allowdDomain.origin}">${allowdDomain.origin}</a>.`;
	throw new Error(
		`Domain mismatch: ${domain.origin} !== ${allowdDomain.origin}.`,
	);
}

/**
 * Keeps `--viewport-height` on the height of the *visual* viewport — the slice
 * of the window the on-screen keyboard isn't covering — so `#root` is never
 * taller than what's actually on screen: navbar against the top edge, composer
 * against the bottom one or against the top of the keyboard, and nothing to
 * scroll in between.
 *
 * `interactive-widget=resizes-content` in `index.html` already arranges that on
 * Android, where the layout viewport shrinks around the keyboard and `100dvh`
 * shrinks with it. iOS ignores the key: there the layout viewport keeps its full
 * height and the browser pans the page instead, which is what walks the navbar
 * off the top of the screen. Measuring gives the same answer on both, so this
 * doesn't care which one it's on.
 */
function trackViewport() {
	const viewport = window.visualViewport;
	if (!viewport) return;

	const measure = () => {
		if (viewport.scale > 1.01) return;
		const { style } = document.documentElement;
		style.setProperty('--viewport-height', `${viewport.height}px`);
		style.setProperty(
			'--keyboard-inset',
			`${Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)}px`,
		);
	};

	measure();
	viewport.addEventListener('resize', measure);
	// The keyboard opening can pan the visual viewport as well as shrink it —
	// same event to react to, since the inset above is measured from where the
	// viewport currently sits.
	viewport.addEventListener('scroll', measure);
}

trackViewport();

createRoot(root).render(
	<StrictMode>
		<App />
	</StrictMode>,
);

// Bring the background chat sync service up: it watches auth and, once a session
// is live, streams incoming messages into the local database and drains queued
// outgoing ones to the relay. The UI only ever touches the database.
startSync();

// Register the service worker up front so caching (and push, once subscribed)
// work regardless of auth state. Fire-and-forget; failures are non-fatal.
if (pushSupported()) {
	registerServiceWorker().catch((err) =>
		log('error', 'service worker registration failed', err),
	);
}

log('info', 'app started');
