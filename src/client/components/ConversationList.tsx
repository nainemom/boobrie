import { ChevronRightIcon } from 'lucide-react';
import type { FC } from 'react';
import { Link } from 'wouter';
import type { ConversationSummary } from '../services/chat';
import { truncateAddress } from '../utils/address';
import { Avatar } from './Avatar';
import { NumberBadge } from './NumberBadge';

export const ConversationList: FC<{ conversations: ConversationSummary[] }> = ({
	conversations,
}) => (
	<ul className="space-y-3 p-3">
		{conversations.map((conversation) => {
			const { lastMessage, unreadCount } = conversation;
			const hasUnread = unreadCount > 0;
			return (
				<li key={conversation.peer}>
					<Link
						href={`/i/${conversation.peer}`}
						className="rounded-sm h-16 flex items-center gap-3 pe-3 hover:bg-neutral-100 focus:bg-neutral-100 group border border-transparent focus-visible:border-neutral-800 outline-0"
					>
						<Avatar address={conversation.peer} className="size-16 shrink-0" />
						<div className="flex min-w-0 w-full flex-col leading-tight">
							<span className="truncate font-medium text-neutral-800">
								{truncateAddress(conversation.peer)}
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
							<NumberBadge value={unreadCount} />
						) : (
							<ChevronRightIcon
								size={20}
								className="shrink-0 text-neutral-400"
							/>
						)}
					</Link>
				</li>
			);
		})}
	</ul>
);
