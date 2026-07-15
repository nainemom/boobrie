import {
	type FormEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from 'react';
import {
	createIdentity,
	decryptMessage,
	encryptMessage,
	type Identity,
	parseSealedBox,
	recoverIdentity,
	serializeSealedBox,
} from '@/shared/auth';
import { authenticate, type RelaySession, relayWsUrl } from './relay';

/** Where the relay lives. Set VITE_RELAY_URL in .env to point elsewhere. */
const RELAY_URL = import.meta.env.VITE_RELAY_URL ?? 'http://localhost:5200';

type WsStatus =
	| 'idle'
	| 'authenticating'
	| 'connecting'
	| 'connected'
	| 'closed'
	| 'error';

/**
 * A bare, unstyled playground for the key-pair auth system: create a pair, view
 * its recovery phrase, restore a pair from 12 words, round-trip a message
 * through public-key encrypt / private-key decrypt, and log in to the relay.
 * Semantic HTML only.
 */
export function App() {
	const [identity, setIdentity] = useState<Identity | null>(null);
	const [busy, setBusy] = useState(false);

	const [restoreInput, setRestoreInput] = useState('');
	const [restoreError, setRestoreError] = useState<string | null>(null);

	const [plaintext, setPlaintext] = useState('');
	const [ciphertext, setCiphertext] = useState('');
	const [encryptError, setEncryptError] = useState<string | null>(null);

	const [sealedInput, setSealedInput] = useState('');
	const [decrypted, setDecrypted] = useState('');
	const [decryptError, setDecryptError] = useState<string | null>(null);

	const wsRef = useRef<WebSocket | null>(null);
	const [wsStatus, setWsStatus] = useState<WsStatus>('idle');
	const [session, setSession] = useState<RelaySession | null>(null);
	const [serverMsg, setServerMsg] = useState<string | null>(null);
	const [relayError, setRelayError] = useState<string | null>(null);

	const closeSocket = useCallback(() => {
		const ws = wsRef.current;
		if (!ws) return;
		// Detach handlers first so an intentional close doesn't flip our status.
		ws.onopen = null;
		ws.onmessage = null;
		ws.onclose = null;
		ws.onerror = null;
		ws.close();
		wsRef.current = null;
	}, []);

	// Close the socket if the component goes away.
	useEffect(() => closeSocket, [closeSocket]);

	const adopt = useCallback(
		(next: Identity) => {
			// A new pair means the old session no longer applies.
			closeSocket();
			setSession(null);
			setServerMsg(null);
			setRelayError(null);
			setWsStatus('idle');

			setIdentity(next);
			setRestoreError(null);
			setPlaintext('');
			setCiphertext('');
			setEncryptError(null);
			setSealedInput('');
			setDecrypted('');
			setDecryptError(null);
		},
		[closeSocket],
	);

	const generate = useCallback(async () => {
		setBusy(true);
		try {
			adopt(await createIdentity());
		} finally {
			setBusy(false);
		}
	}, [adopt]);

	const restore = useCallback(
		async (event: FormEvent) => {
			event.preventDefault();
			setBusy(true);
			setRestoreError(null);
			try {
				adopt(await recoverIdentity(restoreInput));
			} catch (error) {
				setRestoreError(error instanceof Error ? error.message : String(error));
			} finally {
				setBusy(false);
			}
		},
		[adopt, restoreInput],
	);

	const encrypt = useCallback(
		async (event: FormEvent) => {
			event.preventDefault();
			if (!identity) return;
			setEncryptError(null);
			try {
				const box = await encryptMessage(identity.address, plaintext);
				setCiphertext(serializeSealedBox(box));
			} catch (error) {
				setEncryptError(error instanceof Error ? error.message : String(error));
			}
		},
		[identity, plaintext],
	);

	const decrypt = useCallback(
		async (event: FormEvent) => {
			event.preventDefault();
			if (!identity) return;
			setDecryptError(null);
			try {
				const message = await decryptMessage(
					identity,
					parseSealedBox(sealedInput),
				);
				setDecrypted(message);
			} catch (error) {
				setDecryptError(error instanceof Error ? error.message : String(error));
			}
		},
		[identity, sealedInput],
	);

	const connect = useCallback(async () => {
		if (!identity) return;
		closeSocket();
		setRelayError(null);
		setServerMsg(null);
		setWsStatus('authenticating');
		try {
			// 1. Prove key ownership over HTTP and get a session token.
			const next = await authenticate(RELAY_URL, identity);
			setSession(next);
			// 2. Open the token-gated socket. A rejected token never fires `open`.
			setWsStatus('connecting');
			const ws = new WebSocket(relayWsUrl(RELAY_URL, next.token));
			wsRef.current = ws;
			ws.onopen = () => setWsStatus('connected');
			ws.onmessage = (event) => setServerMsg(String(event.data));
			ws.onclose = () => setWsStatus('closed');
			ws.onerror = () => {
				setRelayError('WebSocket refused the connection (token rejected?).');
				setWsStatus('error');
			};
		} catch (error) {
			setRelayError(error instanceof Error ? error.message : String(error));
			setWsStatus('error');
		}
	}, [identity, closeSocket]);

	const disconnect = useCallback(() => {
		closeSocket();
		setWsStatus('closed');
	}, [closeSocket]);

	const words = identity ? identity.mnemonic.split(' ') : [];
	const connecting = wsStatus === 'authenticating' || wsStatus === 'connecting';

	return (
		<main>
			<header>
				<h1>boobrie — key-pair auth</h1>
				<p>
					A key pair is backed by a 12-word recovery phrase. The phrase
					reproduces the pair on any device; the pair's public key is its
					address.
				</p>
			</header>

			<section aria-labelledby="pair-heading">
				<h2 id="pair-heading">Your pair</h2>
				<button type="button" onClick={generate} disabled={busy}>
					{identity ? 'Generate a new pair' : 'Generate a pair'}
				</button>

				{identity ? (
					<>
						<dl>
							<dt>Address (public key)</dt>
							<dd>
								<code>{identity.address}</code>
							</dd>
						</dl>

						<h3>Recovery phrase (12 words)</h3>
						<p>
							<small>
								Anyone with these words controls this pair. Back them up; never
								share them.
							</small>
						</p>
						<ol>
							{words.map((word, index) => (
								// Fixed-order phrase, replaced wholesale on regenerate and never
								// reordered, and words may repeat — so position is the stable key.
								// biome-ignore lint/suspicious/noArrayIndexKey: see above
								<li key={`${index}-${word}`}>
									<code>{word}</code>
								</li>
							))}
						</ol>
					</>
				) : (
					<p>No pair yet. Generate one, or restore one below.</p>
				)}
			</section>

			<hr />

			<section aria-labelledby="restore-heading">
				<h2 id="restore-heading">Restore a pair from 12 words</h2>
				<form onSubmit={restore}>
					<label htmlFor="restore-input">Recovery phrase</label>
					<textarea
						id="restore-input"
						name="mnemonic"
						rows={3}
						value={restoreInput}
						onChange={(event) => setRestoreInput(event.target.value)}
						placeholder="word1 word2 … word12"
					/>
					<button type="submit" disabled={busy || restoreInput.trim() === ''}>
						Restore pair
					</button>
				</form>
				{restoreError ? (
					<p role="alert">
						<strong>Could not restore:</strong> {restoreError}
					</p>
				) : null}
			</section>

			<hr />

			<section aria-labelledby="encrypt-heading">
				<h2 id="encrypt-heading">Encrypt a message</h2>
				<p>
					Sealed to this pair's public key. Only its private key can open it.
				</p>
				<form onSubmit={encrypt}>
					<label htmlFor="plaintext-input">Message</label>
					<textarea
						id="plaintext-input"
						rows={3}
						value={plaintext}
						onChange={(event) => setPlaintext(event.target.value)}
						placeholder="Something to encrypt"
					/>
					<button type="submit" disabled={!identity || plaintext === ''}>
						Encrypt with public key
					</button>
				</form>
				{encryptError ? (
					<p role="alert">
						<strong>Could not encrypt:</strong> {encryptError}
					</p>
				) : null}
				{ciphertext ? (
					<figure>
						<figcaption>Sealed box</figcaption>
						<output>
							<pre>{ciphertext}</pre>
						</output>
					</figure>
				) : null}
			</section>

			<hr />

			<section aria-labelledby="decrypt-heading">
				<h2 id="decrypt-heading">Decrypt a message</h2>
				<p>Opened with this pair's private key.</p>
				<form onSubmit={decrypt}>
					<label htmlFor="sealed-input">Sealed box</label>
					<textarea
						id="sealed-input"
						rows={4}
						value={sealedInput}
						onChange={(event) => setSealedInput(event.target.value)}
						placeholder='{"epk":"…","iv":"…","ct":"…"}'
					/>
					<button
						type="submit"
						disabled={!identity || sealedInput.trim() === ''}
					>
						Decrypt with private key
					</button>
				</form>
				{decryptError ? (
					<p role="alert">
						<strong>Could not decrypt:</strong> {decryptError}
					</p>
				) : null}
				{decrypted ? (
					<figure>
						<figcaption>Decrypted message</figcaption>
						<output>
							<pre>{decrypted}</pre>
						</output>
					</figure>
				) : null}
			</section>

			<hr />

			<section aria-labelledby="relay-heading">
				<h2 id="relay-heading">Connect to relay</h2>
				<p>
					First the app proves it holds the private key over HTTP; then the
					WebSocket opens only if the relay accepts the session token. No key,
					no socket.
				</p>
				<p>
					Relay: <code>{RELAY_URL}</code>
				</p>
				<button
					type="button"
					onClick={connect}
					disabled={!identity || connecting}
				>
					{wsStatus === 'connected' ? 'Reconnect' : 'Connect to relay'}
				</button>{' '}
				<button
					type="button"
					onClick={disconnect}
					disabled={wsStatus !== 'connected'}
				>
					Disconnect
				</button>
				<dl>
					<dt>Status</dt>
					<dd>
						<output>{wsStatus}</output>
					</dd>
					{session ? (
						<>
							<dt>Session token</dt>
							<dd>
								<code>{session.token.slice(0, 32)}…</code>
							</dd>
							<dt>Expires</dt>
							<dd>{new Date(session.expiresAt).toLocaleTimeString()}</dd>
						</>
					) : null}
					{serverMsg ? (
						<>
							<dt>Relay said</dt>
							<dd>
								<output>
									<code>{serverMsg}</code>
								</output>
							</dd>
						</>
					) : null}
				</dl>
				{relayError ? (
					<p role="alert">
						<strong>Relay error:</strong> {relayError}
					</p>
				) : null}
			</section>
		</main>
	);
}
