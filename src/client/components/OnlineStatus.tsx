import { CircleQuestionMarkIcon, LoaderCircleIcon } from 'lucide-react';
import type { FC } from 'react';
import { twJoin, twMerge } from 'tailwind-merge';

export const OnlineStatus: FC<{
	online?: boolean | null;
	loading?: boolean;
	className?: string;
	withLabel?: boolean;
}> = ({ online, loading, withLabel = true, className }) => {
	const Icon = loading
		? LoaderCircleIcon
		: online === true
			? 'div'
			: online === false
				? 'div'
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
			title={withLabel ? undefined : label}
		>
			<Icon
				className={twJoin(
					'shrink-0 inline-block rounded-full overflow-hidden size-3',
					loading && 'animate-spin text-neutral-400',
					!loading && online === true && 'bg-green-500 border border-green-100',
					!loading &&
						online === false &&
						'bg-neutral-300 border border-neutral-200',
					!loading && online === null && 'bg-neutral-200',
				)}
				size={16}
			/>
			{withLabel && label}
		</div>
	);
};
