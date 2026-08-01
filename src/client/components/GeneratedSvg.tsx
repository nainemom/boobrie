import type { FC } from 'react';
import { tv, type VariantProps } from 'tailwind-variants';

const generatedSvg = tv({
	base: 'flex items-center justify-center [&>svg]:block [&>svg]:w-full [&>svg]:h-auto',
});

/** Renders a self-contained, pre-generated `<svg>` string (e.g. an address's
 * avatar or signature) scaled to fill its box. */
export const GeneratedSvg: FC<
	{ svg: string; className?: string } & VariantProps<typeof generatedSvg>
> = ({ svg, className }) => (
	<div
		className={generatedSvg({ className })}
		// biome-ignore lint/security/noDangerouslySetInnerHtml: self-generated SVG, no user-controlled markup
		dangerouslySetInnerHTML={{ __html: svg }}
	/>
);
