import { zodResolver } from '@hookform/resolvers/zod';
import { LogOutIcon, SaveIcon } from 'lucide-react';
import { useForm } from 'react-hook-form';
import useSWRMutation from 'swr/mutation';
import { twJoin } from 'tailwind-merge';
import { z } from 'zod';
import { handleSchema } from '@/shared/protocol';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { Divider } from '../components/Divider';
import { Form } from '../components/Form';
import { FormActions } from '../components/FormActions';
import { FormField } from '../components/FormField';
import { Input } from '../components/Input';
import { Modal } from '../components/Modal';
import { Signature } from '../components/Signature';
import { Toggle } from '../components/Toggle';
import { logout } from '../services/auth';
import {
	changeDiscoverable,
	changeHandle,
	disablePush,
	subscribeDevice,
	useUser,
} from '../services/user';
import { truncateAddress } from '../utils/address';
import { errorMessage } from '../utils/errors';
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

const handleFormSchema = z.object({ handle: handleSchema });
type HandleForm = z.infer<typeof handleFormSchema>;

export function ProfileModal({
	address,
	onClose,
}: {
	address: string;
	onClose: () => void;
}) {
	const user = useUser();

	const isMe = address === user.identity?.address;

	const {
		register,
		handleSubmit,
		setError,
		formState: { errors, isDirty },
	} = useForm<HandleForm>({
		resolver: zodResolver(handleFormSchema),
		// `values` (not `defaultValues`) so the field picks up the handle once the
		// profile finishes loading, and syncs again after a successful save.
		values: { handle: user.me?.handle ?? '' },
	});

	const [DynamicCopyIcon, copyToClipboard] = useCopyToClipboard();

	const handleMutation = useSWRMutation(
		'settings/handle',
		async (_key: string, { arg }: { arg: string }) => {
			await changeHandle(arg);
			return true;
		},
	);
	const discoverableMutation = useSWRMutation(
		'settings/discoverable',
		(_key: string, { arg }: { arg: boolean }) => changeDiscoverable(arg),
	);

	// Nothing to show without an identity — the gate modal is covering us anyway.
	if (!user.identity || !user.session) return null;

	const profile = user.me;

	const submitHandle = async ({ handle }: HandleForm) => {
		try {
			await handleMutation.trigger(handle);
		} catch (err) {
			setError('handle', { type: 'manual', message: errorMessage(err) });
		}
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
							onClick={() => copyToClipboard(address)}
							iconOnly
							className="shrink-0"
						>
							<DynamicCopyIcon size={14} />
						</Button>
					</div>
				</FormField>

				{isMe ? (
					<>
						<Form onSubmit={handleSubmit(submitHandle)} className="contents">
							<FormField
								label="Handle"
								htmlFor="handle"
								error={errors.handle?.message}
								success={
									handleMutation.data === true && !isDirty
										? 'Handle successfully updated'
										: null
								}
							>
								<div className="flex items-start gap-2">
									<Input
										id="handle"
										className="grow"
										placeholder="No handle set"
										disabled={!profile}
										size={8}
										{...register('handle')}
									/>
									<Button
										type="submit"
										className="shrink-0"
										loading={handleMutation.isMutating}
										disabled={!isDirty}
										size={8}
										iconOnly
									>
										<SaveIcon size={14} />
									</Button>
								</div>
							</FormField>
						</Form>

						<FormField
							label="Push notifications"
							htmlFor="push"
							error={user.pushError}
							info={pushDescription(
								user.permission,
								subscribed,
								user.me?.vapidPublicKey,
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
											!user.me?.vapidPublicKey))
								}
							/>
						</FormField>

						{profile && (
							<FormField
								label="Discoverable"
								error={discoverableMutation.error?.message}
								info="When on, others can be matched with you in “Talk to a stranger”. Turn it off to stay out of the pool."
							>
								<Toggle
									checked={profile.discoverable}
									disabled={discoverableMutation.isMutating}
									onChange={toggleDiscoverable}
								/>
							</FormField>
						)}
					</>
				) : (
					<FormField label="Handle" htmlFor="copy-handle">
						<div className="flex items-center gap-1">
							<p className="text-sm text-neutral-500 shrink">
								{profile?.handle ?? '---'}
							</p>
							<Button
								id="copy-handle"
								variant="transparent"
								size={8}
								onClick={() => copyToClipboard(profile?.handle ?? '')}
								iconOnly
								className="shrink-0"
								disabled={!profile?.handle}
							>
								<DynamicCopyIcon size={14} />
							</Button>
						</div>
					</FormField>
				)}

				<Divider />

				<FormActions>
					{isMe && (
						<Button
							variant="danger"
							size={12}
							className="col-span-1"
							onClick={() => logout()}
						>
							<LogOutIcon size={16} />
							Log-out
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
