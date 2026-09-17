import { LoaderIcon } from 'lucide-react';
import type { ButtonHTMLAttributes, FC, MouseEvent } from 'react';
import { tv, type VariantProps } from 'tailwind-variants';
import { usePromiseLoading } from '../utils/usePromiseLoading';

export const button = tv({
	base: [
		'inline-flex items-center justify-center gap-2 relative',
		'uppercase font-semibold cursor-pointer',
		'outline-dashed -outline-offset-1 outline-transparent border',
		'disabled:pointer-events-none',
	],
	variants: {
		variant: {
			primary: [
				'bg-primary border-primary hover:bg-primary-hover focus-visible:border-neutral-50 focus-visible:outline-primary active:bg-primary-active text-on-primary',
				'disabled:bg-neutral-500 disabled:border-transparent',
			],
			danger: [
				'bg-red-900 border-red-900 hover:bg-red-800 focus-visible:border-neutral-50 focus-visible:outline-primary active:bg-red-900 text-neutral-50',
				'disabled:bg-neutral-500 disabled:border-transparent',
			],
			outline: [
				'bg-neutral-100 border-neutral-200 hover:border-neutral-300 focus-visible:outline-neutral-800 active:bg-neutral-600/10 text-neutral-800',
				'disabled:text-neutral-300',
			],
			transparent: [
				'bg-neutral-50 border-neutral-50 hover:bg-neutral-100 focus-visible:outline-neutral-800 active:bg-neutral-200 text-neutral-800',
				'disabled:text-neutral-300',
			],
		},
		iconOnly: {
			true: 'shrink-0',
			false: '',
		},
		loading: {
			true: '[&>.contents]:text-transparent',
			false: '',
		},
		size: {
			6: 'h-6 rounded-sm text-xs',
			8: 'h-8 rounded-sm text-xs',
			10: 'h-10 rounded-sm text-sm',
			12: 'h-12 rounded-sm text-sm',
			14: 'h-14 rounded-sm text-sm',
		},
	},
	compoundVariants: [
		{ iconOnly: true, size: 6, class: 'w-6' },
		{ iconOnly: true, size: 8, class: 'w-8' },
		{ iconOnly: true, size: 10, class: 'w-10' },
		{ iconOnly: true, size: 12, class: 'w-12' },
		{ iconOnly: true, size: 14, class: 'w-14' },
		{ iconOnly: false, size: 6, class: 'px-2' },
		{ iconOnly: false, size: 8, class: 'px-2.5' },
		{ iconOnly: false, size: 10, class: 'px-3' },
		{ iconOnly: false, size: 12, class: 'px-3' },
		{ iconOnly: false, size: 14, class: 'px-4' },
	],
	defaultVariants: {
		variant: 'primary',
		iconOnly: false,
		size: 10,
	},
});

export const Button: FC<
	Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> &
		VariantProps<typeof button> & {
			onClick?: (
				event: MouseEvent<HTMLButtonElement>,
			) => unknown | Promise<unknown>;
		}
> = ({
	className,
	variant,
	iconOnly,
	disabled,
	children,
	loading,
	size,
	onClick: rawOnClick,
	...props
}) => {
	const [promiseLoading, onClick] = usePromiseLoading(rawOnClick);
	return (
		<button
			type="button"
			onClick={onClick}
			{...props}
			disabled={disabled || loading || promiseLoading}
			className={button({ variant, iconOnly, loading, size, className })}
		>
			<span className="contents">{children}</span>
			{(promiseLoading || loading) && (
				<div className="flex items-center justify-center absolute inset-0">
					<LoaderIcon size={18} className="animate-spin" />
				</div>
			)}
		</button>
	);
};
