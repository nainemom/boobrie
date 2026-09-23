import useSWR from 'swr';
import { Redirect, useParams } from 'wouter';
import { getUserByHandle } from '../services/relay';
import { useAuthRedirect } from './AuthPage/lib';

export function ChatRedirectPage() {
	const { handle } = useParams<{ handle: string }>();
	const userAddress = useSWR(
		`handle-${handle}`,
		async () => {
			const ret = await getUserByHandle(handle);
			return ret.address;
		},
		{
			revalidateOnFocus: false,
			revalidateOnReconnect: false,
			revalidateIfStale: false,
			keepPreviousData: false,
			suspense: true,
		},
	);

	const redirect = useAuthRedirect(userAddress.data);

	return <Redirect to={redirect || `/i/${userAddress.data}`} replace />;
}
