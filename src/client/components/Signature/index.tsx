import type { FC } from 'react';
import { GeneratedSvg } from '../GeneratedSvg';
import { generateSignature } from './lib';

export const Signature: FC<{ address: string; className?: string }> = ({
	address,
	className,
}) => <GeneratedSvg svg={generateSignature(address)} className={className} />;
