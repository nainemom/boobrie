import type { FC, ReactNode } from 'react';
import { tv } from 'tailwind-variants';

const panel = tv({
	base: 'max-h-[calc(100%-2rem)] w-full max-w-sm overflow-y-auto rounded-md bg-neutral-50 text-neutral-800 shadow-xl',
});

/**
 * A centered panel over a dimmed backdrop. Purely presentational and with no
 * close control of its own — whoever mounts it decides when it's shown, so it
 * can serve both dismissible dialogs and a forced gate that stays put.
 */
export const Modal: FC<{ children: ReactNode; className?: string }> = ({
	children,
	className,
}) => (
	<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
		<div className={panel({ class: className })}>{children}</div>
	</div>
);
