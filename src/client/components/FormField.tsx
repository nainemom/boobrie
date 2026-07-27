import { ChevronRightIcon } from 'lucide-react';
import type { FC, ReactNode } from 'react';
import { tv, type VariantProps } from 'tailwind-variants';

const formField = tv({
	base: 'flex flex-col gap-1.5 w-full',
});

export const FormField: FC<
	{
		htmlFor?: string;
		label?: string | null;
		error?: string | null;
		children?: ReactNode;
		className?: string;
	} & VariantProps<typeof formField>
> = ({ htmlFor, label, children, error, className }) => {
	return (
		<div className={formField({ className })}>
			{label && (
				<label
					htmlFor={htmlFor}
					className="text-sm font-medium text-neutral-400"
				>
					{label}:
				</label>
			)}
			{children}
			{error && (
				<p
					role="alert"
					className="text-sm bg-red-50 p-3 text-red-700 border border-red-100 w-full flex items-start gap-1 leading-tight mt-1 rounded-md"
				>
					<ChevronRightIcon size={16} className="shrink-0" /> {error}
				</p>
			)}
		</div>
	);
};
