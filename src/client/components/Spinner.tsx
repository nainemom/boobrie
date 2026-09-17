import type { FC } from 'react';
import { tv } from 'tailwind-variants';

const spinner = tv({
	base: 'inline-block animate-spin rounded-full border-2 border-current border-t-transparent',
	variants: { size: { 3: 'size-3', 4: 'size-4', 5: 'size-5', 8: 'size-8' } },
	defaultVariants: { size: 5 },
});

export const Spinner: FC<{ size?: 3 | 4 | 5 | 8; className?: string }> = ({
	size,
	className,
}) => <span className={spinner({ size, class: className })} />;

export const CenterSpinner: FC<{
	size?: 3 | 4 | 5 | 8;
	className?: string;
}> = ({ size = 8, className = 'text-neutral-300' }) => (
	<div className="flex h-full items-center justify-center">
		<Spinner size={size} className={className} />
	</div>
);
