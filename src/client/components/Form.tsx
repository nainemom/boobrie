import type { FC, FormHTMLAttributes } from 'react';
import { tv, type VariantProps } from 'tailwind-variants';

const form = tv({
	base: 'flex flex-col gap-3',
});

export const Form: FC<
	FormHTMLAttributes<HTMLFormElement> & VariantProps<typeof form>
> = ({ className, ...props }) => {
	return <form className={form({ className })} {...props} />;
};
