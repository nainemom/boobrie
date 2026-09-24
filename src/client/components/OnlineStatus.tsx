import {
	CheckCircleIcon,
	CircleQuestionMarkIcon,
	LoaderCircleIcon,
	XCircleIcon,
} from 'lucide-react';
import type { FC } from 'react';
import { twJoin, twMerge } from 'tailwind-merge';

export const OnlineStatus: FC<{
	online?: boolean | null;
	loading?: boolean;
	className?: string;
	withLabel?: boolean;
	size: 4 | 3;
}> = ({ online, loading, size, withLabel = true, className }) => {
	const Icon = loading
		? LoaderCircleIcon
		: online === true
			? CheckCircleIcon
			: online === false
				? XCircleIcon
				: CircleQuestionMarkIcon;
	const label = loading
		? ''
		: online === null
			? 'Hidden'
			: online === false
				? 'Offline'
				: online === true
					? 'Online'
					: '';
	return (
		<div
			className={twMerge(
				'inline-flex gap-1 items-center text-neutral-500 text-sm',
				className,
			)}
			title={label}
		>
			<Icon
				className={twJoin(
					'shrink-0 inline-block',
					size === 4 ? 'size-4' : 'size-3',
					loading && 'animate-spin text-neutral-400',
					!loading && online === true && 'text-green-500',
					!loading && online === false && 'text-neutral-500',
					!loading && online === null && 'text-neutral-400',
				)}
				size={16}
			/>
			{withLabel && label}
		</div>
	);
};
