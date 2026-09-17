import type { FC, ReactNode } from 'react';
import { twMerge } from 'tailwind-merge';

/**
 * A full-height screen. Pages are built from three pieces stacked in this
 * order: a {@link Navbar} on top, a {@link PageBody} that takes the slack and
 * scrolls, and — where a screen has something to press — a {@link PageActions}
 * bar pinned underneath it.
 */
export const Page: FC<{ children?: ReactNode }> = ({ children }) => (
	<main className="relative flex h-full flex-col">{children}</main>
);

/** The scrolling middle of a page: everything between the navbar and whatever
 * is pinned below it. */
export const PageBody: FC<{ children?: ReactNode; className?: string }> = ({
	children,
	className,
}) => (
	<div
		className={twMerge(
			'flex flex-1 flex-col gap-3 overflow-y-auto p-3',
			className,
		)}
	>
		{children}
	</div>
);

/** Actions pinned to the bottom of a page. They stay put while the body
 * scrolls, so the button the screen exists for is always within thumb reach
 * instead of somewhere down the page. */
export const PageActions: FC<{ children?: ReactNode }> = ({ children }) => (
	<div className="flex shrink-0 flex-col gap-3 border-t border-neutral-200 p-3">
		{children}
	</div>
);
