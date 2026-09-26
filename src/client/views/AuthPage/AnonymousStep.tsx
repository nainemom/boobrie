import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { Redirect } from 'wouter';
import { truncateAddress } from '@/client/utils/address';
import { useIsExternalOpen } from '@/client/utils/router';
import { Avatar } from '../../components/Avatar';
import { FormField } from '../../components/FormField';
import { Spinner } from '../../components/Spinner';
import { generate, login } from '../../services/auth';
import { errorMessage } from '../../utils/errors';
import { AuthHero, AuthLayout, useAuthFlow } from './lib';

/** How long the new identity stays on screen before we move on. An anonymous
 * account has no handle and never shows its phrase, so this is the one moment
 * its owner gets to see whose face they'll be wearing. */
const REVEAL_MS = 2500;

export function AnonymousStep() {
	const isExternalOpen = useIsExternalOpen();
	if (isExternalOpen) {
		return <Redirect to="/auth" replace />;
	}
	return <AnonymousStepContent />;
}

function AnonymousStepContent() {
	const flow = useAuthFlow();

	// Keyed per visit: coming back here after a logout has to mint a fresh
	// identity, not replay the one SWR cached the first time round.
	const [attempt] = useState(() => `auth/anonymous/${Date.now()}`);
	const session = useSWR(
		attempt,
		async () => {
			const { mnemonic } = await generate(true);
			if (!mnemonic) throw new Error('Failed to generate an identity');
			return login({ mnemonic });
		},
		{
			revalidateOnFocus: false,
			revalidateOnReconnect: false,
			revalidateIfStale: false,
			shouldRetryOnError: false,
		},
	);

	const address = session.data?.address;

	useEffect(() => {
		if (!address) return;
		const timer = setTimeout(flow.done, REVEAL_MS);
		return () => clearTimeout(timer);
	}, [address, flow.done]);

	if (session.error) {
		return (
			<AuthLayout title="Going anonymous" back={flow.link('/auth')}>
				<AuthHero>
					<FormField error={errorMessage(session.error)} />
				</AuthHero>
			</AuthLayout>
		);
	}

	return (
		<AuthLayout title="Going anonymous">
			<AuthHero>
				{address && (
					<div className="flex flex-col gap-2 items-center justify-center">
						<Avatar
							address={address}
							className="size-52 shrink-0 mx-auto border border-neutral-200"
						/>
						<p className="text-lg font-semibold font-mono">
							{truncateAddress(address)}
						</p>
					</div>
				)}
				<div className="font-medium text-neutral-700 flex items-center gap-2">
					<Spinner size={4} className="text-neutral-400" />{' '}
					{address ? `Registring` : 'Generating'}…
				</div>
			</AuthHero>
		</AuthLayout>
	);
}
