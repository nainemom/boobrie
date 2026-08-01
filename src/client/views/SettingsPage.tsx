import { ChevronLeftIcon } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import useSWRMutation from 'swr/mutation';
import { Link } from 'wouter';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { Navbar } from '../components/Navbar';
import { Page } from '../components/Page';
import { Section } from '../components/Section';
import { Signature } from '../components/Signature';
import { Spinner } from '../components/Spinner';
import { Toggle } from '../components/Toggle';
import { logout } from '../services/auth';
import {
	changeDiscoverable,
	changeHandle,
	disablePush,
	enablePush,
	grantPermission,
	useUser,
} from '../services/user';
import { errorMessage } from '../utils/errors';

const PERMISSION_BADGE: Record<string, string> = {
	granted: 'bg-green-100 text-green-700',
	denied: 'bg-red-100 text-red-700',
	default: 'bg-neutral-100 text-neutral-600',
	unsupported: 'bg-neutral-100 text-neutral-600',
};

export function SettingsPage() {
	const user = useUser();

	const [handleInput, setHandleInput] = useState(user.me?.handle ?? '');
	const [handleSuccess, setHandleSuccess] = useState(false);
	const [copied, setCopied] = useState(false);

	const handleMutation = useSWRMutation(
		'settings/handle',
		(_key: string, { arg }: { arg: string }) => changeHandle(arg),
	);
	const discoverableMutation = useSWRMutation(
		'settings/discoverable',
		(_key: string, { arg }: { arg: boolean }) => changeDiscoverable(arg),
	);

	// Nothing to show without an identity — the gate modal is covering us anyway.
	if (!user.identity || !user.session) return null;

	const { address } = user.identity;
	const profile = user.me;

	const submitHandle = async (event: FormEvent) => {
		event.preventDefault();
		setHandleSuccess(false);
		try {
			await handleMutation.trigger(handleInput);
			setHandleSuccess(true);
		} catch {
			// error is already reflected in handleMutation.error
		}
	};

	const copyAddress = () => {
		void navigator.clipboard?.writeText(address).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		});
	};

	const toggleDiscoverable = () => {
		if (!profile) return;
		void discoverableMutation.trigger(!profile.discoverable, {
			throwOnError: false,
		});
	};

	const subscribed = user.pushStatus === 'subscribed';
	const pushBusy =
		user.pushStatus === 'subscribing' || user.pushStatus === 'unsubscribing';

	return (
		<Page>
			<Navbar
				start={
					<Link
						href="/"
						aria-label="Back to conversations"
						className="contents"
					>
						<Button size={12} iconOnly variant="transparent">
							<ChevronLeftIcon />
						</Button>
					</Link>
				}
				middle={<h1 className="text-xl font-bold">Settings</h1>}
			/>

			<div className="flex-1 overflow-y-auto pt-20">
				<div className="flex flex-col gap-5 p-5">
					<Section title="Your identity">
						<div className="flex flex-col items-center gap-4">
							<Avatar address={address} className="size-40" />
							<Signature address={address} className="w-full max-w-60" />
						</div>
						<div className="flex flex-col gap-2">
							<span className="text-xs font-medium text-neutral-500">
								Public key
							</span>
							<div className="flex items-start gap-2">
								<code className="min-w-0 grow break-all rounded-lg bg-neutral-100 px-3 py-2 text-xs text-neutral-700">
									{address}
								</code>
								<Button
									variant="outline"
									size={8}
									onClick={copyAddress}
									className="shrink-0"
								>
									{copied ? 'Copied!' : 'Copy'}
								</Button>
							</div>
						</div>
					</Section>

					<Section title="Handle">
						<form onSubmit={submitHandle} className="flex flex-col gap-3">
							<div className="flex gap-2">
								<input
									id="handle-input"
									value={handleInput}
									onChange={(event) => setHandleInput(event.target.value)}
									placeholder="No handle set"
									className="min-w-0 grow rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500"
								/>
								<Button
									type="submit"
									className="shrink-0"
									loading={handleMutation.isMutating}
									disabled={handleInput.trim() === ''}
								>
									Save
								</Button>
							</div>
							{handleSuccess ? (
								<p className="text-sm text-green-700">Handle updated.</p>
							) : null}
							{handleMutation.error ? (
								<p role="alert" className="text-sm text-red-700">
									{errorMessage(handleMutation.error)}
								</p>
							) : null}
						</form>
					</Section>

					<Section title="Notifications">
						<div className="flex items-center justify-between gap-4">
							<span className="text-sm text-neutral-600">Permission</span>
							<span
								className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
									PERMISSION_BADGE[user.permission] ?? PERMISSION_BADGE.default
								}`}
							>
								{user.permission}
							</span>
						</div>
						<div className="flex flex-col gap-2 sm:flex-row">
							<Button
								variant="outline"
								className="grow"
								onClick={() => grantPermission()}
								disabled={
									user.permission === 'granted' || user.permission === 'denied'
								}
							>
								Grant permission
							</Button>
							<Button
								className="grow"
								variant={subscribed ? 'outline' : 'primary'}
								onClick={() => (subscribed ? disablePush() : enablePush())}
								disabled={
									user.permission !== 'granted' ||
									!user.me?.vapidPublicKey ||
									pushBusy
								}
							>
								{pushBusy && <Spinner />}
								{subscribed
									? 'Unsubscribe this device'
									: 'Subscribe this device'}
							</Button>
						</div>
						{user.pushError ? (
							<p role="alert" className="text-sm text-red-700">
								<strong>Push error:</strong> {user.pushError}
							</p>
						) : null}
					</Section>

					<Section title="Random chat">
						{profile ? (
							<>
								<div className="flex items-center justify-between gap-4">
									<div className="flex min-w-0 flex-col gap-0.5">
										<span className="text-sm font-medium text-neutral-700">
											Discoverable
										</span>
										<span className="text-xs text-neutral-500">
											When on, others can be matched with you in “Talk to a
											stranger”. Turn it off to stay out of the pool.
										</span>
									</div>
									<Toggle
										checked={profile.discoverable}
										disabled={discoverableMutation.isMutating}
										onChange={toggleDiscoverable}
										label="Discoverable in random chat"
									/>
								</div>
								{discoverableMutation.error ? (
									<p role="alert" className="text-sm text-red-700">
										{errorMessage(discoverableMutation.error)}
									</p>
								) : null}
							</>
						) : (
							<div className="flex justify-center py-2">
								<Spinner className="text-neutral-300" />
							</div>
						)}
					</Section>

					<Section title="Account">
						<p className="text-sm text-neutral-500">
							Logging out removes this account's key from this device. You'll
							need your 12 words to sign back in.
						</p>
						<Button size={10} className="self-start" onClick={() => logout()}>
							Log out
						</Button>
					</Section>
				</div>
			</div>
		</Page>
	);
}
