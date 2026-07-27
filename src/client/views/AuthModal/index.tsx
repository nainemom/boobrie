import { LoaderIcon } from 'lucide-react';
import { type FC, Suspense, use, useEffect, useState } from 'react';
import useSWRMutation from 'swr/mutation';
import { Modal } from '../../components/Modal';
import { generate, login, restore, useIdentity } from '../../services/auth';
import { ChooseStep } from './ChooseStep';
import { type AUTH_STEPS, apiErrorMessage } from './constants';
import { RememberStep } from './RememberStep';
import { SignInStep } from './SignInStep';
import { SignUpStep } from './SignUpStep';

export const AuthModal: FC = () => {
	const identity = useIdentity();
	const [step, setStep] = useState<(typeof AUTH_STEPS)[number]>('choose');
	const [phrase, setPhrase] = useState('');

	// The modal stays mounted across logins/logouts, so its step wouldn't
	// otherwise reset — jump back to the choose step whenever the user logs out.
	useEffect(() => {
		if (!identity) setStep('choose');
	}, [identity]);

	const {
		trigger,
		isMutating: busy,
		error,
		reset,
	} = useSWRMutation(
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

	const go = (next: (typeof AUTH_STEPS)[number]) => {
		reset();
		setStep(next);
	};

	const submit = (mnemonic?: string, handle?: string) =>
		trigger({ mnemonic, handle }, { throwOnError: false });

	const signUp = async (mnemonic: string, handle: string) => {
		await trigger({ mnemonic, handle }, { throwOnError: true });
		setPhrase(mnemonic);
		setStep('remember');
	};

	const errorMessage = error
		? apiErrorMessage(error, 'Something went wrong. Please try again.')
		: null;

	return (
		<Modal>
			<Suspense fallback={<AuthLoading />}>
				<RestoreSession />
				{step === 'choose' && (
					<ChooseStep
						busy={busy}
						error={errorMessage}
						onGoAnonymous={() => submit()}
						onSelect={go}
					/>
				)}
				{step === 'signup' && (
					<SignUpStep
						busy={busy}
						onSubmit={signUp}
						onBack={() => go('choose')}
					/>
				)}
				{step === 'signin' && (
					<SignInStep
						busy={busy}
						error={errorMessage}
						onSubmit={(mnemonic) => submit(mnemonic)}
						onBack={() => go('choose')}
					/>
				)}
				{step === 'remember' && (
					<RememberStep phrase={phrase} onDone={() => go('choose')} />
				)}
			</Suspense>
		</Modal>
	);
};

const RestoreSession: FC = () => {
	use(restore());
	return null;
};

const AuthLoading: FC = () => (
	<div className="flex flex-col items-center justify-center gap-2 h-32 font-medium">
		<LoaderIcon size={24} className="animate-spin" />
		Restoring Session...
	</div>
);
