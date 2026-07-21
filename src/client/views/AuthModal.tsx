import { zodResolver } from '@hookform/resolvers/zod';
import { type FC, use, useState } from 'react';
import { useForm } from 'react-hook-form';
import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';
import { z } from 'zod';
import { isValidMnemonic } from '@/shared/mnemonic';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { Spinner } from '../components/Spinner';
import { generate, login, restore, useIdentity } from '../services/auth';

type Step = 'main' | 'login' | 'remember';

const ALERT = 'rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700';

/**
 * The identity gate. Mounted once, on top of the whole app: while there's no
 * identity it forces itself open — no backdrop, no close control — so the app
 * underneath is reachable but every screen that needs an identity waits behind
 * it. The moment one is picked it vanishes.
 *
 * The parent only orchestrates the flow: which step is showing and running the
 * login mutation. Each step owns its own concerns — MainStep the identity
 * gallery, LoginStep the phrase form — and reports out through callbacks.
 */
export const AuthModal: FC = () => {
	use(restore());
	const identity = useIdentity();

	const [step, setStep] = useState<Step>('main');
	// The phrase to log in with: either handed up by MainStep when the user
	// picks a generated identity (and shown to save on the remember step), or
	// typed on the login step.
	const [phrase, setPhrase] = useState('');

	// Login is a mutation, so let SWR own its in-flight and error state rather
	// than hand-rolling busy/error flags: `trigger` runs the login, `isMutating`
	// is the busy flag, `error` holds a failure, and `reset` clears a stale one.
	const {
		trigger,
		isMutating: busy,
		error,
		reset,
	} = useSWRMutation('auth/login', (_key: string, { arg }: { arg: string }) =>
		login({ mnemonic: arg }),
	);

	// Identity chosen — stand down and let the app through.
	if (identity) return null;

	const go = (next: Step) => {
		reset();
		setStep(next);
	};

	// Log in with a phrase. On success the identity appears and this whole modal
	// unmounts on the next render, so there's nothing to navigate here.
	// throwOnError: false — the failure lands in SWR's `error` (shown below), so
	// there's no rejection to also catch here.
	const submit = (mnemonic: string) =>
		trigger(mnemonic, { throwOnError: false });

	const errorMessage = error
		? error instanceof Error
			? error.message
			: String(error)
		: null;

	// A freshly generated identity was picked — save it, then show its phrase.
	const pick = (mnemonic: string) => {
		setPhrase(mnemonic);
		go('remember');
	};

	return (
		<Modal>
			{step === 'main' && (
				<MainStep onPick={pick} onLogin={() => go('login')} />
			)}
			{step === 'login' && (
				<LoginStep
					busy={busy}
					error={errorMessage}
					onSubmit={submit}
					onBack={() => go('main')}
				/>
			)}
			{step === 'remember' && (
				<RememberStep
					phrase={phrase}
					busy={busy}
					error={errorMessage}
					onContinue={() => submit(phrase)}
					onBack={() => go('main')}
				/>
			)}
		</Modal>
	);
};

const MainStep: FC<{
	onPick: (mnemonic: string) => void;
	onLogin: () => void;
}> = ({ onPick, onLogin }) => {
	// A gallery of freshly generated identities to page through. Each index
	// mints one and SWR caches it, so stepping back and forth never redraws a
	// face already seen — only going to a new index makes a new one. This is
	// MainStep's own business; the parent just hears which one gets picked.
	const [index, setIndex] = useState(0);
	const draft = useSWR(`draft-identity-${index}`, generate, {
		revalidateOnFocus: false,
		revalidateOnReconnect: false,
		revalidateIfStale: false,
	});
	const address = draft.data?.address;

	return (
		<div className="flex flex-col items-center gap-6 text-center">
			<h3 className="text-2xl font-bold">Your identity</h3>
			<div className="flex items-center gap-3 w-full justify-between relative">
				<Button
					variant="outline"
					iconOnly
					size="md"
					onClick={() => setIndex((i) => i - 1)}
					aria-label="Previous identity"
					className="shrink-0"
				>
					❮
				</Button>
				<div className="flex size-full flex-col items-center justify-center">
					{draft.isLoading || !address ? (
						<Spinner size="lg" className="text-neutral-400" />
					) : (
						<Avatar address={address} className="size-60" />
					)}
				</div>
				<Button
					variant="outline"
					iconOnly
					size="md"
					onClick={() => setIndex((i) => i + 1)}
					aria-label="Next identity"
					className="shrink-0"
				>
					❯
				</Button>
			</div>
			<div className="mt-2 flex w-full gap-3">
				<Button
					variant="outline"
					type="button"
					className="grow"
					onClick={onLogin}
				>
					Sign-in instead
				</Button>
				<Button
					onClick={() => draft.data?.mnemonic && onPick(draft.data.mnemonic)}
					disabled={!address}
					className="grow"
				>
					Use this identity
				</Button>
			</div>
		</div>
	);
};

