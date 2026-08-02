import type { FC, TextareaHTMLAttributes } from 'react';
import { tv, type VariantProps } from 'tailwind-variants';

export const textarea = tv({
	base: [
		'outline-none border resize-y select-text field-sizing-content',
		'bg-neutral-50 border-neutral-200 focus:ring focus:ring-neutral-800 text-neutral-800',
		'read-only:text-neutral-500',
		'disabled:opacity-40 disabled:pointer-events-none',
	],
	variants: {
		size: {
			6: 'min-h-6 p-2 rounded-sm text-xs',
			8: 'min-h-8 p-2.5 rounded-sm text-xs',
			10: 'min-h-10 p-3 rounded-sm text-sm',
			12: 'min-h-12 p-3 rounded-sm text-sm',
			14: 'min-h-14 p-4 rounded-sm text-sm',
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
