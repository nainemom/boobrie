import { type FC, Suspense } from 'react';
import { Redirect, Route, Router, Switch } from 'wouter';
import { AuthPage } from './AuthPage';
import { ChatPage } from './ChatPage';
import { ChatRedirectPage } from './ChatRedirectPage';
import { ConversationsPage } from './ConversationsPage';
import { SettingsPage } from './SettingsPage';
import { useIdentity } from './services/auth';

const AuthRedirect: FC = () => {
	const identity = useIdentity();
	if (!identity) {
		return <Redirect to="/auth" />;
	}
	return null;
};

export function App() {
	return (
		<Suspense fallback="Loading...">
			<Router>
				<Switch>
					<Route path="/auth" component={AuthPage} />
					<Route path="/conversations" component={ConversationsPage} />
					<Route path="/settings" component={SettingsPage} />
					<Route path="/i/:address" component={ChatPage} />
					<Route path="/:handle" component={ChatRedirectPage} />
				</Switch>
				<AuthRedirect />
			</Router>
		</Suspense>
	);
}
