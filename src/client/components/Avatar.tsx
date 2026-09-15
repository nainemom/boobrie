import {
	Avatar as DicebearAvatar,
	Style as DicebearStyle,
} from '@dicebear/core';
import definition from '@dicebear/styles/notionists.json' with { type: 'json' };
import type { FC } from 'react';
import { GeneratedSvg } from './GeneratedSvg';

function generateAvatar(address: string): string {
	return new DicebearAvatar(new DicebearStyle(definition), {
		backgroundColor: ['ffffff00'],
		seed: address,
	}).toString();
}

export const Avatar: FC<{
	address: string;
	className?: string;
}> = ({ address, className }) => (
	<GeneratedSvg svg={generateAvatar(address)} className={className} />
);
