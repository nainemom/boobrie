import { type FC, type FormEvent, type ReactNode, useState } from 'react';
import { Link } from 'wouter';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { Spinner } from '../components/Spinner';
import { logout } from '../services/auth';
import { signature } from '../services/signature';
import {
	changeDiscoverable,
	changeHandle,
	disablePush,
	enablePush,
	grantPermission,
	useUser,
} from '../services/user';

const PERMISSION_BADGE: Record<string, string> = {
	granted: 'bg-green-100 text-green-700',
	denied: 'bg-red-100 text-red-700',
	default: 'bg-neutral-100 text-neutral-600',
	unsupported: 'bg-neutral-100 text-neutral-600',
};

export function SettingsPage() {
	const user = useUser();

	const [handleInput, setHandleInput] = useState(user.me?.handle ?? '');
	const [handleError, setHandleError] = useState<string | null>(null);
	const [handleSuccess, setHandleSuccess] = useState(false);
	const [copied, setCopied] = useState(false);
	const [savingDiscoverable, setSavingDiscoverable] = useState(false);
	const [discoverableError, setDiscoverableError] = useState<string | null>(
		null,
	);

	// Nothing to show without an identity — the gate modal is covering us anyway.
	if (!user.identity || !user.session) return null;

	const { address } = user.identity;
	const profile = user.me;

	const submitHandle = (event: FormEvent) => {
		event.preventDefault();
		setHandleError(null);
		setHandleSuccess(false);
		changeHandle(handleInput)
			.then(() => setHandleSuccess(true))
			.catch((error) =>
				setHandleError(error instanceof Error ? error.message : String(error)),
			);
	};

	const copyAddress = () => {
		void navigator.clipboard?.writeText(address).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		});
	};

	const toggleDiscoverable = () => {
		if (!profile) return;
		setDiscoverableError(null);
		setSavingDiscoverable(true);
		changeDiscoverable(!profile.discoverable)
			.catch((error) =>
				setDiscoverableError(
					error instanceof Error ? error.message : String(error),
				),
			)
			.finally(() => setSavingDiscoverable(false));
	};

	const subscribed = user.pushStatus === 'subscribed';
	const pushBusy =
		user.pushStatus === 'subscribing' || user.pushStatus === 'unsubscribing';

	return (
		<main className="flex h-full flex-col">
			<header className="flex shrink-0 items-center gap-3 border-b border-neutral-200 px-3 py-3">
				<Link
					href="/"
					aria-label="Back to conversations"
					className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg text-neutral-500 transition-colors hover:bg-neutral-100"
				>
					<ChevronLeftIcon />
				</Link>
				<h1 className="text-xl font-bold text-neutral-800">Settings</h1>
			</header>

			<div className="flex-1 overflow-y-auto">
				<div className="flex flex-col gap-5 p-5">
					<Section title="Your identity">
						<div className="flex flex-col items-center gap-4">
							<Avatar address={address} className="size-40" />
							{/* Signature strokes in currentColor; let it fill the box. */}
							<div
								className="w-full max-w-60 text-neutral-700 [&>svg]:block [&>svg]:h-auto [&>svg]:w-full"
								// biome-ignore lint/security/noDangerouslySetInnerHtml: self-generated SVG, no user-controlled markup
								dangerouslySetInnerHTML={{ __html: signature(address) }}
							/>
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
									disabled={handleInput.trim() === ''}
								>
									Save
								</Button>
							</div>
							{handleSuccess ? (
								<p className="text-sm text-green-700">Handle updated.</p>
							) : null}
							{handleError ? (
								<p role="alert" className="text-sm text-red-700">
									{handleError}
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
										disabled={savingDiscoverable}
										onChange={toggleDiscoverable}
										label="Discoverable in random chat"
									/>
								</div>
								{discoverableError ? (
									<p role="alert" className="text-sm text-red-700">
										{discoverableError}
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
		</main>
	);
}

const Section: FC<{ title: string; children: ReactNode }> = ({
	title,
	children,
}) => (
	<section className="flex flex-col gap-4 rounded-2xl border border-neutral-200 bg-white p-5">
		<h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
			{title}
		</h2>
		{children}
	</section>
);

const Toggle: FC<{
	checked: boolean;
	onChange: () => void;
	label: string;
	disabled?: boolean;
}> = ({ checked, onChange, label, disabled }) => (
	<button
		type="button"
		role="switch"
		aria-checked={checked}
		aria-label={label}
		disabled={disabled}
		onClick={onChange}
		className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-neutral-500 disabled:pointer-events-none disabled:opacity-50 ${
			checked ? 'bg-primary' : 'bg-neutral-300'
		}`}
	>
		<span
			className={`inline-block size-5 rounded-full bg-white shadow transition-transform ${
				checked ? 'translate-x-5' : 'translate-x-0.5'
			}`}
		/>
	</button>
);

const ChevronLeftIcon = () => (
	<svg
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth={2.5}
		strokeLinecap="round"
		strokeLinejoin="round"
		className="size-5"
		aria-hidden="true"
	>
		<path d="m15 18-6-6 6-6" />
	</svg>
);
