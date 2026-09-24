import { HomeIcon, RefreshCwIcon } from 'lucide-react';
import { type FC, Suspense, use } from 'react';
import { flushSync } from 'react-dom';
import { ErrorBoundary, getErrorMessage } from 'react-error-boundary';
import { SWRConfig } from 'swr';
import { Redirect, Route, Router, Switch } from 'wouter';
import { navigate } from 'wouter/use-browser-location';
import { Button } from './components/Button';
import { Navbar } from './components/Navbar';
import { Page, PageActions, PageBody } from './components/Page';
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
		<ErrorBoundary
			fallbackRender={({ error, resetErrorBoundary }) => (
				<Page>
					<Navbar
						middle={<h1 className="px-3 text-2xl font-bold">Boobrie</h1>}
					/>
					<PageBody className="items-center justify-center gap-3 px-4 max-w-lg mx-auto font-mono">
						<h2 className="text-lg font-semibold text-neutral-700 flex items-center gap-2 w-full -mb-1">
							Something went wrong
						</h2>
						<p className="text-sm text-neutral-500">
							An unexpected error stopped this screen from loading. <br />
							Try again, or head back home.
						</p>
						<pre
							role="alert"
							className="w-full select-text overflow-auto whitespace-pre-wrap wrap-break-word rounded-sm border border-neutral-200 bg-neutral-100 p-4 text-xs text-neutral-700"
						>
							{getErrorMessage(error)}
						</pre>
					</PageBody>
					<PageActions>
						<div className="grid grid-cols-2 gap-3">
							{/* The boundary sits above the router, so a <Link> can't reach
							 * it — move the browser location, then clear the error so the
							 * tree re-renders on the new route. */}
							<Button
								variant="outline"
								size={12}
								onClick={() => {
									navigate('/', { replace: true });
									resetErrorBoundary();
								}}
							>
								<HomeIcon size={16} /> Home
							</Button>
							<Button size={12} onClick={resetErrorBoundary}>
								<RefreshCwIcon size={16} /> Try again
							</Button>
						</div>
					</PageActions>
				</Page>
			)}
			// onError={(error, info) => {
			// 	// Log the error to your error reporting service
			// }}
			// onReset={() => {
			// 	// Reset any state that may have caused the error
			// }}
		>
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
		</ErrorBoundary>
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
