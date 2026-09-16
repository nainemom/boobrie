import { Redirect, useParams } from 'wouter';
import { AnonymousStep } from './AnonymousStep';
import { ChooseStep } from './ChooseStep';
import { LoginStep } from './LoginStep';
import { useAuthFlow } from './lib';
import { RegisterStep } from './RegisterStep';

/**
 * `/auth/:step?` — the whole gate behind a single route, so `callback_url`
 * rides along on every hop between steps instead of each step needing its own
 * entry in the router (and its own chance to drop the query).
 *
 * Each step is a file of its own next to this one, over the shared frame in
 * {@link file://./lib.tsx}.
 */
export function AuthPage() {
	const { step } = useParams<{ step?: string }>();
	const flow = useAuthFlow();

	switch (step) {
		case undefined:
			return <ChooseStep />;
		case 'login':
			return <LoginStep />;
		case 'register':
			return <RegisterStep />;
		case 'anonymous':
			return <AnonymousStep />;
		default:
			return <Redirect to={flow.link('/auth')} replace />;
	}
}
