import type { FC, ReactNode } from 'react';
import { tv, type VariantProps } from 'tailwind-variants';

const navbar = tv({
	base: [
		'p-2 sticky left-0 w-full bg-neutral-50',
		'flex items-stretch gap-2',
		'[&>div]:flex [&>div]:items-center [&>div]:gap-2 [&>div]:shrink-0',
	],
	variants: {
		position: {
			top: 'top-0',
			bottom: 'bottom-0',
		},
		height: {
			fixed: 'h-16',
			dynamic: 'min-h-16 h-auto',
		},
	},
	defaultVariants: {
		position: 'top',
		height: 'fixed',
	},
});

export const Navbar: FC<
	{
		start?: ReactNode;
		middle?: ReactNode;
		end?: ReactNode;
		className?: string;
	} & VariantProps<typeof navbar>
> = ({ start, position, middle, height, end, className }) => {
	return (
		<header className={navbar({ className, height, position })}>
			{start && <div>{start}</div>}
			<div className="grow">{middle}</div>
			{end && <div>{end}</div>}
		</header>
	);
};
