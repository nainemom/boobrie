import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { Avatar } from '../../components/Avatar';
import { FormField } from '../../components/FormField';
import { Signature } from '../../components/Signature';
import { Spinner } from '../../components/Spinner';
import { generate, login } from '../../services/auth';
import { truncateAddress } from '../../utils/address';
import { errorMessage } from '../../utils/errors';
import { AuthHero, AuthLayout, useAuthFlow } from './lib';

/** How long the new identity stays on screen before we move on. An anonymous
 * account has no handle and never shows its phrase, so this is the one moment
 * its owner gets to see whose face they'll be wearing. */
const REVEAL_MS = 2500;

export function AnonymousStep() {
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
				{address ? (
					<>
						<div className="flex h-44 w-full shrink-0 items-center justify-between gap-1 rounded-sm border border-neutral-200 bg-neutral-100 px-3">
							<Avatar address={address} className="size-44 shrink-0" />
							<Signature address={address} className="h-44 text-neutral-700" />
						</div>
						<div className="flex flex-col gap-1">
							<p className="text-2xl font-bold tracking-tight text-neutral-800">
								This is you
							</p>
							<p className="text-sm text-neutral-500">
								{truncateAddress(address)} — no handle, and no recovery phrase
								to write down. This identity lives on this device only.
							</p>
						</div>
						<Spinner className="text-neutral-400" />
					</>
				) : (
					<>
						<Spinner size={8} className="text-neutral-300" />
						<p className="font-medium text-neutral-500">
							Creating an identity…
						</p>
					</>
				)}
			</AuthHero>
		</AuthLayout>
	);
}
