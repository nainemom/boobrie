import { LogOutIcon } from 'lucide-react';
import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';
import { twJoin } from 'tailwind-merge';
import { isAnonymous } from '@/shared/auth';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { FormActions } from '../components/FormActions';
import { FormField } from '../components/FormField';
import { Modal } from '../components/Modal';
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

export function ProfileModal({
	address,
	onClose,
}: {
	address: string;
	onClose: () => void;
}) {
	const user = useUser();

	const isMe = address === user.identity?.address;

	// Your own profile is already in the user service; somebody else's has to
	// come from the relay. Either way the handle is only ever displayed — it's
	// claimed once, at sign-up, and there's no endpoint to change it after.
	const peer = useSWR(isMe ? null : `user-${address}`, () => getUser(address), {
		revalidateOnFocus: false,
		revalidateOnReconnect: false,
		shouldRetryOnError: false,
	});

	const [AddressCopyIcon, copyAdressToClipboard] = useCopyToClipboard();
	const [HandleCopyIcon, copyHandleToClipboard] = useCopyToClipboard();

	const discoverableMutation = useSWRMutation(
		'settings/discoverable',
		(_key: string, { arg }: { arg: boolean }) => changeDiscoverable(arg),
	);

	// Nothing to show without an identity — the gate modal is covering us anyway.
	if (!user.identity || !user.session) return null;

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
		<Modal title="Profile" closeButton onClose={onClose}>
			<div className="flex flex-col overflow-y-auto gap-3">
				<div className="flex items-center gap-1 px-3 h-44 justify-between w-full bg-neutral-50 border border-neutral-200 rounded-sm">
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
							<p className="text-sm text-neutral-500 shrink">
								{handle ?? '---'}
							</p>
							<Button
								id="copy-handle"
								variant="transparent"
								size={8}
								onClick={() => copyHandleToClipboard(handle ?? '')}
								iconOnly
								className="shrink-0"
								disabled={!handle}
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

				<FormActions>
					{isMe && (
						<Button
							variant="danger"
							size={12}
							className="col-span-1"
							onClick={() => logout().then(onClose)}
						>
							<LogOutIcon size={16} />
							Logout
						</Button>
					)}
					<Button
						variant="outline"
						size={12}
						className={twJoin(isMe ? 'col-span-2' : 'col-span-3')}
						onClick={() => onClose()}
					>
						OK
					</Button>
				</FormActions>
			</div>
		</Modal>
	);
}
