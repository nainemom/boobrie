import {
	Avatar as DicebearAvatar,
	Style as DicebearStyle,
} from '@dicebear/core';
import definition from '@dicebear/styles/notionists.json' with { type: 'json' };
import type { FC } from 'react';
import { twMerge } from 'tailwind-merge';
import { isAnonymous } from '@/shared/auth';
import { GeneratedSvg } from './GeneratedSvg';

function generateVariant(
	lengthOrInclude: number | number[],
	exclude?: number[],
) {
	if (Array.isArray(lengthOrInclude)) {
		const include = lengthOrInclude;
		return include
			.filter((i) => !exclude?.includes(i))
			.map((i) => `variant${i.toString().padStart(2, '0')}`) as never;
	}
	const length = lengthOrInclude;
	return Array.from({ length }, (_, i) => i + 1)
		.filter((i) => !exclude?.includes(i))
		.map((i) => `variant${i.toString().padStart(2, '0')}`) as never;
}

// Anonymous accounts wear the hat and the shades: the address carries the flag
// (see `isAnonymous`), so this reads off it alone — no lookup, and it works for
// a peer whose profile we have never fetched.
function generateAvatar(address: string): string {
	const anonymous = isAnonymous(address);
	return new DicebearAvatar(new DicebearStyle(definition), {
		backgroundColor: ['ffffff00'],
		seed: address,
		beardProbability: anonymous ? 0 : 10,
		glassesProbability: anonymous ? 100 : 20,
		glassesVariant: anonymous
			? generateVariant(11, [3, 8, 11])
			: generateVariant([3, 8, 11]),
		hairVariant: anonymous ? ['hat'] : generateVariant(63, [61]),
		clothesVariant: anonymous
			? generateVariant([2, 4, 6, 8])
			: generateVariant(25, [2, 4, 6, 8]),
	}).toString();
}

export const Avatar: FC<{
	address: string;
	className?: string;
}> = ({ address, className }) => (
	<GeneratedSvg
		svg={generateAvatar(address)}
		className={twMerge('bg-neutral-100 rounded-sm', className)}
	/>
);
