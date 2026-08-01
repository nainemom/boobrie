import useSWR from 'swr';
import { Redirect, useParams } from 'wouter';
import { Page } from '../components/Page';
import { CenterSpinner } from '../components/Spinner';
import { getUserByHandle } from '../services/relay';

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
		},
	);

	if (userAddress.data) {
		return <Redirect to={`/i/${userAddress.data}`} />;
	}

	return (
		<Page>
			<CenterSpinner />
		</Page>
	);
}
