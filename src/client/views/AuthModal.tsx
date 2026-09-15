import { zodResolver } from '@hookform/resolvers/zod';
import {
	CheckIcon,
	CodeXmlIcon,
	EyeOffIcon,
	GiftIcon,
	HatGlassesIcon,
	KeyRoundIcon,
	LoaderIcon,
	LockIcon,
	PhoneOffIcon,
	UserKeyIcon,
	UserPlusIcon,
	WandIcon,
} from 'lucide-react';
import { type FC, Suspense, use, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';
import { z } from 'zod';
import { AutoCarousel } from '@/client/components/AutoCarousel';
import { Avatar } from '@/client/components/Avatar';
import { Button } from '@/client/components/Button';
import { Divider } from '@/client/components/Divider';
import { Form } from '@/client/components/Form';
import { FormActions } from '@/client/components/FormActions';
import { FormField } from '@/client/components/FormField';
import { Input } from '@/client/components/Input';
import { Modal } from '@/client/components/Modal';
import { Signature } from '@/client/components/Signature';
import { Textarea } from '@/client/components/Textarea';
import { generate, login, restore, useAuth } from '@/client/services/auth';
import { errorMessage } from '@/client/utils/errors';
import { isValidMnemonic } from '@/shared/mnemonic';
import { handleSchema } from '@/shared/protocol';

// --- constants ---------------------------------------------------------

type AuthStep = 'choose' | 'signup' | 'signin' | 'remember';

/** Shared across every step's form so recovery-phrase input is validated the
 * same way everywhere instead of each step re-deriving its own check. */
const mnemonicSchema = z
	.string()
	.trim()
	.min(1, 'Enter your recovery phrase')
	.refine(isValidMnemonic, 'That doesn’t look like a valid recovery phrase.');

/** True for a 409 from the relay — used to tell "handle already taken" apart
 * from other failures on the actual signup call. */
function isConflict(err: unknown): boolean {
	const e = err as { status?: number; statusCode?: number } | null;
	return e?.status === 409 || e?.statusCode === 409;
}

// --- carousel ------------------------------------------------------------

interface CarouselSlide {
	title: string;
	description: string;
	icon: typeof LockIcon;
	link?: { label: string; href: string };
}

const CAROUSEL_SLIDES: CarouselSlide[] = [
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
			'Boobrie never asks for your phone or contacts. No device permissions needed.',
		icon: PhoneOffIcon,
	},
	{
		title: 'Privacy Matters',
		description:
			'We may collect anonymous usage analytics, but never your personal data.',
		icon: EyeOffIcon,
	},
	{
		title: 'Free to Use',
		description:
			'Core features, including random chat and encryption, are free.',
		icon: GiftIcon,
	},
];

