import { HatGlassesIcon, UserKeyIcon, UserPlusIcon } from 'lucide-react';
import type { FC } from 'react';
import { Link } from 'wouter';
import { AutoCarousel } from '../../components/AutoCarousel';
import { Button } from '../../components/Button';
import { Divider } from '../../components/Divider';
import { useAuth } from '../../services/auth';
import { AuthLayout, useAuthFlow } from './lib';

// --- carousel ------------------------------------------------------------

interface CarouselSlide {
	content: string;
	link?: { label: string; href: string };
}

const CAROUSEL_SLIDES: CarouselSlide[] = [
	{
		content: "Boobrie's code is fully public. Inspect it or audit it yourself.",
		link: {
			label: 'View on GitHub',
			href: 'https://github.com/nainemom/boobrie',
		},
	},
	{
		content:
			'Every message is encrypted on your device. Not even the server can read them.',
	},
	{
		content:
			'Create an identity from a recovery phrase alone. No email or phone number required.',
	},
	{
		content:
			'Boobrie never asks for your phone or contacts. No device permissions needed.',
	},
	{
		content:
			'We may collect anonymous usage analytics, but never your personal data.',
	},
	{
		content: 'Core features, including random chat and encryption, are free.',
	},
];

const AuthCarousel: FC = () => {
	return (
		<AutoCarousel className="h-16 w-full shrink-0" slides={CAROUSEL_SLIDES}>
			{(slide) => {
				return (
					<div
						key={slide.content}
						className="flex flex-col h-min items-center justify-center text-center"
					>
						<p className="mt-2 max-w-sm text-base text-neutral-500 leading-snug px-4">
							{slide.content}
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
			}}
		</AutoCarousel>
	);
};

// --- the step: /auth -----------------------------------------------------

/** The three ways in. No title in the navbar — the logo says where you are,
 * and this is the only place in the app it appears. */
export function ChooseStep() {
	const { identity } = useAuth();
	const flow = useAuthFlow();

	// Only leavable by somebody who already has an identity and wandered here on
	// purpose; everyone else is here because they have to be.
	return (
		<AuthLayout back={identity ? flow.to : undefined}>
			<div className="flex flex-1 flex-col items-center justify-center overflow-y-auto">
				<div className="mx-auto flex w-full flex-col items-center gap-12 p-6">
					<div className="flex w-full flex-col items-center gap-1 -mt-16">
						<img
							src="/logo.svg"
							alt="Boobrie"
							width={512}
							height={512}
							className="size-32 shrink-0 -mb-8 -ml-3"
						/>

						<h1 className="text-3xl font-black">Boobrie</h1>

						<AuthCarousel />
					</div>

					<div className="flex w-full max-w-sm flex-col gap-3">
						<Link href={flow.link('/auth/anonymous')} className="contents">
							<Button variant="outline" size={12} className="w-full">
								<HatGlassesIcon size={20} />
								Go Anonymous
							</Button>
						</Link>
						<Divider label="Or" />
						<div className="grid grid-cols-2 gap-3">
							<Link href={flow.link('/auth/login')} className="contents">
								<Button variant="outline" size={12}>
									<UserKeyIcon size={20} />
									Log In
								</Button>
							</Link>
							<Link href={flow.link('/auth/register')} className="contents">
								<Button variant="primary" size={12}>
									<UserPlusIcon size={20} />
									Sign Up
								</Button>
							</Link>
						</div>
					</div>
				</div>
			</div>
		</AuthLayout>
	);
}
