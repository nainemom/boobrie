import {
	CodeXmlIcon,
	EyeOffIcon,
	GiftIcon,
	KeyRoundIcon,
	LockIcon,
	PhoneOffIcon,
} from 'lucide-react';
import { z } from 'zod';
import { isValidMnemonic } from '@/shared/mnemonic';

export const AUTH_STEPS = ['choose', 'signup', 'signin', 'remember'] as const;

/** Shared across every step's form so recovery-phrase input is validated the
 * same way everywhere instead of each step re-deriving its own check. */
export const mnemonicSchema = z
	.string()
	.trim()
	.min(1, 'Enter your recovery phrase')
	.refine(isValidMnemonic, 'That doesn’t look like a valid recovery phrase.');

/** True for a 409 from the relay — used to tell "handle already taken" apart
 * from other failures on the actual signup call. */
export function isConflict(err: unknown): boolean {
	const e = err as { status?: number; statusCode?: number } | null;
	return e?.status === 409 || e?.statusCode === 409;
}

/** A human-readable message for an API error. The relay's JSON error body
 * carries the real message; ofetch's own `.message` is just a generic
 * "[POST] url: 404 Not Found" wrapper around it. */
export function apiErrorMessage(err: unknown, fallback: string): string {
	const data = (err as { data?: { message?: string } } | null)?.data;
	if (data?.message) return data.message;
	if (err instanceof Error) return err.message;
	return fallback;
}

export interface CarouselSlide {
	title: string;
	description: string;
	icon: typeof LockIcon;
	link?: { label: string; href: string };
}

export const CAROUSEL_SLIDES: CarouselSlide[] = [
	{
		title: 'Open Source',
		description:
			"Boobrie's code is fully public. Inspect it or audit it yourself.",
		icon: CodeXmlIcon,
		link: {
			label: 'View on GitHub',
			href: 'https://github.com/nainemom/boobrie',
		},
	},
	{
		title: 'End-to-End Encrypted',
		description:
			'Every message is encrypted on your device. Not even the server can read them.',
		icon: LockIcon,
	},
	{
		title: 'No Email or Phone Needed',
		description:
			'Create an identity from a recovery phrase alone. No email or phone number required.',
		icon: KeyRoundIcon,
	},
	{
		title: 'No Personal Data Access',
		description:
			'Boobrie never asks for your phone or contacts. No device permissions are required.',
		icon: PhoneOffIcon,
	},
	{
		title: 'Privacy Matters',
		description:
			'We may collect anonymous usage analytics, but never your personal info or conversations.',
		icon: EyeOffIcon,
	},
	{
		title: 'Free Forever',
		description: 'Core features, including random chat, are free forever.',
		icon: GiftIcon,
	},
];
