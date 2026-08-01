import type { FC, ReactNode } from 'react';
import { tv, type VariantProps } from 'tailwind-variants';

const navbar = tv({
	base: [
		'h-16 p-2 sticky left-0 w-full bg-neutral-50',
		'flex items-stretch gap-2',
		'[&>div]:flex [&>div]:items-center [&>div]:gap-2 [&>div]:shrink-0',
	],
	variants: {
		position: {
			top: 'top-0',
			bottom: 'bottom-0',
		},
	},
	defaultVariants: {
		position: 'top',
	},
});

export const Navbar: FC<
	{
		start?: ReactNode;
		middle?: ReactNode;
		end?: ReactNode;
		className?: string;
	} & VariantProps<typeof navbar>
> = ({ start, position, middle, end, className }) => {
	return (
		<header className={navbar({ className, position })}>
			{start && <div>{start}</div>}
			<div className="grow">{middle}</div>
			{end && <div>{end}</div>}
		</header>
	);
};
