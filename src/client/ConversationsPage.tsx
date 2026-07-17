import { type FormEvent, useState } from 'react';
import { Link, Redirect, useLocation } from 'wouter';
import { useStore } from './store';

export function ConversationsPage() {
	const store = useStore();
	const [, navigate] = useLocation();
	const [input, setInput] = useState('');

	if (!store.identity || !store.session) return <Redirect to="/auth" />;

	const submit = (event: FormEvent) => {
		event.preventDefault();
		const target = input.trim();
		if (target === '') return;
		setInput('');
		navigate(`/${target}`);
	};

	return (
		<main>
			<h1>Conversations</h1>

			{store.conversations.length > 0 ? (
				<ul>
					{store.conversations.map((peer) => (
						<li key={peer}>
							<Link href={`/${peer}`}>{peer}</Link>
						</li>
					))}
				</ul>
			) : (
				<p>No conversations yet.</p>
			)}

			<form onSubmit={submit}>
				<label htmlFor="new-peer">New chat</label>
				<input
					id="new-peer"
					value={input}
					onChange={(event) => setInput(event.target.value)}
					placeholder="address or @handle"
				/>
				<button type="submit" disabled={input.trim() === ''}>
					+
				</button>
			</form>

			<p>
				<Link href="/settings">Settings</Link>
			</p>
		</main>
	);
}
