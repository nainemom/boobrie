import { useEffect } from 'react';
import { useLocation, useParams } from 'wouter';
import { getHandle } from './relay';
import { RELAY_URL, useStore } from './store';

export function ChatRedirectPage() {
	const { handle } = useParams<{ handle: string }>();
	const [, setLocation] = useLocation();
	const store = useStore();

	useEffect(() => {
		if (!store.session) return;
		getHandle(RELAY_URL, store.session.token, handle).then((res) => {
			setLocation(`/i/${res.address}`);
		});
	}, [store.session, handle, setLocation]);

	return <main>Redirecting...</main>;
}
