import { ChevronLeftIcon, SendIcon } from 'lucide-react';
import { type SyntheticEvent, useEffect, useState } from 'react';
import { Link, useParams } from 'wouter';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { Form } from '../components/Form';
import { FormField } from '../components/FormField';
import { MessageList } from '../components/MessageList';
import { Navbar } from '../components/Navbar';
import { Page } from '../components/Page';
import { Signature } from '../components/Signature';
import { CenterSpinner } from '../components/Spinner';
import { Textarea } from '../components/Textarea';
import {
	useMarkConversationRead,
	useMessages,
	useSendMessage,
} from '../services/chat';
import { truncateAddress } from '../utils/address';
import { errorMessage } from '../utils/errors';

export function ChatPage() {
	const { address } = useParams<{ address: string }>();
	const messages = useMessages(address);
	const sendMessage = useSendMessage();
	const markRead = useMarkConversationRead();

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
					<div className="flex w-full gap-2 items-center">
						<Avatar
							address={address}
							className="size-12 overflow-hidden rounded-md bg-neutral-100"
						/>
						<p className="min-w-0 grow font-normal text-xl text-neutral-800">
							{truncateAddress(address)}
						</p>
						<Signature address={address} className="size-16" />
					</div>
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

			<div className="flex-1 overflow-y-auto px-3 py-3">
				{messages === undefined ? (
					<CenterSpinner />
				) : messages.length === 0 ? (
					<div className="flex h-full flex-col items-center justify-center gap-2 text-center text-neutral-500">
						<span className="text-4xl">👋</span>
						<p className="text-sm">No messages yet — say hello.</p>
					</div>
				) : (
					<MessageList messages={messages} />
				)}
			</div>

			<Navbar
				position="bottom"
				height="dynamic"
				middle={
					<Form onSubmit={submit} className="contents">
						<FormField error={sendError} className="size-full">
							<Textarea
								value={draft}
								onChange={(event) => setDraft(event.target.value)}
								size={12}
								placeholder="Type a message"
								className="min-size-full w-full"
								onKeyDown={(e) => {
									if (e.key === 'Enter' && !e.shiftKey) {
										submit(e);
									}
								}}
							/>
						</FormField>
					</Form>
				}
				end={
					<Button
						type="submit"
						iconOnly
						size={12}
						aria-label="Send"
						disabled={draft.trim() === ''}
						onClick={submit}
						className="self-end"
					>
						<SendIcon size={20} />
					</Button>
				}
			/>
		</Page>
	);
}
