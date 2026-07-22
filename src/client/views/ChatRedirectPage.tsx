import { useEffect } from 'react';
import { useLocation, useParams } from 'wouter';
import { useToken } from '../services/auth';
import { getHandle } from '../services/user';

export function ChatRedirectPage() {
	const { handle } = useParams<{ handle: string }>();
	const [, setLocation] = useLocation();
	const token = useToken();

	useEffect(() => {
		if (!token) return;
		getHandle(handle).then((res) => {
			setLocation(`/i/${res.address}`);
		});
	}, [token, handle, setLocation]);

	return <main>Redirecting...</main>;
}
