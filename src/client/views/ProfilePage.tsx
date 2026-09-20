import {
	ChevronLeftIcon,
	HatGlassesIcon,
	LogOutIcon,
	MessageCircleIcon,
	UserCheck,
} from 'lucide-react';
import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';
import { twMerge } from 'tailwind-merge';
import { Link, useParams } from 'wouter';
import { isAnonymous } from '@/shared/auth';
import { sleep } from '@/shared/utils';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { FormField } from '../components/FormField';
import { Navbar } from '../components/Navbar';
import { Page, PageActions, PageBody } from '../components/Page';
import { Signature } from '../components/Signature';
import { Toggle } from '../components/Toggle';
import { env } from '../env';
import { logout } from '../services/auth';
import { getUser } from '../services/relay';
import {
	changeDiscoverable,
	disablePush,
	subscribeDevice,
	useUser,
} from '../services/user';
import { truncateAddress } from '../utils/address';
import { truncateLink } from '../utils/link';
import { useCopyToClipboard } from '../utils/useCopyToClipboard';
import { useOsShare } from '../utils/useOsShare';

function pushDescription(
	permission: NotificationPermission | 'unsupported',
	subscribed: boolean,
	vapidPublicKey: string | null | undefined,
): string {
	if (permission === 'unsupported') {
		return 'Push notifications aren’t supported in this browser.';
	}
	if (permission === 'denied') {
		return 'Notifications are blocked for this site — enable them in your browser settings to subscribe.';
	}
	if (!vapidPublicKey) {
		return 'Push notifications aren’t configured on this server.';
	}
	if (subscribed) {
		return 'Permission granted — this device is subscribed.';
	}
	if (permission === 'granted') {
		return 'Permission granted, but this device isn’t subscribed.';
	}
	return 'Get notified about new messages on this device.';
}

/** Somebody's profile: your own at `/profile`, a peer's at `/profile/:address`
 * (which is where their chat's header sends you). */
