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
