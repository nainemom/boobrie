import { DicesIcon, MessageCircleIcon, PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { ConversationList } from '../components/ConversationList';
import { Navbar } from '../components/Navbar';
import { Page } from '../components/Page';
import { CenterSpinner } from '../components/Spinner';
import { SyncStatus } from '../components/SyncStatus';
import { useAuth } from '../services/auth';
import { useConversations } from '../services/chat';
import { CreateChatModal } from './CreateChatModal';
import { ProfileModal } from './ProfileModal';
import { RandomChatModal } from './RandomChatModal';

export function ConversationsPage() {
	const conversations = useConversations();
	const { identity } = useAuth();
	const [creating, setCreating] = useState(false);
	const [matching, setMatching] = useState(false);
	const [profile, setProfile] = useState(false);

	return (
		<Page>
			<Navbar
				middle={
					<div className="flex gap-1 items-center px-3">
						<h1 className="text-2xl font-bold">Boobrie</h1>
						<SyncStatus />
					</div>
				}
				end={
					<Button
						size={12}
						iconOnly
						disabled={!identity?.address}
						variant="transparent"
						onClick={() => setProfile(true)}
					>
						{identity?.address && <Avatar address={identity?.address} />}
					</Button>
				}
			/>

			<div className="flex-1 overflow-y-auto">
				{conversations === undefined ? (
					<CenterSpinner />
				) : conversations.length === 0 ? (
					<div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center max-w-sm mx-auto">
						<MessageCircleIcon size={64} className="text-neutral-300" />
						<div className="flex flex-col gap-1">
							<p className="font-semibold text-neutral-700 text-xl">
								No conversations yet
							</p>
							<p className="text-sm text-neutral-500">
								Tap the button below to start chatting with a user or meet
								someone new at random.
							</p>
						</div>
						<div className="flex flex-col gap-3 w-full">
							<Button onClick={() => setCreating(true)}>
								<PlusIcon size={16} /> Start a chat
							</Button>
							<Button variant="outline" onClick={() => setMatching(true)}>
								<DicesIcon size={16} /> Talk to a stranger
							</Button>
						</div>
					</div>
				) : (
					<ConversationList className="p-3" conversations={conversations} />
				)}
			</div>

			<Button
				iconOnly
				size={14}
				variant="outline"
				onClick={() => setMatching(true)}
				aria-label="Talk to a stranger"
				className="absolute bottom-20 right-4 rounded-full"
			>
				<DicesIcon />
			</Button>

			<Button
				iconOnly
				size={14}
				onClick={() => setCreating(true)}
				aria-label="New chat"
				className="absolute bottom-4 right-4 rounded-full"
			>
				<PlusIcon />
			</Button>

			{creating && <CreateChatModal onClose={() => setCreating(false)} />}

			{matching && <RandomChatModal onClose={() => setMatching(false)} />}

			{profile && identity?.address && (
				<ProfileModal
					address={identity?.address}
					onClose={() => setProfile(false)}
				/>
			)}
		</Page>
	);
}
