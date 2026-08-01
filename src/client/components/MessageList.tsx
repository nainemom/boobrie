import { CheckIcon } from 'lucide-react';
import { type FC, useEffect, useRef } from 'react';
import type { StoredMessage } from '../db';

const formatTime = (at: number) =>
	new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export const MessageList: FC<{ messages: StoredMessage[] }> = ({
	messages,
}) => {
	const lastRef = useRef<HTMLLIElement>(null);

	// Jump to the newest message on load and whenever one arrives or is sent.
	useEffect(() => {
		if (messages.length > 0) lastRef.current?.scrollIntoView({ block: 'end' });
	}, [messages]);

	return (
		<ul className="flex flex-col gap-3 relative">
			{messages.map((message) => {
				const outgoing = message.direction === 'out';
				return (
					<li
						key={message.id}
						className={`flex flex-col ${outgoing ? 'items-end' : 'items-start'}`}
					>
						<div
							className={`max-w-[75%] whitespace-pre-wrap wrap-break-word rounded-md p-3 text-base ${
								outgoing
									? 'rounded-br-none bg-primary text-on-primary'
									: 'rounded-bl-none bg-neutral-200 text-neutral-800'
							} ${message.status === 'pending' ? 'opacity-60' : ''}`}
						>
							{message.body}
						</div>
						<span className="mt-0.5 flex items-center gap-1 text-sm text-neutral-400">
							{message.status === 'pending'
								? 'Sending…'
								: formatTime(message.at)}
							{outgoing && message.status === 'sent' ? (
								<CheckIcon size={14} />
							) : null}
						</span>
					</li>
				);
			})}
			<li ref={lastRef} className="absolute -bottom-3" />
		</ul>
	);
};
