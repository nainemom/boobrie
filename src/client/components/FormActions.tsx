import type { FC } from 'react';
import { tv, type VariantProps } from 'tailwind-variants';

const formActions = tv({
	base: 'grid grid-cols-3 gap-3 mt-3',
});

export const FormActions: FC<
	{ className?: string } & VariantProps<typeof formActions>
> = ({ className, ...props }) => {
	return <div className={formActions({ className })} {...props} />;
};
