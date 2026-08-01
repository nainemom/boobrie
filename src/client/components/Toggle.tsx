import type { FC } from 'react';
import { tv } from 'tailwind-variants';

const toggle = tv({
	base: [
		'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full outline-none transition-colors',
		'focus-visible:ring-2 focus-visible:ring-neutral-500 disabled:pointer-events-none disabled:opacity-50',
	],
	variants: {
		checked: {
			true: 'bg-primary',
			false: 'bg-neutral-300',
		},
	},
});

const thumb = tv({
	base: 'inline-block size-5 rounded-full bg-white shadow transition-transform',
	variants: {
		checked: {
			true: 'translate-x-5',
			false: 'translate-x-0.5',
		},
	},
});

export const Toggle: FC<{
	checked: boolean;
	onChange: () => void;
	label: string;
	disabled?: boolean;
}> = ({ checked, onChange, label, disabled }) => (
	<button
		type="button"
		role="switch"
		aria-checked={checked}
		aria-label={label}
		disabled={disabled}
		onClick={onChange}
		className={toggle({ checked })}
	>
		<span className={thumb({ checked })} />
	</button>
);
