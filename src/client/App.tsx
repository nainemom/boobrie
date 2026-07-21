import { Suspense } from 'react';
import { SWRConfig } from 'swr';
import { Redirect, Route, Router, Switch } from 'wouter';
import { ChatPage } from './ChatPage';
import { ChatRedirectPage } from './ChatRedirectPage';
import { ConversationsPage } from './ConversationsPage';
import { SettingsPage } from './SettingsPage';
import { AuthModal } from './views/AuthModal';

export function App() {
	return (
		<Suspense fallback="Loading...">
			<SWRConfig>
				<Router>
					<Switch>
						<Route path="/conversations" component={ConversationsPage} />
						<Route path="/settings" component={SettingsPage} />
						<Route path="/i/:address" component={ChatPage} />
						<Route path="/@:handle" component={ChatRedirectPage} />
						<Route path="/">
							<Redirect to="/conversations" />
						</Route>
					</Switch>
					{/* Global identity gate — forces itself open until one is picked. */}
					<AuthModal />
				</Router>
			</SWRConfig>
		</Suspense>
	);
}