const AuthCarousel: FC = () => {
	return (
		<AutoCarousel className="h-52" slides={CAROUSEL_SLIDES}>
			{(slide) => {
				const Icon = slide.icon;
				return (
					<div
						key={slide.title}
						className="flex flex-col h-full items-center justify-center text-center"
					>
						<div className="mb-3 flex size-16 items-center justify-center rounded-full bg-neutral-800 text-neutral-50">
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
			}}
		</AutoCarousel>
	);
};

// --- choose step -------------------------------------------------------

interface ChooseStepProps {
	busy: boolean;
	error: string | null;
	onGoAnonymous: () => void;
	onSelect: (step: 'signin' | 'signup') => void;
}

const ChooseStep: FC<ChooseStepProps> = ({
	busy,
	error,
	onGoAnonymous,
	onSelect,
}) => {
	return (
		<div className="flex flex-col gap-3">
			<AuthCarousel />
			<Button
				variant="outline"
				size={12}
				onClick={onGoAnonymous}
				loading={busy}
				className="w-full"
			>
				<HatGlassesIcon size={20} />
				Go Anonymous
			</Button>
			{error && <FormField error={error} />}
			<Divider label="Or" />
			<div className="grid grid-cols-2 gap-3">
				<Button
					variant="outline"
					onClick={() => onSelect('signin')}
					size={12}
					disabled={busy}
				>
					<UserKeyIcon size={20} />
					Log In
				</Button>
				<Button
					variant="primary"
					size={12}
					onClick={() => onSelect('signup')}
					disabled={busy}
				>
					<UserPlusIcon size={20} />
					Sign Up
				</Button>
			</div>
		</div>
	);
};

// --- sign in step --------------------------------------------------------

const loginSchema = z.object({
	mnemonic: mnemonicSchema,
});

type LoginForm = z.infer<typeof loginSchema>;

interface SignInStepProps {
	busy: boolean;
	error: string | null;
	onSubmit: (mnemonic: string) => void;
}

const SignInStep: FC<SignInStepProps> = ({ busy, error, onSubmit }) => {
	const {
		register,
		handleSubmit,
		formState: { errors },
	} = useForm<LoginForm>({ resolver: zodResolver(loginSchema) });

	return (
		<Form onSubmit={handleSubmit(({ mnemonic }) => onSubmit(mnemonic))}>
			<FormField
				label="Recovery phrase"
				htmlFor="recovery-phrase-input"
				error={errors.mnemonic?.message}
			>
				<Textarea
					id="recovery-phrase-input"
					className="w-full"
					size={12}
					placeholder="word1 word2 … word12"
					autoFocus
					autoCapitalize="none"
					{...register('mnemonic')}
				/>
			</FormField>

			{error && <FormField error={error} />}

			<FormActions>
				<Button type="submit" size={12} loading={busy} className="col-span-3">
					<CheckIcon size={18} />
					Log In
				</Button>
			</FormActions>
		</Form>
	);
};

// --- sign up step --------------------------------------------------------

const signUpSchema = z.object({
	handle: handleSchema,
});

type SignUpForm = z.infer<typeof signUpSchema>;

interface SignUpStepProps {
	busy: boolean;
	onSubmit: (mnemonic: string, handle: string) => Promise<void>;
}

const SignUpStep: FC<SignUpStepProps> = ({ busy, onSubmit }) => {
	const [index, setIndex] = useState(0);

	const draft = useSWR(`draft-identity-${index}`, generate, {
		revalidateOnFocus: false,
		revalidateOnReconnect: false,
		revalidateIfStale: false,
		keepPreviousData: true,
	});
	const address = draft.data?.address;

	const {
		register,
		handleSubmit,
		setError,
		formState: { errors },
	} = useForm<SignUpForm>({
		resolver: zodResolver(signUpSchema),
	});

	const submit = async ({ handle }: SignUpForm) => {
		if (!draft.data?.mnemonic) return;
		try {
			await onSubmit(draft.data.mnemonic, handle);
		} catch (err) {
			setError('handle', {
				type: 'manual',
				message: isConflict(err)
					? 'That handle is already taken.'
					: errorMessage(err),
			});
		}
	};

	return (
		<Form onSubmit={handleSubmit(submit)}>
			<FormField
				label="Handle"
				htmlFor="handle-input"
				error={errors.handle?.message}
			>
				<Input
					id="handle-input"
					placeholder="Choose a handle"
					className="w-full"
					size={12}
					disabled={busy}
					autoCapitalize="none"
					autoComplete="off"
					autoCorrect="off"
					spellCheck="false"
					autoFocus
					{...register('handle')}
				/>
			</FormField>
			<FormField label="Avatar & Signature" htmlFor="address-button">
				<div className="relative w-full rounded-sm border border-neutral-200 bg-neutral-50">
					<div className="flex items-center gap-1 px-3 h-32 justify-between w-full bg-neutral-100 border-b border-neutral-200">
						{address && (
							<>
								<Avatar address={address} className="size-32 shrink-0" />
								<Signature
									address={address}
									className="text-neutral-700 h-32"
								/>
							</>
						)}
					</div>
					<div className="p-3">
						<Button
							id="address-button"
							variant="outline"
							size={10}
							type="button"
							onClick={() => setIndex((i) => i + 1)}
							disabled={busy}
							loading={draft.isLoading}
							className="shrink-0 w-full"
						>
							<WandIcon size={16} /> Generate
						</Button>
					</div>
				</div>
			</FormField>

			<FormActions>
				<Button
					type="submit"
					size={12}
					disabled={!address}
					loading={busy}
					className="col-span-3"
				>
					<CheckIcon size={18} />
					Sign Up
				</Button>
			</FormActions>
		</Form>
	);
};

// --- remember step -------------------------------------------------------

const guessSchema = z.object({
	guess: z.string().trim().min(1, 'Enter the word'),
});

type GuessForm = z.infer<typeof guessSchema>;

interface RememberStepProps {
	phrase: string;
	checkIndex: number | null;
	error: string | null;
	onStartCheck: () => void;
	onGuess: (guess: string) => void;
}

const RememberStep: FC<RememberStepProps> = ({
	phrase,
	checkIndex,
	error,
	onStartCheck,
	onGuess,
}) => {
	const words = phrase.split(' ');

	useEffect(() => {
		const handler = (e: BeforeUnloadEvent) => {
			e.preventDefault();
			e.returnValue = '';
		};
		window.addEventListener('beforeunload', handler);
		return () => window.removeEventListener('beforeunload', handler);
	}, []);

	const {
		register,
		handleSubmit,
		reset,
		formState: { errors },
	} = useForm<GuessForm>({ resolver: zodResolver(guessSchema) });

	// A fresh check gets a fresh field — clears out whatever was typed (right or
	// wrong) on the previous attempt.
	useEffect(() => {
		reset();
	}, [reset]);

	if (checkIndex !== null) {
		return (
			<Form onSubmit={handleSubmit(({ guess }) => onGuess(guess))}>
				<FormField
					label={`Word ${checkIndex + 1}`}
					htmlFor="check-word-input"
					error={errors.guess?.message}
				>
					<Input
						id="check-word-input"
						size={12}
						autoFocus
						spellCheck="false"
						autoCapitalize="none"
						autoComplete="off"
						autoCorrect="off"
						{...register('guess')}
					/>
				</FormField>

				<FormActions>
					<Button type="submit" size={12} className="col-span-3">
						<CheckIcon size={18} />
						Confirm
					</Button>
				</FormActions>
			</Form>
		);
	}

	return (
		<div className="flex flex-col gap-3">
			<FormField label="Recovery phrase" error={error}>
				<ol className="grid grid-cols-3 gap-2">
					{words.map((word, index) => (
						<li
							// biome-ignore lint/suspicious/noArrayIndexKey: fixed-order phrase, words may repeat, never reordered
							key={`${index}-${word}`}
							className="flex items-center gap-2 rounded-lg border border-neutral-300 px-3 py-2"
						>
							<span className="text-xs text-neutral-400 font-mono">
								{(index + 1).toString().padStart(2, '0')}
							</span>
							<span className="font-medium select-text">{word}</span>
						</li>
					))}
				</ol>
			</FormField>

			<Divider />

			<Button size={12} onClick={onStartCheck} className="w-full">
				<CheckIcon size={18} />
				I've Saved It
			</Button>
		</div>
	);
};

// --- the modal itself ------------------------------------------------------

export const AuthModal: FC = () => {
	const { identity } = useAuth();
	const [step, setStep] = useState<AuthStep>('choose');
	const [phrase, setPhrase] = useState('');
	const [checkIndex, setCheckIndex] = useState<number | null>(null);
	const [checkError, setCheckError] = useState<string | null>(null);

	// The modal stays mounted across logins/logouts, so its step wouldn't
	// otherwise reset — jump back to the choose step whenever the user logs out.
	useEffect(() => {
		if (!identity) {
			setStep('choose');
			setCheckIndex(null);
			setCheckError(null);
		}
	}, [identity]);

	const loginMutation = useSWRMutation(
		'auth/login',
		async (
			_key: string,
			{ arg }: { arg: { mnemonic?: string; handle?: string } },
		) => {
			const mnemonic = arg.mnemonic ?? (await generate()).mnemonic;
			if (!mnemonic) throw new Error('Failed to generate an identity');
			return login({ mnemonic, handle: arg.handle });
		},
	);

	// Signup creates the account immediately, but the recovery phrase still
	// needs to be shown once it's set — don't close on it until acknowledged.
	if (identity && step !== 'remember') return null;

	const go = (next: AuthStep) => {
		loginMutation.reset();
		setCheckIndex(null);
		setCheckError(null);
		setStep(next);
	};

	const submit = (mnemonic?: string, handle?: string) =>
		loginMutation.trigger({ mnemonic, handle }, { throwOnError: false });

	const signUp = async (mnemonic: string, handle: string) => {
		await loginMutation.trigger({ mnemonic, handle }, { throwOnError: true });
		setPhrase(mnemonic);
		setStep('remember');
	};

	const startCheck = () => {
		setCheckError(null);
		setCheckIndex(Math.floor(Math.random() * phrase.split(' ').length));
	};

	// A wrong guess drops back to the full phrase list (with an error) rather
	// than retrying in place — the point is to re-read the words, not guess again.
	const guess = (value: string) => {
		if (checkIndex === null) return;
		if (value.trim().toLowerCase() === phrase.split(' ')[checkIndex]) {
			go('choose');
		} else {
			setCheckIndex(null);
			setCheckError("That's not it — check your saved phrase and try again.");
		}
	};

	const errorText = loginMutation.error
		? errorMessage(loginMutation.error)
		: null;

	const header = (() => {
		if (step === 'signin') {
			return {
				title: 'Welcome back',
				subtitle:
					'Enter the 12 words you saved when you created your identity.',
				backButton: true,
				backDisabled: loginMutation.isMutating,
				onBack: () => go('choose'),
			};
		}
		if (step === 'signup') {
			return {
				title: 'Create your identity',
				backButton: true,
				backDisabled: loginMutation.isMutating,
				onBack: () => go('choose'),
			};
		}
		if (step === 'remember') {
			return checkIndex !== null
				? {
						title: 'Quick check',
						subtitle: `What's word ${checkIndex + 1} of your recovery phrase?`,
						backButton: true,
						onBack: () => setCheckIndex(null),
					}
				: {
						title: 'Save your recovery phrase',
						subtitle:
							'These 12 words are the only way back into this account. Write them down and keep them somewhere safe.',
					};
		}
		return {};
	})();

	return (
		<Modal {...header}>
			<Suspense fallback={<AuthLoading />}>
				<RestoreSession />
				{step === 'choose' && (
					<ChooseStep
						busy={loginMutation.isMutating}
						error={errorText}
						onGoAnonymous={() => submit()}
						onSelect={go}
					/>
				)}
				{step === 'signup' && (
					<SignUpStep busy={loginMutation.isMutating} onSubmit={signUp} />
				)}
				{step === 'signin' && (
					<SignInStep
						busy={loginMutation.isMutating}
						error={errorText}
						onSubmit={(mnemonic) => submit(mnemonic)}
					/>
				)}
				{step === 'remember' && (
					<RememberStep
						phrase={phrase}
						checkIndex={checkIndex}
						error={checkError}
						onStartCheck={startCheck}
						onGuess={guess}
					/>
				)}
			</Suspense>
		</Modal>
	);
};

// The saved-session check only makes sense once, at boot: after an explicit
// logout there's definitely no session to restore, so re-running it every
// time this component remounts (it does, on every login/logout cycle) just
// reopens the auth modal on a fresh Suspense round-trip for no reason. Cache
// it at module scope — outliving any single mount — so later mounts see the
// already-settled boot promise and never suspend again. `restore()` itself
// stays freely callable elsewhere (e.g. relay.ts re-authenticates on a 401).
let initialRestore: Promise<boolean> | null = null;

const RestoreSession: FC = () => {
	if (!initialRestore) initialRestore = restore();
	use(initialRestore);
	return null;
};

const AuthLoading: FC = () => (
	<div className="flex flex-col items-center justify-center gap-2 h-32 font-medium">
		<LoaderIcon size={24} className="animate-spin" />
		Restoring Session...
	</div>
);