const loginSchema = z.object({
	mnemonic: z
		.string()
		.trim()
		.min(1, 'Enter your recovery phrase')
		.refine(isValidMnemonic, 'That doesn’t look like a valid recovery phrase.'),
});
type LoginForm = z.infer<typeof loginSchema>;

const LoginStep: FC<{
	busy: boolean;
	error: string | null;
	onSubmit: (mnemonic: string) => void;
	onBack: () => void;
}> = ({ busy, error, onSubmit, onBack }) => {
	const {
		register,
		handleSubmit,
		formState: { errors },
	} = useForm<LoginForm>({ resolver: zodResolver(loginSchema) });

	return (
		<form
			onSubmit={handleSubmit(({ mnemonic }) => onSubmit(mnemonic))}
			className="flex flex-col gap-4"
		>
			<h3 className="text-2xl font-bold">Enter your recovery phrase</h3>
			<p className="text-sm text-neutral-500">
				The 12 words you saved when you created your identity.
			</p>
			<textarea
				className="h-28 w-full rounded-lg border border-neutral-300 bg-white p-3 text-base outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500"
				placeholder="word1 word2 … word12"
				// biome-ignore lint/a11y/noAutofocus: the phrase field is the only input on this step
				autoFocus
				{...register('mnemonic')}
			/>
			{errors.mnemonic && (
				<p role="alert" className={ALERT}>
					{errors.mnemonic.message}
				</p>
			)}
			{error && (
				<p role="alert" className={ALERT}>
					{error}
				</p>
			)}
			<div className="mt-2 flex w-full gap-3">
				<Button
					variant="outline"
					className="grow"
					onClick={onBack}
					disabled={busy}
				>
					Back
				</Button>
				<Button type="submit" className="grow" disabled={busy}>
					{busy && <Spinner />}
					Login
				</Button>
			</div>
		</form>
	);
};

const RememberStep: FC<{
	phrase: string;
	busy: boolean;
	error: string | null;
	onContinue: () => void;
	onBack: () => void;
}> = ({ phrase, busy, error, onContinue, onBack }) => (
	<div className="flex flex-col gap-4">
		<h3 className="text-2xl font-bold">Save your recovery phrase</h3>
		<p className="text-sm text-neutral-500">
			These 12 words are the only way back into this account. Write them down
			and keep them somewhere safe.
		</p>
		<ol className="grid grid-cols-2 gap-2 sm:grid-cols-3">
			{phrase.split(' ').map((word, index) => (
				<li
					// biome-ignore lint/suspicious/noArrayIndexKey: fixed-order phrase, words may repeat, never reordered
					key={`${index}-${word}`}
					className="flex items-center gap-2 rounded-lg border border-neutral-300 px-3 py-2"
				>
					<span className="text-xs text-neutral-400 select-none">
						{(index + 1).toString().padStart(2, '0')}
					</span>
					<span className="font-medium">{word}</span>
				</li>
			))}
		</ol>
		{error && (
			<p role="alert" className={ALERT}>
				{error}
			</p>
		)}
		<div className="mt-2 flex w-full gap-3">
			<Button
				variant="outline"
				className="grow"
				onClick={onBack}
				disabled={busy}
			>
				Back
			</Button>
			<Button onClick={onContinue} className="grow" disabled={busy}>
				{busy && <Spinner />}Continue
			</Button>
		</div>
	</div>
);
