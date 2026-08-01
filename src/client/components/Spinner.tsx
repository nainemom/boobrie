import type { FC } from 'react';
import { tv } from 'tailwind-variants';

const spinner = tv({
	base: 'inline-block animate-spin rounded-full border-2 border-current border-t-transparent',
	variants: { size: { sm: 'size-5', lg: 'size-8' } },
	defaultVariants: { size: 'sm' },
});

export const Spinner: FC<{ size?: 'sm' | 'lg'; className?: string }> = ({
	size,
	className,
}) => <span className={spinner({ size, class: className })} />;

/** A `Spinner` centered to fill its parent — the common "loading" placeholder
 * for a whole page or panel. */
export const CenterSpinner: FC<{ size?: 'sm' | 'lg'; className?: string }> = ({
	size = 'lg',
	className = 'text-neutral-300',
}) => (
	<div className="flex h-full items-center justify-center">
		<Spinner size={size} className={className} />
	</div>
);
