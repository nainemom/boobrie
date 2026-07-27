import type { FC } from 'react';
import { tv, type VariantProps } from 'tailwind-variants';
import { avatar } from '../services/avatar';

const image = tv({
	base: 'flex items-center justify-center [&>svg]:block [&>svg]:w-full [&>svg]:h-auto',
});
export const Avatar: FC<
	{
		address: string;
		className?: string;
	} & VariantProps<typeof image>
> = ({ address, className }) => {
	return (
		<div
			className={image({ className })}
			// biome-ignore lint/security/noDangerouslySetInnerHtml: self-generated SVG, no user-controlled markup
			dangerouslySetInnerHTML={{
				__html: avatar(address),
			}}
		/>
	);
};
