import { type FormEvent, useRef, useState } from 'react';
import { Redirect, useLocation } from 'wouter';
import { loginWithMnemonic, loginWithNewIdentity, useStore } from './store';

export function AuthPage() {
	const store = useStore();
	const [, navigate] = useLocation();
	const dialogRef = useRef<HTMLDialogElement>(null);

	const [busy, setBusy] = useState(false);
	const [words, setWords] = useState('');
	const [loginError, setLoginError] = useState<string | null>(null);
	const [mnemonic, setMnemonic] = useState<string | null>(null);

	if (store.identity && store.session) return <Redirect to="/conversations" />;

	const submitLogin = async (event: FormEvent) => {
		event.preventDefault();
		setBusy(true);
		setLoginError(null);
		try {
			await loginWithMnemonic(words);
			dialogRef.current?.hidePopover();
			navigate('/conversations');
		} catch (error) {
			setLoginError(error instanceof Error ? error.message : String(error));
		} finally {
			setBusy(false);
		}
	};

	const createAccount = async () => {
		setBusy(true);
		try {
			const identity = await loginWithNewIdentity();
			setMnemonic(identity.mnemonic);
		} finally {
			setBusy(false);
		}
	};

	const justLetMeIn = async () => {
		setBusy(true);
		try {
			await loginWithNewIdentity();
			navigate('/conversations');
		} finally {
			setBusy(false);
		}
	};

	return (
		<main>
			<button type="button" popoverTarget="login-dialog" disabled={busy}>
				Login
			</button>
			<button type="button" onClick={createAccount} disabled={busy}>
				Create new account
			</button>
			<button type="button" onClick={justLetMeIn} disabled={busy}>
				Just let me in
			</button>

			<dialog id="login-dialog" popover="auto" ref={dialogRef}>
				<h2>Login</h2>
				<form onSubmit={submitLogin}>
					<div>
						<label htmlFor="words">12 Words</label>
						<textarea
							placeholder="word1 word2 … word12"
							id="words"
							value={words}
							onChange={(event) => setWords(event.target.value)}
						/>
					</div>
					<button type="submit" disabled={busy || words.trim() === ''}>
						Login
					</button>
					<button
						type="button"
						popoverTarget="login-dialog"
						popoverTargetAction="hide"
					>
						Close
					</button>
				</form>
				{loginError ? (
					<p role="alert">
						<strong>Could not log in:</strong> {loginError}
					</p>
				) : null}
			</dialog>

			{mnemonic ? (
				<dialog open>
					<h2>Save your recovery phrase</h2>
					<p>These 12 words are the only way back into this account.</p>
					<ol>
						{mnemonic.split(' ').map((word, index) => (
							// Fixed-order phrase, words may repeat, never reordered.
							// biome-ignore lint/suspicious/noArrayIndexKey: see above
							<li key={`${index}-${word}`}>{word}</li>
						))}
					</ol>
					<button type="button" onClick={() => navigate('/conversations')}>
						I saved it, continue
					</button>
				</dialog>
			) : null}
		</main>
	);
}
