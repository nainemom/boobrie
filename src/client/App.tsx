import { type FC, Suspense, use } from 'react';
import { flushSync } from 'react-dom';
import { SWRConfig } from 'swr';
import { Redirect, Route, Router, Switch } from 'wouter';
import { Page } from './components/Page';
import { CenterSpinner } from './components/Spinner';
import { restore } from './services/auth';
import { AuthPage } from './views/AuthPage';
import { ChatPage } from './views/ChatPage';
import { ChatRedirectPage } from './views/ChatRedirectPage';
import { ConversationsPage } from './views/ConversationsPage';
import { ProfilePage } from './views/ProfilePage';

/**
 * Restoring the saved session is a boot-time job, and it happens exactly once:
 * the whole route tree suspends on this promise, so no page renders — and no
 * guard concludes you're logged out — before it settles. Kept at module scope
 * so the login/logout cycles that re-render everything below read an
 * already-settled promise instead of suspending all over again. `restore()`
 * itself stays freely callable elsewhere (e.g. relay.ts re-authenticates on a
 * 401).
 */
const restored = restore();

export function App() {
	return (
		<SWRConfig>
			<Router
				aroundNav={(nav, to, opts) => {
					if (!document.startViewTransition) {
						nav(to, opts);
						return;
					}
					document.startViewTransition(() => {
						flushSync(() => nav(to, opts));
					});
				}}
			>
				<Suspense
					fallback={
						<Page>
							<CenterSpinner />
						</Page>
					}
				>
					<Routes />
				</Suspense>
			</Router>
		</SWRConfig>
	);
}

const Routes: FC = () => {
	use(restored);

	return (
		<Switch>
			<Route path="/" component={ConversationsPage} />
			<Route path="/auth/:step?" component={AuthPage} />
			<Route path="/profile/:address" component={ProfilePage} />
			<Route path="/i/:address" component={ChatPage} />
			<Route path="/:handle" component={ChatRedirectPage} />
			<Route>
				<Redirect to="/" replace />
			</Route>
		</Switch>
	);
};
