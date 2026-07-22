import {
	type FC,
	type FormEvent,
	type ReactNode,
	useEffect,
	useState,
} from 'react';
import { Link } from 'wouter';
import type { MeResponse } from '@/shared/protocol';
import { Avatar } from './components/Avatar';
import { Button } from './components/Button';
import { Spinner } from './components/Spinner';
import { getMe } from './relay';
import { logout } from './services/auth';
import { signature } from './services/signature';
import {
	changeHandle,
	disablePush,
	enablePush,
	grantPermission,
	RELAY_URL,
	useStore,
} from './store';

const PERMISSION_BADGE: Record<string, string> = {
	granted: 'bg-green-100 text-green-700',
	denied: 'bg-red-100 text-red-700',
	default: 'bg-neutral-100 text-neutral-600',
	unsupported: 'bg-neutral-100 text-neutral-600',
};

export function SettingsPage() {
	const store = useStore();

	const [profile, setProfile] = useState<MeResponse | null>(null);
	const [handleInput, setHandleInput] = useState(store.handle ?? '');
	const [handleError, setHandleError] = useState<string | null>(null);
	const [handleSuccess, setHandleSuccess] = useState(false);
	const [copied, setCopied] = useState(false);

	// biome-ignore lint/correctness/useExhaustiveDependencies: also refetch when handle/push status change server-side
	useEffect(() => {
		if (!store.session) return;
		getMe(RELAY_URL, store.session.token)
			.then(setProfile)
			.catch(() => {});
	}, [store.session, store.handle, store.pushStatus]);

	// Nothing to show without an identity — the gate modal is covering us anyway.
	if (!store.identity || !store.session) return null;

	const { address } = store.identity;

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

	const subscribed = store.pushStatus === 'subscribed';
	const pushBusy =
		store.pushStatus === 'subscribing' || store.pushStatus === 'unsubscribing';

	return (
		<main className="flex h-full flex-col">
			<header className="flex shrink-0 items-center gap-3 border-b border-neutral-200 px-3 py-3">
				<Link
					href="/conversations"
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
									size="base"
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
									PERMISSION_BADGE[store.permission] ?? PERMISSION_BADGE.default
								}`}
							>
								{store.permission}
							</span>
						</div>
						<div className="flex flex-col gap-2 sm:flex-row">
							<Button
								variant="outline"
								className="grow"
								onClick={() => grantPermission()}
								disabled={
									store.permission === 'granted' ||
									store.permission === 'denied'
								}
							>
								Grant permission
							</Button>
							<Button
								className="grow"
								variant={subscribed ? 'outline' : 'primary'}
								onClick={() => (subscribed ? disablePush() : enablePush())}
								disabled={
									store.permission !== 'granted' ||
									!store.vapidPublicKey ||
									pushBusy
								}
							>
								{pushBusy && <Spinner />}
								{subscribed
									? 'Unsubscribe this device'
									: 'Subscribe this device'}
							</Button>
						</div>
						{store.pushError ? (
							<p role="alert" className="text-sm text-red-700">
								<strong>Push error:</strong> {store.pushError}
							</p>
						) : null}
					</Section>

					<Section title="Membership">
						{profile ? (
							<dl className="flex flex-col gap-2 text-sm">
								<Row
									label="Plan"
									value={
										profile.paid
											? `Paid${
													profile.paidUntil
														? ` · until ${new Date(profile.paidUntil).toLocaleDateString()}`
														: ''
												}`
											: 'Free'
									}
								/>
								<Row
									label="Member since"
									value={new Date(profile.createdAt).toLocaleDateString()}
								/>
								{profile.role === 'admin' ? (
									<Row label="Role" value="Admin" />
								) : null}
							</dl>
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
						<Button
							variant="error_ghost"
							className="self-start"
							onClick={() => logout()}
						>
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

const Row: FC<{ label: string; value: ReactNode }> = ({ label, value }) => (
	<div className="flex items-center justify-between gap-4">
		<dt className="text-neutral-500">{label}</dt>
		<dd className="font-medium text-neutral-800">{value}</dd>
	</div>
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