export function ProfilePage() {
	const { address: param } = useParams<{ address?: string }>();
	const user = useUser();

	const address = param ?? user.identity?.address;
	const isMe = !!address && address === user.identity?.address;

	// Your own profile is already in the user service; somebody else's has to
	// come from the relay. Either way the handle is only ever displayed — it's
	// claimed once, at sign-up, and there's no endpoint to change it after.
	const peer = useSWR(
		!address ? null : (['user', address] as const),
		async ([, peerAddress]) => {
			await sleep(1000);
			return await getUser(peerAddress);
		},
		{
			revalidateOnFocus: false,
			revalidateOnReconnect: false,
			shouldRetryOnError: false,
		},
	);

	const [UrlShareIcon, shareUrl] = useOsShare();
	const [AddressCopyIcon, copyAdressToClipboard] = useCopyToClipboard();
	const [HandleCopyIcon, copyHandleToClipboard] = useCopyToClipboard();

	const discoverableMutation = useSWRMutation(
		'settings/discoverable',
		(_key: string, { arg }: { arg: boolean }) => changeDiscoverable(arg),
	);

	// Only reachable in the blink between logging out and the router bouncing
	// us to the auth page.
	if (!address || !user.identity || !user.session) return null;

	const me = user.me;
	const url = `${env.CLIENT_PUBLIC_URL}/${peer.data?.handle ?? `i/${address}`}`;

	const toggleDiscoverable = () => {
		if (!me) return;
		return discoverableMutation.trigger(!me.discoverable, {
			throwOnError: false,
		});
	};

	const subscribed = user.pushStatus === 'subscribed';
	const pushBusy =
		user.pushStatus === 'subscribing' || user.pushStatus === 'unsubscribing';

	return (
		<Page>
			<Navbar
				middle={<h1 className="text-xl font-bold">Profile</h1>}
				start={
					<Link
						href={isMe ? '/' : `/i/${address}`}
						aria-label={isMe ? 'Back to conversations' : 'Back to chat'}
						className="contents"
					>
						<Button size={12} iconOnly variant="transparent">
							<ChevronLeftIcon />
						</Button>
					</Link>
				}
			/>

			<PageBody className="gap-4">
				<FormField vertical className="mb-4">
					<div className="flex h-64 w-full shrink-0 items-center justify-between gap-1 rounded-sm border border-neutral-200 px-3">
						<Avatar address={address} className="size-64 shrink-0" />
						<Signature address={address} className="text-neutral-700 h-64" />
					</div>
				</FormField>

				<FormField label="Account Type">
					<p className="flex items-center gap-1 text-sm text-neutral-500">
						{isAnonymous(address) ? (
							<>
								<HatGlassesIcon size={14} className="shrink-0" />
								Anonymous
							</>
						) : (
							<>
								<UserCheck size={14} className="shrink-0" />
								Normal
							</>
						)}
					</p>
				</FormField>

				{isMe && (
					<FormField label="URL" htmlFor="share-url" loading={peer.isLoading}>
						<div className="flex items-center gap-1">
							<Link
								className="text-sm shrink text-neutral-500 overflow-hidden truncate max-w-full"
								to={url}
							>
								{truncateLink(url)}
							</Link>
							<Button
								id="share-url"
								aria-label="Share profile url"
								variant="transparent"
								size={6}
								onClick={() => shareUrl(url)}
								iconOnly
								className="shrink-0"
							>
								<UrlShareIcon size={14} />
							</Button>
						</div>
					</FormField>
				)}

				<FormField
					label="Address"
					htmlFor="copy-address"
					info="The public address, used to identify/encryption on the network."
				>
					<div className="flex items-center gap-1">
						<p className="text-sm text-neutral-500 shrink">
							{truncateAddress(address)}
						</p>
						<Button
							id="copy-address"
							variant="transparent"
							size={6}
							onClick={() => copyAdressToClipboard(address)}
							iconOnly
							className="shrink-0"
						>
							<AddressCopyIcon size={14} />
						</Button>
					</div>
				</FormField>

				<FormField
					label="Handle"
					htmlFor="copy-handle"
					loading={peer.isLoading}
				>
					<div className="flex items-center gap-1">
						<p
							className={twMerge(
								'text-sm shrink',
								peer.data?.handle ? 'text-neutral-500' : 'text-neutral-300',
							)}
						>
							{peer.data?.handle || 'No handle set'}
						</p>
						{peer.data?.handle && (
							<Button
								id="copy-handle"
								variant="transparent"
								size={6}
								onClick={() => copyHandleToClipboard(peer.data?.handle ?? '')}
								iconOnly
								className="shrink-0"
								disabled={!peer.data?.handle}
							>
								<HandleCopyIcon size={14} />
							</Button>
						)}
					</div>
				</FormField>

				<FormField label="Joined" loading={peer.isLoading}>
					<p
						className={twMerge(
							'text-sm shrink',
							peer.isLoading && 'animate-pulse',
							peer.data?.createdAt ? 'text-neutral-500' : 'text-neutral-300',
						)}
					>
						{peer.data?.createdAt
							? new Date(peer.data?.createdAt).toLocaleDateString()
							: '---'}
					</p>
				</FormField>

				{isMe && (
					<>
						<FormField
							label="Push notifications"
							htmlFor="push"
							error={user.pushError}
							info={pushDescription(
								user.permission,
								subscribed,
								me?.vapidPublicKey,
							)}
							loading={!me}
						>
							<Toggle
								id="push"
								checked={subscribed}
								onChange={() =>
									subscribed ? disablePush() : subscribeDevice()
								}
								loading={pushBusy}
								disabled={
									!subscribed &&
									(user.permission === 'denied' ||
										user.permission === 'unsupported' ||
										!me?.vapidPublicKey)
								}
							/>
						</FormField>

						{me && (
							<FormField
								label="Discoverable"
								error={discoverableMutation.error?.message}
								info="When on, others can be matched with you in “Talk to a stranger”. Turn it off to stay out of the pool."
								loading={!me}
							>
								<Toggle
									checked={me.discoverable}
									onChange={toggleDiscoverable}
								/>
							</FormField>
						)}
					</>
				)}
			</PageBody>

			<PageActions>
				{isMe ? (
					<Button
						variant="danger"
						size={12}
						className="w-full"
						onClick={() => logout()}
					>
						<LogOutIcon size={16} />
						Logout
					</Button>
				) : (
					<Link className="contents" to={`/i/${address}`}>
						<Button variant="outline" size={12} className="w-full">
							<MessageCircleIcon size={16} />
							Chat
						</Button>
					</Link>
				)}
			</PageActions>
		</Page>
	);
}
