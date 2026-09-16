import { ChevronLeftIcon, LogOutIcon } from 'lucide-react';
import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';
import { Link, useParams } from 'wouter';
import { isAnonymous } from '@/shared/auth';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { FormField } from '../components/FormField';
import { Navbar } from '../components/Navbar';
import { Page, PageActions, PageBody } from '../components/Page';
import { Signature } from '../components/Signature';
import { Toggle } from '../components/Toggle';
import { logout } from '../services/auth';
import { getUser } from '../services/relay';
import {
	changeDiscoverable,
	disablePush,
	subscribeDevice,
	useUser,
} from '../services/user';
import { truncateAddress } from '../utils/address';
import { useCopyToClipboard } from '../utils/useCopyToClipboard';

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
		isMe || !address ? null : (['user', address] as const),
		([, peerAddress]) => getUser(peerAddress),
		{
			revalidateOnFocus: false,
			revalidateOnReconnect: false,
			shouldRetryOnError: false,
		},
	);

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
	const handle = (isMe ? me : peer.data)?.handle ?? null;

	const toggleDiscoverable = () => {
		if (!me) return;
		void discoverableMutation.trigger(!me.discoverable, {
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

			<PageBody>
				<div className="flex h-44 w-full shrink-0 items-center justify-between gap-1 rounded-sm border border-neutral-200 bg-neutral-100 px-3">
					<Avatar address={address} className="size-44 shrink-0" />
					<Signature address={address} className="text-neutral-700 h-44" />
				</div>

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
							size={8}
							onClick={() => copyAdressToClipboard(address)}
							iconOnly
							className="shrink-0"
						>
							<AddressCopyIcon size={14} />
						</Button>
					</div>
				</FormField>

				{!isAnonymous(address) && handle && (
					<FormField
						label="Handle"
						htmlFor="copy-handle"
						info="Chosen once at sign-up, and fixed for the life of the account."
					>
						<div className="flex items-center gap-1">
							<p className="text-sm text-neutral-500 shrink">{handle}</p>
							<Button
								id="copy-handle"
								variant="transparent"
								size={8}
								onClick={() => copyHandleToClipboard(handle)}
								iconOnly
								className="shrink-0"
							>
								<HandleCopyIcon size={14} />
							</Button>
						</div>
					</FormField>
				)}

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
						>
							<Toggle
								id="push"
								checked={subscribed}
								onChange={() =>
									subscribed ? disablePush() : subscribeDevice()
								}
								disabled={
									pushBusy ||
									(!subscribed &&
										(user.permission === 'denied' ||
											user.permission === 'unsupported' ||
											!me?.vapidPublicKey))
								}
							/>
						</FormField>

						{me && (
							<FormField
								label="Discoverable"
								error={discoverableMutation.error?.message}
								info="When on, others can be matched with you in “Talk to a stranger”. Turn it off to stay out of the pool."
							>
								<Toggle
									checked={me.discoverable}
									disabled={discoverableMutation.isMutating}
									onChange={toggleDiscoverable}
								/>
							</FormField>
						)}
					</>
				)}
			</PageBody>

			{/* No navigation after logging out — dropping the identity is enough,
			    the router sends us to the auth page on its own. */}
			{isMe && (
				<PageActions>
					<Button
						variant="danger"
						size={12}
						className="w-full"
						onClick={() => logout()}
					>
						<LogOutIcon size={16} />
						Logout
					</Button>
				</PageActions>
			)}
		</Page>
	);
}
