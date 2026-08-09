import type { ButtonHTMLAttributes, FC } from 'react';
import { tv } from 'tailwind-variants';

const toggle = tv({
	base: [
		'relative inline-flex h-6 w-10 p-1 shrink-0 items-center justify-center rounded-full cursor-pointer',
		'outline-dashed -outline-offset-1 outline-transparent border border-neutral-50',
		'focus-visible:outline-neutral-500 disabled:pointer-events-none disabled:opacity-50',
	],
	variants: {
		checked: {
			true: 'bg-primary',
			false: 'bg-neutral-300',
		},
	},
});

const thumb = tv({
	base: 'inline-block size-4 rounded-full bg-neutral-50 pointer-events-none',
	variants: {
		checked: {
			true: 'translate-x-1/2',
			false: '-translate-x-1/2',
		},
	},
});

export const Toggle: FC<
	ButtonHTMLAttributes<HTMLButtonElement> & {
		checked: boolean;
		onChange: () => void;
	}
> = ({ checked, onChange, ...props }) => (
	<button
		type="button"
		role="switch"
		aria-checked={checked}
		onClick={onChange}
		className={toggle({ checked })}
		{...props}
	>
		<span className={thumb({ checked })} />
	</button>
);
