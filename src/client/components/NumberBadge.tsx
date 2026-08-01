import type { FC } from 'react';
import { twMerge } from 'tailwind-merge';

export const NumberBadge: FC<{
	value?: number;
	className?: string;
}> = ({ value, className }) => {
	return value ? (
		<span
			className={twMerge(
				'inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-on-primary',
				className,
			)}
		>
			{value > 99 ? '99+' : value}
		</span>
	) : null;
};
