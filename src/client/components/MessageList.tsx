import { CheckIcon } from 'lucide-react';
import { type FC, useEffect, useRef } from 'react';
import { twMerge } from 'tailwind-merge';
import type { StoredMessage } from '../db';

const formatTime = (at: number) =>
	new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export const MessageList: FC<{ messages: StoredMessage[] }> = ({
	messages,
}) => {
	const lastRef = useRef<HTMLLIElement>(null);

	// Jump to the newest message on load and whenever one arrives or is sent —
	// and again whenever the viewport changes size, which is the keyboard
	// opening. That shortens the list's window from the bottom, and without this
	// the message being replied to slides out of sight behind the composer.
	useEffect(() => {
		if (messages.length === 0) return;
		const toBottom = () => lastRef.current?.scrollIntoView({ block: 'end' });
		toBottom();
		const viewport = window.visualViewport;
		viewport?.addEventListener('resize', toBottom);
		return () => viewport?.removeEventListener('resize', toBottom);
	}, [messages]);

	return (
		<ul className="flex flex-col gap-3 relative">
			{messages.map((message) => {
				const outgoing = message.direction === 'out';
				return (
					<li
						key={message.id}
						className={twMerge(
							'flex flex-col',
							outgoing ? 'items-end' : 'items-start',
						)}
					>
						<div
							className={twMerge(
								'max-w-[75%] relative whitespace-pre-wrap wrap-break-word rounded-sm p-3 text-sm',
								outgoing
									? 'bg-primary text-on-primary'
									: 'bg-neutral-200 text-neutral-800',
								message.status === 'pending' ? 'opacity-60' : '',
							)}
						>
							<div
								className={twMerge(
									'absolute size-3 top-1/2 -translate-y-1/2',
									outgoing
										? 'bg-primary -right-3 rotate-90'
										: '-left-3 bg-neutral-200 -scale-100 rotate-90',
								)}
								style={{
									clipPath: 'polygon(50% 50%, 0% 100%, 100% 100%)',
								}}
							/>
							{message.body}
						</div>
						<span className="mt-1 flex items-center gap-1 text-xs text-neutral-400">
							{message.status === 'pending'
								? 'Sending…'
								: formatTime(message.at)}
							{outgoing && message.status === 'sent' ? (
								<CheckIcon size={12} />
							) : null}
						</span>
					</li>
				);
			})}
			<li ref={lastRef} className="absolute -bottom-3" />
		</ul>
	);
};
