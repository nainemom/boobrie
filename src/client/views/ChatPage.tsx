import { type FormEvent, useEffect, useState } from 'react';
import { Link, useParams } from 'wouter';
import type { UserResponse } from '@/shared/protocol';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { Spinner } from '../components/Spinner';
import { useToken } from '../services/auth';
import {
	useCreateConversation,
	useMarkConversationRead,
	useMessages,
	useSendMessage,
} from '../services/chat';
import { getUser } from '../services/relay';

export function ChatPage() {
	const { address } = useParams<{ address: string }>();
	const token = useToken();
	const messages = useMessages(address);
	const sendMessage = useSendMessage();
	const createConversation = useCreateConversation();
	const markRead = useMarkConversationRead();

	const [profile, setProfile] = useState<UserResponse | null>(null);
	const [profileError, setProfileError] = useState<string | null>(null);
	const [draft, setDraft] = useState('');
	const [sendError, setSendError] = useState<string | null>(null);

	useEffect(() => {
		if (!token) return;
		setProfile(null);
		setProfileError(null);
		getUser(address)
			.then((res) => {
				setProfile(res);
				// Surface the conversation in the list the moment it's opened.
				void createConversation(res.address);
			})
			.catch((error) =>
				setProfileError(error instanceof Error ? error.message : String(error)),
			);
	}, [token, address, createConversation]);

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

	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (draft.trim() === '') return;
		setSendError(null);
		// Just a write to the database; the sync service delivers it.
		sendMessage(address, draft)
			.then(() => setDraft(''))
			.catch((error) =>
				setSendError(error instanceof Error ? error.message : String(error)),
			);
	};

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
				<Avatar address={address} className="size-10 shrink-0" />
				<div className="min-w-0 flex-1">
					<div className="truncate font-semibold leading-tight text-neutral-800">
						{profile?.handle ? `@${profile.handle}` : 'No handle'}
					</div>
					<div className="truncate text-xs text-neutral-500">{address}</div>
				</div>
			</header>

			{profileError ? (
				<p
					role="alert"
					className="shrink-0 bg-red-50 px-4 py-2 text-sm text-red-700"
				>
					{profileError}
				</p>
			) : null}

			<div className="flex-1 overflow-y-auto px-4 py-4">
				{messages === undefined ? (
					<div className="flex h-full items-center justify-center">
						<Spinner size="lg" className="text-neutral-300" />
					</div>
				) : messages.length === 0 ? (
					<div className="flex h-full flex-col items-center justify-center gap-2 text-center text-neutral-500">
						<span className="text-4xl">👋</span>
						<p className="text-sm">No messages yet — say hello.</p>
					</div>
				) : (
					<ul className="flex flex-col gap-3">
						{messages.map((message) => {
							const outgoing = message.direction === 'out';
							return (
								<li
									key={message.id}
									className={`flex flex-col ${outgoing ? 'items-end' : 'items-start'}`}
								>
									<div
										className={`max-w-[75%] whitespace-pre-wrap wrap-break-word rounded-2xl px-3.5 py-2 text-sm ${
											outgoing
												? 'rounded-br-sm bg-primary text-on-primary'
												: 'rounded-bl-sm bg-neutral-200 text-neutral-800'
										} ${message.status === 'pending' ? 'opacity-60' : ''}`}
									>
										{message.body}
									</div>
									{message.status === 'pending' ? (
										<span className="mt-0.5 text-[10px] text-neutral-400">
											Sending…
										</span>
									) : null}
								</li>
							);
						})}
					</ul>
				)}
			</div>

			<form
				onSubmit={submit}
				className="flex shrink-0 items-center gap-2 border-t border-neutral-200 p-3"
			>
				<label htmlFor="chat-input" className="sr-only">
					Message
				</label>
				<input
					id="chat-input"
					value={draft}
					onChange={(event) => setDraft(event.target.value)}
					placeholder="Type a message"
					className="min-w-0 grow rounded-full border border-neutral-300 bg-white px-4 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500"
				/>
				<Button
					type="submit"
					iconOnly
					aria-label="Send"
					disabled={draft.trim() === ''}
					className="shrink-0 rounded-full"
				>
					<SendIcon />
				</Button>
			</form>

			{sendError ? (
				<p
					role="alert"
					className="shrink-0 bg-red-50 px-4 py-2 text-sm text-red-700"
				>
					<strong>Could not send:</strong> {sendError}
				</p>
			) : null}
		</main>
	);
}

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

const SendIcon = () => (
	<svg
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth={2}
		strokeLinecap="round"
		strokeLinejoin="round"
		className="size-5"
		aria-hidden="true"
	>
		<path d="M22 2 11 13" />
		<path d="M22 2 15 22l-4-9-9-4z" />
	</svg>
);
