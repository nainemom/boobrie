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
