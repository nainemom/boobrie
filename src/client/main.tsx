import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { log } from '@/shared/log';
import { App } from './App.tsx';

const root = document.getElementById('root');
if (!root) throw new Error('Failed to find the root element');

createRoot(root).render(
	<StrictMode>
		<App />
	</StrictMode>,
);

log('info', 'app started');
