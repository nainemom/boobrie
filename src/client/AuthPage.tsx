import { type FormEvent, use, useRef, useState } from 'react';
import { Redirect, useLocation } from 'wouter';
import type { Identity } from '@/shared/auth';
import { generate, login, restore, useToken } from './services/auth';
import { avatar } from './services/avatar';
import { signature } from './services/signature';

export function AuthPage() {
	use(restore());
	const [, navigate] = useLocation();
	const token = useToken();
	const dialogRef = useRef<HTMLDialogElement>(null);

	const [busy, setBusy] = useState(false);
	const [words, setWords] = useState('');
	const [loginError, setLoginError] = useState<string | null>(null);
	// A freshly generated identity being previewed, not yet committed.
	const [draft, setDraft] = useState<Identity | null>(null);
	const [draftError, setDraftError] = useState<string | null>(null);
	const [mnemonic, setMnemonic] = useState<string | null>(null);

	// Stay put while showing a fresh recovery phrase, even though we're already
	// logged in — the user must see it before we move on.
	if (token && !mnemonic) return <Redirect to="/conversations" />;

	const submitLogin = async (event: FormEvent) => {
		event.preventDefault();
		setBusy(true);
		setLoginError(null);
		try {
			await login({ mnemonic: words });
			dialogRef.current?.hidePopover();
			navigate('/conversations');
		} catch (error) {
			setLoginError(error instanceof Error ? error.message : String(error));
		} finally {
			setBusy(false);
		}
	};

	// Generate a fresh identity to preview. This never logs in — the session is
	// only set once the user accepts the signature below.
	const generateDraft = async () => {
		setBusy(true);
		setDraftError(null);
		try {
			setDraft(await generate());
		} finally {
			setBusy(false);
		}
	};

	const acceptDraft = async () => {
		if (!draft?.mnemonic) return;
		setBusy(true);
		setDraftError(null);
		try {
			await login({ mnemonic: draft.mnemonic });
			setMnemonic(draft.mnemonic);
			setDraft(null);
		} catch (error) {
			setDraftError(error instanceof Error ? error.message : String(error));
		} finally {
			setBusy(false);
		}
	};

	const justLetMeIn = async () => {
		setBusy(true);
		try {
			const fresh = await generate();
			if (!fresh.mnemonic) return;
			await login({ mnemonic: fresh.mnemonic });
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
			<button type="button" onClick={generateDraft} disabled={busy}>
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

			{draft && !mnemonic ? (
				<dialog open>
					{/* Signatures stroke in currentColor and carry no size of their own;
					    let them fill this card, height following the viewBox. */}
					<style>
						{
							'.signature svg, .avatar svg{display:block;width:100%;height:auto}'
						}
					</style>
					<style>{'.avatar svg{display:block;width:100%;height:auto}'}</style>
					<h2>This is your signature</h2>
					<p>
						Every account draws a unique mark from its key. This one is yours
						unless you regenerate for a different identity.
					</p>
					<div
						className="signature"
						style={{ maxWidth: 360, margin: '1rem 0' }}
						// biome-ignore lint/security/noDangerouslySetInnerHtml: self-generated SVG, no user-controlled markup
						dangerouslySetInnerHTML={{ __html: signature(draft.address) }}
					/>
					<div
						className="avatar"
						style={{ maxWidth: 360, margin: '1rem 0' }}
						// biome-ignore lint/security/noDangerouslySetInnerHtml: self-generated SVG, no user-controlled markup
						dangerouslySetInnerHTML={{ __html: avatar(draft.address) }}
					/>
					<button type="button" onClick={acceptDraft} disabled={busy}>
						Use this identity
					</button>
					<button type="button" onClick={generateDraft} disabled={busy}>
						Regenerate
					</button>
					<button type="button" onClick={() => setDraft(null)} disabled={busy}>
						Cancel
					</button>
					{draftError ? (
						<p role="alert">
							<strong>Could not sign in:</strong> {draftError}
						</p>
					) : null}
				</dialog>
			) : null}

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
