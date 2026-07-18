import type { FC } from 'react';
import { Redirect, Route, Router, Switch } from 'wouter';
import { AuthPage } from './AuthPage';
import { ChatPage } from './ChatPage';
import { ChatRedirectPage } from './ChatRedirectPage';
import { ConversationsPage } from './ConversationsPage';
import { SettingsPage } from './SettingsPage';
import { useStore } from './store';

const AuthRedirect: FC = () => {
	const store = useStore();
	if (!store.session) {
		return <Redirect to="/auth" />;
	}
	return null;
};

export function App() {
	return (
		<Router>
			<Switch>
				<Route path="/auth" component={AuthPage} />
				<Route path="/conversations" component={ConversationsPage} />
				<Route path="/settings" component={SettingsPage} />
				<Route path="/i/:address" component={ChatPage} />
				<Route path="/:handle" component={ChatRedirectPage} />
				{/* /:handle will recirect /i/:address */}
			</Switch>
			<AuthRedirect />
		</Router>
	);
}
