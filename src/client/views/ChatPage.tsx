import { ChevronLeftIcon, SendIcon } from 'lucide-react';
import { type FC, type SyntheticEvent, useEffect, useState } from 'react';
import useSWR from 'swr';
import { Link, Redirect, useParams } from 'wouter';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { Form } from '../components/Form';
import { FormField } from '../components/FormField';
import { MessageList } from '../components/MessageList';
import { Navbar } from '../components/Navbar';
import { OnlineStatus } from '../components/OnlineStatus';
import { Page, PageActions, PageBody } from '../components/Page';
import { Signature } from '../components/Signature';
import { CenterSpinner } from '../components/Spinner';
import { Textarea } from '../components/Textarea';
import {
	useMarkConversationRead,
	useMessages,
	useSendMessage,
} from '../services/chat';
import { getUser } from '../services/relay';
import { truncateAddress } from '../utils/address';
import { errorMessage } from '../utils/errors';
import { useAuthRedirect } from './AuthPage/lib';

export function ChatPage() {
	const { address } = useParams<{ address: string }>();
	const redirect = useAuthRedirect(address);

	if (redirect) return <Redirect to={redirect} replace />;

	return <Chat address={address} />;
}

const Chat: FC<{ address: string }> = ({ address }) => {
	const messages = useMessages(address);
	const sendMessage = useSendMessage();
	const markRead = useMarkConversationRead();
	// Polled, since nothing pushes presence.
	const peer = useSWR(
		['user', address] as const,
		([, peerAddress]) => getUser(peerAddress),
		{
			refreshInterval: 30_000,
			shouldRetryOnError: false,
			revalidateOnFocus: true,
		},
	);

	const [draft, setDraft] = useState('');
	const [sendError, setSendError] = useState<string | null>(null);

	// Seeing the chat — opening it, a message landing while it's on screen, or the
	// tab regaining focus — clears its unread badge. Gated on focus so messages
	// that arrive while you're looking elsewhere stay unread (and keep dinging).
	useEffect(() => {
		if (!messages || messages.length === 0) return;
		const markIfFocused = () => {
			if (document.hasFocus()) void markRead(address);
		};
		markIfFocused();
		window.addEventListener('focus', markIfFocused);
		return () => window.removeEventListener('focus', markIfFocused);
	}, [messages, address, markRead]);

	const submit = (e: SyntheticEvent) => {
		if (draft.trim() === '') return;
		e.preventDefault();
		setSendError(null);
		// Just a write to the database; the sync service delivers it.
		sendMessage(address, draft)
			.then(() => setDraft(''))
			.catch((error) => setSendError(errorMessage(error)));
	};

	return (
		<Page>
			<Navbar
				middle={
					<Link
						href={`/profile/${address}`}
						aria-label="View profile"
						className="contents"
					>
						<Button
							variant="transparent"
							size={12}
							className="group flex w-full gap-2 items-center px-0 text-start font-normal normal-case"
						>
							<Avatar
								address={address}
								className="size-12 shrink-0 overflow-hidden rounded-sm group-hover:bg-transparent group-active:bg-transparent"
							/>
							<div className="min-w-0 grow flex flex-col">
								<p className="font-normal text-lg text-neutral-800 font-mono">
									{truncateAddress(address)}{' '}
								</p>
								<OnlineStatus
									loading={peer.isLoading}
									online={peer.data?.online}
									withLabel
									className="-mt-0.5"
								/>
							</div>
							<Signature address={address} className="size-12" />
						</Button>
					</Link>
				}
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
			/>

			<PageBody>
				{messages === undefined ? (
					<CenterSpinner />
				) : messages.length === 0 ? (
					<div className="flex h-full flex-col items-center justify-center gap-2 text-center text-neutral-500">
						<span className="text-4xl">👋</span>
						<p className="text-sm">No messages yet.</p>
					</div>
				) : (
					<MessageList messages={messages} />
				)}
			</PageBody>

			<PageActions>
				<div className="flex gap-3 w-full shrink relative">
					<Form onSubmit={submit} className="contents">
						<FormField error={sendError} className="size-full">
							<Textarea
								value={draft}
								onChange={(event) => setDraft(event.target.value)}
								size={14}
								placeholder="Type a message"
								dir="auto"
								className="min-w-full min-h-14.25 w-full pr-14"
								onKeyDown={(e) => {
									if (e.key === 'Enter' && !e.shiftKey) {
										submit(e);
									}
								}}
							/>
						</FormField>
					</Form>
					<Button
						type="submit"
						iconOnly
						size={12}
						aria-label="Send"
						variant="transparent"
						disabled={draft.trim() === ''}
						onClick={submit}
						className="absolute inset-e-1 bottom-1"
					>
						<SendIcon size={20} />
					</Button>
				</div>
			</PageActions>
		</Page>
	);
};
