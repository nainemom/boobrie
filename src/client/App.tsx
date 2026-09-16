import { type FC, Suspense, use } from 'react';
import { SWRConfig } from 'swr';
import { Redirect, Route, Router, Switch, useLocation, useRoute } from 'wouter';
import { Page } from './components/Page';
import { CenterSpinner } from './components/Spinner';
import { restore, useAuth } from './services/auth';
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
			<Router>
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

/**
 * Every route but `/auth` needs an identity, so rather than each page gating
 * itself, anyone without one is bounced to the auth page. A chat link is the
 * one destination worth restoring afterwards — somebody followed it here to
 * talk to a particular person — so that, and only that, is passed along as
 * `callback_url`; everything else starts at the conversation list.
 */
const Routes: FC = () => {
	use(restored);
	const { identity } = useAuth();
	const [location] = useLocation();
	// Matched, not string-compared, so these can't drift from the routes below.
	const [onAuthPage] = useRoute('/auth/:step?');
	const [onChatPage] = useRoute('/i/:address');

	if (!identity && !onAuthPage) {
		return (
			<Redirect
				to={
					onChatPage
						? `/auth?callback_url=${encodeURIComponent(location)}`
						: '/auth'
				}
				replace
			/>
		);
	}

	return (
		<Switch>
			<Route path="/" component={ConversationsPage} />
			<Route path="/auth/:step?" component={AuthPage} />
			<Route path="/profile/:address?" component={ProfilePage} />
			<Route path="/i/:address" component={ChatPage} />
			<Route path="/:handle" component={ChatRedirectPage} />
			<Route>
				<Redirect to="/" replace />
			</Route>
		</Switch>
	);
};
