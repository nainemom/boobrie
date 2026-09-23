import { HatGlassesIcon, UserKeyIcon, UserPlusIcon } from 'lucide-react';
import type { FC } from 'react';
import { Link } from 'wouter';
import { PageActions } from '@/client/components/Page';
import { AutoCarousel } from '../../components/AutoCarousel';
import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { Divider } from '../../components/Divider';
import { useAuth } from '../../services/auth';
import { truncateAddress } from '../../utils/address';
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

// --- who's waiting -------------------------------------------------------

/** Whoever's link brought us here, in place of the logo. The avatar and the
 * address are drawn from the address alone, so they're right before the relay
 * has said a word; only the handle waits on the lookup. */
const PeerIntro: FC<{ address: string }> = ({ address }) => {
	return (
		<div className="flex w-full flex-col items-center gap-3 text-center">
			<Avatar
				address={address}
				className="size-52 shrink-0 border border-neutral-200"
			/>

			<div className="max-w-sm text-base text-neutral-500 leading-snug">
				<p>
					You're about to message{' '}
					<b className="text-neutral-800">{truncateAddress(address)}</b>.
				</p>
				<p>Which account do you want to use?</p>
			</div>
		</div>
	);
};

/** The app itself, for anyone who came to the door rather than through a link. */
const AppIntro: FC = () => (
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
);

// --- the step: /auth -----------------------------------------------------

/** The three ways in — four, when an account is already signed in here and a
 * link is waiting on an answer: keeping it is then a choice like any other, and
 * the one most people want. No title in the navbar; the logo (or the person
 * being written to) says where you are. */
export function ChooseStep() {
	const { identity } = useAuth();
	const flow = useAuthFlow();

	// Only leavable by somebody who already has an identity and wandered here on
	// purpose; everyone else is here because they have to be — and where a link
	// is waiting, the way out is one of the buttons, not the back arrow.
	return (
		<AuthLayout back={identity && !flow.peer ? flow.to : undefined}>
			<div className="flex flex-1 flex-col items-center justify-center overflow-y-auto">
				<div className="mx-auto flex w-full flex-col items-center gap-12 p-6">
					{flow.peer ? <PeerIntro address={flow.peer} /> : <AppIntro />}

					<div className="flex w-full max-w-sm flex-col gap-3">
						{identity && (
							<>
								<Button
									size={12}
									className="w-full"
									onClick={flow.done}
									variant="primary"
								>
									<Avatar
										address={identity.address}
										className="absolute inset-s-1.5 top-1.5 size-8.5 shrink-0 overflow-hidden"
									/>
									Continue as
									<b className="normal-case">
										{truncateAddress(identity.address)}
									</b>
								</Button>
								<Divider label="Or" />
							</>
						)}
						<Link href={flow.link('/auth/anonymous')} className="contents">
							<Button variant="outline" size={12} className="w-full">
								<HatGlassesIcon size={20} />
								Go Anonymous
							</Button>
						</Link>
						<Divider label={identity ? undefined : 'Or'} />
						<div className="grid grid-cols-2 gap-3">
							<Link href={flow.link('/auth/login')} className="contents">
								<Button variant="outline" size={12}>
									<UserKeyIcon size={20} />
									Log In
								</Button>
							</Link>
							<Link href={flow.link('/auth/register')} className="contents">
								<Button variant={identity ? 'outline' : 'primary'} size={12}>
									<UserPlusIcon size={20} />
									Sign Up
								</Button>
							</Link>
						</div>
					</div>
				</div>
			</div>
			<PageActions>
				<div className="text-base w-full text-center">
					<span className="text-neutral-500">Sponsored by</span>
					<a
						href="https://paasta.cloud"
						referrerPolicy="no-referrer"
						target="_blank"
						className="ms-2"
						rel="noopener noreferrer"
					>
						<img
							alt=""
							src="/paasta-logo.png"
							width={16}
							height={16}
							className="size-4 inline me-1 object-contain"
						/>
						Paasta Cloud
					</a>
				</div>
			</PageActions>
		</AuthLayout>
	);
}
