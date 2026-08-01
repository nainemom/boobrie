import { createAvatar } from '@dicebear/core';
import * as notionists from '@dicebear/notionists';
import type { FC } from 'react';
import { GeneratedSvg } from './GeneratedSvg';

function generateAvatar(address: string): string {
	return createAvatar(notionists, { seed: address, size: 18 }).toString();
}

export const Avatar: FC<{ address: string; className?: string }> = ({
	address,
	className,
}) => <GeneratedSvg svg={generateAvatar(address)} className={className} />;
