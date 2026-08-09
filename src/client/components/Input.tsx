import type { FC, InputHTMLAttributes } from 'react';
import { tv, type VariantProps } from 'tailwind-variants';

export const input = tv({
	base: [
		'outline-none border rounded-xl select-text w-auto min-w-auto',
		'bg-neutral-50 border-neutral-200 outline-dashed -outline-offset-1 outline-transparent focus:outline-neutral-800 text-neutral-800',
		'read-only:text-neutral-500',
		'disabled:opacity-40 disabled:pointer-events-none',
	],
	variants: {
		size: {
			6: 'h-6 px-2 rounded-sm text-xs',
			8: 'h-8 px-2.5 rounded-sm text-xs',
			10: 'h-10 px-3 rounded-sm text-sm',
			12: 'h-12 px-3 rounded-sm text-sm',
			14: 'h-14 px-4 rounded-sm text-sm',
		},
	},
	defaultVariants: {
		size: 10,
	},
});

export const Input: FC<
	InputHTMLAttributes<HTMLInputElement> & VariantProps<typeof input>
> = ({ className, size, ...props }) => (
	<input {...props} className={input({ size, className })} />
);
