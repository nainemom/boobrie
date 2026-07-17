import { Route, Router, Switch } from 'wouter';
import { AuthPage } from './AuthPage';
import { ChatPage } from './ChatPage';
import { ConversationsPage } from './ConversationsPage';
import { SettingsPage } from './SettingsPage';

export function App() {
	return (
		<Router>
			<Switch>
				<Route path="/auth" component={AuthPage} />
				<Route path="/conversations" component={ConversationsPage} />
				<Route path="/settings" component={SettingsPage} />
				<Route path="/:user" component={ChatPage} />
			</Switch>
		</Router>
	);
}
