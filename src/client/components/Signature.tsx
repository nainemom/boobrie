import type { FC } from 'react';
import { tv } from 'tailwind-variants';
import { signature } from '../services/signature';

const image = tv({
	base: '[&>svg]:block [&>svg]:w-full [&>svg]:h-auto',
});

export const Signature: FC<{
	address: string;
	className?: string;
}> = ({ address, className }) => {
	return (
		<div
			className={image({ class: className })}
			// biome-ignore lint/security/noDangerouslySetInnerHtml: self-generated SVG, no user-controlled markup
			dangerouslySetInnerHTML={{
				__html: signature(address),
			}}
		/>
	);
};
