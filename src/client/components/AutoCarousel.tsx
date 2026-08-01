import { type HTMLAttributes, type JSX, useEffect, useState } from 'react';
import { twMerge } from 'tailwind-merge';

export function AutoCarousel<T>({
	className,
	slides,
	delay = 6000,
	children,
	...props
}: Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
	slides: T[];
	delay?: number;
	children: (slide: T, isActive: boolean) => JSX.Element;
}) {
	const [active, setActive] = useState(0);

	useEffect(() => {
		const timer = setInterval(() => {
			setActive((current) => (current + 1) % slides.length);
		}, delay);
		return () => clearInterval(timer);
	}, [slides.length, delay]);

	return (
		<div className={twMerge('relative overflow-hidden', className)} {...props}>
			{slides.map((slide, idx) => {
				const isActive = idx === active;
				return (
					<div
						key={idx.toString()}
						className={twMerge(
							'absolute inset-0',
							isActive ? 'opacity-100' : 'opacity-0 pointer-events-none',
						)}
					>
						{children(slide, isActive)}
					</div>
				);
			})}
		</div>
	);
}
