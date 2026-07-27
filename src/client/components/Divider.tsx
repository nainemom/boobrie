import type { FC } from 'react';
import { twMerge } from 'tailwind-merge';

export const Divider: FC<{
	label?: string;
	className?: string;
}> = ({ label, className }) => (
	<div
		className={twMerge(
			'w-full relative flex items-center justify-center m-0',
			className,
		)}
	>
		<hr className="w-full absolute border-neutral-300 border-dashed" />
		{label && (
			<p className="relative px-3 bg-neutral-50 text-xs uppercase text-neutral-600">
				{label}
			</p>
		)}
	</div>
);
