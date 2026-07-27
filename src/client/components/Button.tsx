import { LoaderIcon } from 'lucide-react';
import type { ButtonHTMLAttributes, FC } from 'react';
import { tv, type VariantProps } from 'tailwind-variants';

export const button = tv({
	base: [
		'inline-flex items-center justify-center gap-2 relative',
		'uppercase font-semibold cursor-pointer',
		'outline-none border',
		'disabled:opacity-40 disabled:pointer-events-none',
	],
	variants: {
		variant: {
			primary:
				'bg-neutral-800 border-neutral-800 hover:bg-neutral-700 focus-visible:border-2 focus-visible:border-neutral-50 focus-visible:ring focus-visible:ring-neutral-800 active:bg-neutral-900 text-neutral-50',
			outline:
				'bg-neutral-100 border-neutral-200 hover:bg-neutral-600/5 focus-visible:ring focus-visible:ring-neutral-800 active:bg-neutral-600/10 text-neutral-800',
		},
		iconOnly: {
			true: 'shrink-0',
			false: '',
		},
		loading: {
			true: '[&>.contents]:text-transparent disabled:opacity-80',
			false: '',
		},
		size: {
			6: 'h-6 rounded-sm text-xs',
			8: 'h-8 rounded-sm text-xs',
			10: 'h-10 rounded-md text-sm',
			12: 'h-12 rounded-md text-sm',
		},
	},
	compoundVariants: [
		{ iconOnly: true, size: 6, class: 'w-6' },
		{ iconOnly: true, size: 8, class: 'w-8' },
		{ iconOnly: true, size: 10, class: 'w-10' },
		{ iconOnly: true, size: 12, class: 'w-12' },
		{ iconOnly: false, size: 6, class: 'px-2 text-xs' },
		{ iconOnly: false, size: 8, class: 'px-2.5 text-sm' },
		{ iconOnly: false, size: 10, class: 'px-3 text-sm' },
		{ iconOnly: false, size: 12, class: 'px-4 text-sm' },
	],
	defaultVariants: {
		variant: 'primary',
		iconOnly: false,
		size: 10,
	},
});

export const Button: FC<
	ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof button>
> = ({
	className,
	variant,
	iconOnly,
	disabled,
	children,
	loading,
	size,
	...props
}) => (
	<button
		type="button"
		{...props}
		disabled={disabled || loading}
		className={button({ variant, iconOnly, loading, size, className })}
	>
		<span className="contents">{children}</span>
		{loading && (
			<div className="flex items-center justify-center absolute inset-0">
				<LoaderIcon size={18} className="animate-spin" />
			</div>
		)}
	</button>
);
