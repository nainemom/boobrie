import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { log } from '@/shared/log';
import { App } from './App.tsx';
import { pushSupported, registerServiceWorker } from './push.ts';

const root = document.getElementById('root');
if (!root) throw new Error('Failed to find the root element');

createRoot(root).render(
	<StrictMode>
		<App />
	</StrictMode>,
);

// Register the service worker up front so caching (and push, once subscribed)
// work regardless of auth state. Fire-and-forget; failures are non-fatal.
if (pushSupported()) {
	registerServiceWorker().catch((err) =>
		log('error', 'service worker registration failed', err),
	);
}

log('info', 'app started');
