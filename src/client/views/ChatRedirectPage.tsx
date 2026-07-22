import { useEffect } from 'react';
import { useLocation, useParams } from 'wouter';
import { useToken } from '../services/auth';
import { getUserByHandle } from '../services/relay';

export function ChatRedirectPage() {
	const { handle } = useParams<{ handle: string }>();
	const [, setLocation] = useLocation();
	const token = useToken();

	useEffect(() => {
		if (!token) return;
		getUserByHandle(handle).then((res) => {
			setLocation(`/i/${res.address}`);
		});
	}, [token, handle, setLocation]);

	return <main>Redirecting...</main>;
}
