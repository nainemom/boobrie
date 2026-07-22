import { type FormEvent, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { Spinner } from '../components/Spinner';
import { useConversations } from '../services/chat';
import { RandomChatModal } from './RandomChatModal';

export function ConversationsPage() {
	const conversations = useConversations();
	const [, navigate] = useLocation();
	const [creating, setCreating] = useState(false);
	const [matching, setMatching] = useState(false);
	const [input, setInput] = useState('');

	const closeModal = () => {
		setCreating(false);
		setInput('');
	};

	const submit = (event: FormEvent) => {
		event.preventDefault();
		const target = input.trim();
		if (target === '') return;
		closeModal();
		navigate(`/${target.startsWith('@') ? target.slice(1) : `i/${target}`}`);
	};

	return (
		<main className="relative flex h-full flex-col">
			<header className="flex shrink-0 items-center justify-between border-b border-neutral-200 px-5 py-4">
				<h1 className="text-xl font-bold text-neutral-800">Chats</h1>
				<Link
					href="/settings"
					aria-label="Settings"
					className="inline-flex size-10 items-center justify-center rounded-lg text-neutral-500 transition-colors hover:bg-neutral-100"
				>
					<GearIcon />
				</Link>
			</header>

			<div className="flex-1 overflow-y-auto">
				{conversations === undefined ? (
					<div className="flex h-full items-center justify-center">
						<Spinner size="lg" className="text-neutral-300" />
					</div>
				) : conversations.length === 0 ? (
					<div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
						<ChatIcon className="size-16 text-neutral-300" />
						<div className="flex flex-col gap-1">
							<p className="font-semibold text-neutral-700">
								No conversations yet
							</p>
							<p className="text-sm text-neutral-500">
								Tap the button below to start chatting with an address or
								@handle — or meet someone new at random.
							</p>
						</div>
						<div className="flex flex-col gap-2">
							<Button onClick={() => setCreating(true)}>Start a chat</Button>
							<Button variant="outline" onClick={() => setMatching(true)}>
								Talk to a stranger
							</Button>
						</div>
					</div>
				) : (
					<ul className="divide-y divide-neutral-100">
						{conversations.map((conversation) => {
							const { lastMessage, unreadCount } = conversation;
							const hasUnread = unreadCount > 0;
							return (
								<li key={conversation.peer}>
									<Link
										href={`/i/${conversation.peer}`}
										className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-neutral-100"
									>
										<Avatar
											address={conversation.peer}
											className="size-11 shrink-0"
										/>
										<div className="flex min-w-0 flex-1 flex-col">
											<span className="truncate font-medium text-neutral-800">
												{conversation.peer}
											</span>
											{lastMessage ? (
												<span
													className={`truncate text-sm ${
														hasUnread
															? 'font-medium text-neutral-700'
															: 'text-neutral-500'
													}`}
												>
													{lastMessage.direction === 'out' ? 'You: ' : ''}
													{lastMessage.body}
												</span>
											) : null}
										</div>
										{hasUnread ? (
											<span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-on-primary">
												<span className="sr-only">unread messages: </span>
												{unreadCount > 99 ? '99+' : unreadCount}
											</span>
										) : (
											<ChevronRightIcon className="size-4 shrink-0 text-neutral-300" />
										)}
									</Link>
								</li>
							);
						})}
					</ul>
				)}
			</div>

			<Button
				iconOnly
				size="lg"
				variant="outline"
				onClick={() => setMatching(true)}
				aria-label="Talk to a stranger"
				className="absolute bottom-24 right-6 rounded-full bg-white shadow-lg"
			>
				<ShuffleIcon className="size-6" />
			</Button>

			<Button
				iconOnly
				size="lg"
				onClick={() => setCreating(true)}
				aria-label="New chat"
				className="absolute bottom-6 right-6 rounded-full shadow-lg"
			>
				<PlusIcon className="size-6" />
			</Button>

			{creating && (
				<Modal>
					<form onSubmit={submit} className="flex flex-col gap-4">
						<h3 className="text-2xl font-bold">New chat</h3>
						<p className="text-sm text-neutral-500">
							Enter an address or @handle to start a conversation.
						</p>
						<input
							value={input}
							onChange={(event) => setInput(event.target.value)}
							placeholder="address or @handle"
							// biome-ignore lint/a11y/noAutofocus: the address field is the only input on this dialog
							autoFocus
							className="w-full rounded-lg border border-neutral-300 bg-white p-3 text-base outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500"
						/>
						<div className="mt-2 flex w-full gap-3">
							<Button variant="outline" className="grow" onClick={closeModal}>
								Cancel
							</Button>
							<Button
								type="submit"
								className="grow"
								disabled={input.trim() === ''}
							>
								Start chat
							</Button>
						</div>
					</form>
				</Modal>
			)}

			{matching && <RandomChatModal onClose={() => setMatching(false)} />}
		</main>
	);
}

const GearIcon = () => (
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
		<circle cx="12" cy="12" r="3" />
		<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
	</svg>
);

const ChatIcon = ({ className }: { className?: string }) => (
	<svg
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth={1.5}
		strokeLinecap="round"
		strokeLinejoin="round"
		className={className}
		aria-hidden="true"
	>
		<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
	</svg>
);

const ChevronRightIcon = ({ className }: { className?: string }) => (
	<svg
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth={2.5}
		strokeLinecap="round"
		strokeLinejoin="round"
		className={className}
		aria-hidden="true"
	>
		<path d="m9 18 6-6-6-6" />
	</svg>
);

const PlusIcon = ({ className }: { className?: string }) => (
	<svg
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth={2.5}
		strokeLinecap="round"
		strokeLinejoin="round"
		className={className}
		aria-hidden="true"
	>
		<path d="M12 5v14M5 12h14" />
	</svg>
);

const ShuffleIcon = ({ className }: { className?: string }) => (
	<svg
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth={2}
		strokeLinecap="round"
		strokeLinejoin="round"
		className={className}
		aria-hidden="true"
	>
		<path d="M16 3h5v5" />
		<path d="M4 20 21 3" />
		<path d="M21 16v5h-5" />
		<path d="m15 15 6 6" />
		<path d="M4 4l5 5" />
	</svg>
);
