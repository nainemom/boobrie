import { type FC, useEffect, useState } from 'react';
import { twMerge } from 'tailwind-merge';
import { CAROUSEL_SLIDES } from './constants';

export const AuthCarousel: FC = () => {
	const [active, setActive] = useState(0);

	useEffect(() => {
		const timer = setInterval(() => {
			setActive((current) => (current + 1) % CAROUSEL_SLIDES.length);
		}, 6000);
		return () => clearInterval(timer);
	}, []);

	return (
		<div className="relative overflow-hidden bg-neutral-100 p-4 text-center border-b border-neutral-200">
			{/* Slides Container */}
			<div className="relative h-48 flex flex-col items-center justify-center">
				{CAROUSEL_SLIDES.map((slide, idx) => {
					const Icon = slide.icon;
					const isActive = idx === active;
					return (
						<div
							key={slide.title}
							className={twMerge(
								'absolute inset-0 flex flex-col items-center justify-center',
								isActive ? 'opacity-100' : 'opacity-0 pointer-events-none',
							)}
						>
							<div
								className={twMerge(
									'mb-3 flex size-16 items-center justify-center rounded-full bg-neutral-800 text-neutral-50 transition-all duration-200',
									isActive ? 'opacity-100' : 'rotate-90',
								)}
							>
								<Icon size={32} />
							</div>
							<h4 className="text-2xl font-bold text-neutral-800 tracking-tight">
								{slide.title}
							</h4>
							<p className="mt-1.5 max-w-xs text-sm text-neutral-500 leading-tight px-4">
								{slide.description}
								{slide.link && (
									<a
										href={slide.link.href}
										target="_blank"
										rel="noopener noreferrer"
										className="font-semibold text-neutral-700 ps-1 underline underline-offset-2"
									>
										{slide.link.label}
									</a>
								)}
							</p>
						</div>
					);
				})}
			</div>
		</div>
	);
};
