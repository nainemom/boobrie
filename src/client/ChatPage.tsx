import { type FormEvent, useEffect, useState } from 'react';
import { Link, useParams } from 'wouter';
import type { UserResponse } from '@/shared/protocol';
import { getUser } from './relay';
import { addConversation, RELAY_URL, sendChat, useStore } from './store';

export function ChatPage() {
	const { address } = useParams<{ address: string }>();
	const store = useStore();

	const [profile, setProfile] = useState<UserResponse | null>(null);
	const [profileError, setProfileError] = useState<string | null>(null);
	const [draft, setDraft] = useState('');
	const [sendError, setSendError] = useState<string | null>(null);

	useEffect(() => {
		if (!store.session) return;
		setProfile(null);
		setProfileError(null);
		getUser(RELAY_URL, store.session.token, address)
			.then((res) => {
				setProfile(res);
				addConversation(res.address);
			})
			.catch((error) =>
				setProfileError(error instanceof Error ? error.message : String(error)),
			);
	}, [store.session, address]);

	const peer = profile?.address ?? null;
	const conversation = peer
		? store.messages.filter((message) => message.peer === peer)
		: [];

	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (!peer || draft.trim() === '') return;
		setSendError(null);
		sendChat(peer, draft)
			.then(() => setDraft(''))
			.catch((error) =>
				setSendError(error instanceof Error ? error.message : String(error)),
			);
	};

	return (
		<main>
			<p>
				<Link href="/conversations">Back to conversations</Link>
			</p>
			<h1>
				{address}
				{profile?.handle ? ` (@${profile.handle})` : null}
			</h1>

			{profileError ? (
				<p role="alert">
					<strong>Could not load profile:</strong> {profileError}
				</p>
			) : (
				<pre>
					<code>{profile ? JSON.stringify(profile, null, 2) : 'Loading…'}</code>
				</pre>
			)}

			<hr />

			{peer ? (
				<>
					{conversation.length > 0 ? (
						<ol>
							{conversation.map((message) => (
								<li key={message.id}>
									<strong>
										{message.direction === 'out' ? 'You' : 'Them'}:
									</strong>{' '}
									{message.body}
								</li>
							))}
						</ol>
					) : (
						<p>No messages yet.</p>
					)}

					<form onSubmit={submit}>
						<label htmlFor="chat-input">Message</label>
						<input
							id="chat-input"
							value={draft}
							onChange={(event) => setDraft(event.target.value)}
							placeholder="Type a message"
						/>
						<button type="submit" disabled={draft.trim() === ''}>
							Send
						</button>
					</form>
					{sendError ? (
						<p role="alert">
							<strong>Could not send:</strong> {sendError}
						</p>
					) : null}
				</>
			) : null}
		</main>
	);
}
