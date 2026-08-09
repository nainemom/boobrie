import { Suspense } from 'react';
import { SWRConfig } from 'swr';
import { Redirect, Route, Router, Switch } from 'wouter';
import { AuthModal } from './views/AuthModal';
import { ChatPage } from './views/ChatPage';
import { ChatRedirectPage } from './views/ChatRedirectPage';
import { ConversationsPage } from './views/ConversationsPage';

export function App() {
	return (
		<Suspense fallback="Loading...">
			<SWRConfig>
				<Router>
					<Switch>
						<Route path="/" component={ConversationsPage} />
						<Route path="/i/:address" component={ChatPage} />
						<Route path="/:handle" component={ChatRedirectPage} />
						<Route path="/">
							<Redirect to="/" />
						</Route>
					</Switch>
				</Router>
				<AuthModal />
			</SWRConfig>
		</Suspense>
	);
}
