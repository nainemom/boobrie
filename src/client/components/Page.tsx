import type { FC, ReactNode } from 'react';

export const Page: FC<{ children?: ReactNode }> = ({ children }) => (
	<main className="relative flex h-full flex-col">{children}</main>
);
