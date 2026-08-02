import { PlusIcon } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import useSWR from 'swr';
import { useLocation } from 'wouter';
import { Button } from '../components/Button';
import { Form } from '../components/Form';
import { FormActions } from '../components/FormActions';
import { FormField } from '../components/FormField';
import { Input } from '../components/Input';
import { Modal } from '../components/Modal';
import { getUser, getUserByHandle } from '../services/relay';

export function CreateChatModal({ onClose }: { onClose: () => void }) {
	const [, navigate] = useLocation();
	const [input, setInput] = useState('');
	const [query, setQuery] = useState('');
	const trimmedInput = input.trim();

	useEffect(() => {
		const timer = setTimeout(() => setQuery(trimmedInput), 400);
		return () => clearTimeout(timer);
	}, [trimmedInput]);

	const user = useSWR(
		query ? `user-exists-${query}` : null,
		() =>
			query.startsWith('@') ? getUserByHandle(query.slice(1)) : getUser(query),
		{
			revalidateOnFocus: false,
			revalidateOnReconnect: false,
			revalidateIfStale: false,
			shouldRetryOnError: false,
		},
	);

	const pending =
		trimmedInput !== '' && (trimmedInput !== query || user.isLoading);
	const notFound = trimmedInput !== '' && !pending && !user.data;
	const foundUser = trimmedInput !== '' && !pending ? user.data : undefined;

	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (!foundUser) return;
		onClose();
		navigate(`/i/${foundUser.address}`);
	};

	return (
		<Modal
			title="New Chat"
			subtitle="Enter an address or @handle to start a conversation."
			closeButton
			onClose={onClose}
		>
			<Form onSubmit={submit}>
				<FormField
					label="Peer"
					htmlFor="peer-input"
					error={notFound ? 'No user found at that address or handle.' : null}
				>
					<Input
						id="peer-input"
						value={input}
						size={12}
						onChange={(event) => setInput(event.target.value)}
						placeholder="address or @handle"
						autoFocus
					/>
				</FormField>

				<FormActions>
					<Button size={12} variant="outline" onClick={onClose}>
						Cancel
					</Button>
					<Button
						type="submit"
						className="col-span-2"
						size={12}
						disabled={!foundUser}
						loading={pending}
					>
						<PlusIcon size={16} />
						Start chat
					</Button>
				</FormActions>
			</Form>
		</Modal>
	);
}
