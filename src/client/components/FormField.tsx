import { ChevronRightIcon, InfoIcon } from 'lucide-react';
import type { FC, ReactNode } from 'react';
import { twJoin } from 'tailwind-merge';
import { tv, type VariantProps } from 'tailwind-variants';

const formField = tv({
	base: 'flex flex-col gap-1.5 w-full',
});

export const FormField: FC<
	{
		htmlFor?: string;
		label?: string | null;
		error?: string | null;
		success?: string | null;
		info?: string | null;
		children?: ReactNode;
		className?: string;
		vertical?: boolean;
	} & VariantProps<typeof formField>
> = ({
	htmlFor,
	label,
	children,
	error,
	success,
	info,
	className,
	vertical,
}) => {
	return (
		<div className={formField({ className })}>
			<div
				className={twJoin(
					'flex items-center justify-between gap-2 w-full',
					vertical && 'flex-col items-start',
				)}
			>
				{label && (
					<label
						htmlFor={htmlFor}
						className="text-sm font-medium text-neutral-400 grow shrink-0 flex gap-1 items-center"
					>
						{label}
						{': '}
						{info && (
							<span title={info}>
								<InfoIcon size={14} className="inline-block" />
							</span>
						)}
					</label>
				)}
				<div
					className={twJoin(
						label ? 'shrink' : 'contents',
						vertical && 'w-full',
					)}
				>
					{children}
				</div>
			</div>
			{error && (
				<p
					role="alert"
					className="text-sm bg-red-50 p-3 text-red-700 border border-red-100 w-full flex items-start gap-1 leading-tight mt-1 rounded-md"
				>
					<ChevronRightIcon size={16} className="shrink-0" /> {error}
				</p>
			)}
			{success && (
				<p
					role="alert"
					className="text-sm bg-green-50 p-3 text-green-700 border border-green-100 w-full flex items-start gap-1 leading-tight mt-1 rounded-md"
				>
					<ChevronRightIcon size={16} className="shrink-0" /> {success}
				</p>
			)}
		</div>
	);
};
