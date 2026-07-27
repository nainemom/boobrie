import type { FC, TextareaHTMLAttributes } from 'react';
import { tv, type VariantProps } from 'tailwind-variants';

export const textarea = tv({
	base: [
		'outline-none border rounded-xl resize-y min-h-32 select-text',
		'bg-neutral-50 border-neutral-200 focus:ring focus:ring-neutral-800 text-neutral-800',
		'read-only:text-neutral-500',
		'disabled:opacity-40 disabled:pointer-events-none',
	],
	variants: {
		size: {
			6: 'h-6 px-2 rounded-sm text-xs',
			8: 'h-8 px-2.5 rounded-sm text-xs',
			10: 'h-10 px-3 rounded-md text-sm',
			12: 'h-12 px-4 rounded-md text-sm',
		},
	},
	defaultVariants: {
		size: 10,
	},
});

export const Textarea: FC<
	TextareaHTMLAttributes<HTMLTextAreaElement> & VariantProps<typeof textarea>
> = ({ className, size, ...props }) => (
	<textarea {...props} className={textarea({ size, className })} />
);
