import { zodResolver } from '@hookform/resolvers/zod';
import { CheckIcon, ChevronLeftIcon, WandIcon } from 'lucide-react';
import { type FC, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';
import { z } from 'zod';
import { handleSchema } from '@/shared/protocol';
import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { Form } from '../../components/Form';
import { FormField } from '../../components/FormField';
import { Input } from '../../components/Input';
import { PageActions, PageBody } from '../../components/Page';
import { Signature } from '../../components/Signature';
import { generate, login } from '../../services/auth';
import { errorMessage } from '../../utils/errors';
import { AuthLayout, useAuthFlow } from './lib';

const signUpSchema = z.object({ handle: handleSchema });

type SignUpForm = z.infer<typeof signUpSchema>;

/** True for a 409 from the relay — used to tell "handle already taken" apart
 * from other failures on the actual signup call. */
function isConflict(err: unknown): boolean {
	const e = err as { status?: number; statusCode?: number } | null;
	return e?.status === 409 || e?.statusCode === 409;
}

export function RegisterStep() {
	const flow = useAuthFlow();
	const [phrase, setPhrase] = useState('');

	const registerMutation = useSWRMutation(
		'auth/register',
		(_key: string, { arg }: { arg: { mnemonic: string; handle: string } }) =>
			login(arg),
	);

	// Registering runs in two halves: claim a handle, then prove the recovery
	// phrase was written down. The second half has no URL of its own because
	// there is no way to arrive at it — it only exists once an account has been
	// made, and reloading into it would have no phrase to show.
	if (phrase) {
		return <SavePhrase phrase={phrase} onSaved={flow.done} />;
	}

	return (
		<AuthLayout
			title="Create your identity"
			back={registerMutation.isMutating ? undefined : flow.link('/auth')}
		>
			<RegisterForm
				busy={registerMutation.isMutating}
				onSubmit={async (mnemonic, handle) => {
					await registerMutation.trigger({ mnemonic, handle });
					setPhrase(mnemonic);
				}}
			/>
		</AuthLayout>
	);
}

const RegisterForm: FC<{
	busy: boolean;
	onSubmit: (mnemonic: string, handle: string) => Promise<void>;
}> = ({ busy, onSubmit }) => {
	const [index, setIndex] = useState(0);

	const draft = useSWR(`draft-identity-${index}`, () => generate(false), {
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
	} = useForm<SignUpForm>({ resolver: zodResolver(signUpSchema) });

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
		<Form onSubmit={handleSubmit(submit)} className="min-h-0 flex-1 gap-0">
			<PageBody>
				<FormField
					label="Handle"
					htmlFor="handle-input"
					error={errors.handle?.message}
					vertical
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
				<FormField label="Avatar & Signature" htmlFor="address-button" vertical>
					<div className="relative w-full rounded-sm border border-neutral-200 bg-neutral-50">
						<div className="flex items-center gap-1 px-3 h-44 justify-between w-full bg-neutral-100 border-b border-neutral-200">
							{address && (
								<>
									<Avatar address={address} className="size-44 shrink-0" />
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
			</PageBody>

			<PageActions>
				<Button
					type="submit"
					size={12}
					disabled={!address}
					loading={busy}
					className="w-full"
				>
					<CheckIcon size={18} />
					Sign Up
				</Button>
			</PageActions>
		</Form>
	);
};

const guessSchema = z.object({
	guess: z.string().trim().min(1, 'Enter the word'),
});

type GuessForm = z.infer<typeof guessSchema>;

/** The account already exists by the time this shows — the only thing left is
 * making sure its 12 words left the screen with their owner. */
const SavePhrase: FC<{ phrase: string; onSaved: () => void }> = ({
	phrase,
	onSaved,
}) => {
	const words = phrase.split(' ');
	const [checkIndex, setCheckIndex] = useState<number | null>(null);
	const [checkError, setCheckError] = useState<string | null>(null);

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

	const startCheck = () => {
		reset();
		setCheckError(null);
		setCheckIndex(Math.floor(Math.random() * words.length));
	};

	// A wrong guess drops back to the full phrase list (with an error) rather
	// than retrying in place — the point is to re-read the words, not guess again.
	const guess = ({ guess: value }: GuessForm) => {
		if (checkIndex === null) return;
		if (value.trim().toLowerCase() === words[checkIndex]) {
			onSaved();
		} else {
			setCheckIndex(null);
			setCheckError("That's not it — check your saved phrase and try again.");
		}
	};

	if (checkIndex !== null) {
		return (
			<AuthLayout
				title="Quick check"
				subtitle={`What's word ${checkIndex + 1} of your recovery phrase?`}
			>
				<Form onSubmit={handleSubmit(guess)} className="min-h-0 flex-1 gap-0">
					<PageBody>
						<FormField
							label={`Word ${checkIndex + 1}`}
							htmlFor="check-word-input"
							error={errors.guess?.message}
							vertical
						>
							<Input
								id="check-word-input"
								size={12}
								autoFocus
								spellCheck="false"
								autoCapitalize="none"
								autoComplete="off"
								autoCorrect="off"
								className="w-full"
								{...register('guess')}
							/>
						</FormField>
					</PageBody>

					<PageActions>
						<Button
							variant="outline"
							size={12}
							type="button"
							onClick={() => setCheckIndex(null)}
							className="w-full"
						>
							<ChevronLeftIcon size={18} />
							Show It Again
						</Button>
						<Button type="submit" size={12} className="w-full">
							<CheckIcon size={18} />
							Confirm
						</Button>
					</PageActions>
				</Form>
			</AuthLayout>
		);
	}

	return (
		<AuthLayout
			title="Save your recovery phrase"
			subtitle="These 12 words are the only way back into this account. Write them down and keep them somewhere safe."
		>
			<PageBody>
				<FormField label="Recovery phrase" error={checkError} vertical>
					<ol className="grid grid-cols-3 gap-2 w-full">
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
			</PageBody>

			<PageActions>
				<Button size={12} onClick={startCheck} className="w-full">
					<CheckIcon size={18} />
					I've Saved It
				</Button>
			</PageActions>
		</AuthLayout>
	);
};
