import type { FC, ReactNode } from 'react';

export const Section: FC<{ title: string; children: ReactNode }> = ({
	title,
	children,
}) => (
	<section className="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-3">
		<h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
			{title}
		</h2>
		{children}
	</section>
);
