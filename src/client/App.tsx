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
import { randomId } from '@/shared/crypto';
import type { ClientMsg, ServerMsg } from '@/shared/protocol';
import type { ChatMessage } from '@/shared/types';
import { decryptFrom, encryptFor } from './chat';
import {
	existingPushSubscription,
	notificationPermission,
	pushSupported,
	requestNotificationPermission,
	subscribeToPush,
	unsubscribeFromPush,
} from './push';
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

type PushStatus =
	| 'idle'
	| 'subscribing'
	| 'subscribed'
	| 'unsubscribing'
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
	const [relayError, setRelayError] = useState<string | null>(null);

	// Push: the relay hands us its VAPID key on `ready` (null if push is off).
	const [vapidPublicKey, setVapidPublicKey] = useState<string | null>(null);
	// Notification permission is a per-origin browser setting — independent of
	// identity or connection, so it's tracked separately from the subscription.
	const [permission, setPermission] = useState(notificationPermission);
	const [pushStatus, setPushStatus] = useState<PushStatus>('idle');
	const [pushError, setPushError] = useState<string | null>(null);

	// Chat: one peer at a time, messages kept only in memory (no history).
	const [peerInput, setPeerInput] = useState('');
	const [peer, setPeer] = useState('');
	const [peerOnline, setPeerOnline] = useState<boolean | null>(null);
	const [draft, setDraft] = useState('');
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [chatError, setChatError] = useState<string | null>(null);
	// Ids already shown — delivery is at-least-once, so guard against redelivery.
	const seenIncoming = useRef<Set<string>>(new Set());

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
			setRelayError(null);
			setWsStatus('idle');
			setVapidPublicKey(null);
			setPushStatus('idle');
			setPushError(null);

			// Drop any chat state tied to the old identity.
			setPeerInput('');
			setPeer('');
			setPeerOnline(null);
			setDraft('');
			setMessages([]);
			setChatError(null);
			seenIncoming.current = new Set();

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

	const sendToRelay = useCallback((msg: ClientMsg): boolean => {
		const ws = wsRef.current;
		if (!ws || ws.readyState !== WebSocket.OPEN) return false;
		ws.send(JSON.stringify(msg));
		return true;
	}, []);

	// Route a frame from the relay. Held in a ref (below) so the live socket always
	// calls the newest version, closing over fresh `identity` / `peer`.
	const handleServerMsg = useCallback(
		(data: string) => {
			let msg: ServerMsg;
			try {
				msg = JSON.parse(data) as ServerMsg;
			} catch {
				return;
			}
			switch (msg.t) {
				case 'ready':
					// Bound and connected; queued messages (if any) arrive next.
					// The relay tells us here whether (and how) to subscribe for push.
					setVapidPublicKey(msg.vapidPublicKey ?? null);
					break;
				case 'presence':
					if (msg.address === peer) setPeerOnline(msg.online);
					break;
				case 'msg': {
					if (!identity) break;
					// Ack unconditionally so the relay drops its copy, even for a dup.
					sendToRelay({ t: 'ack', id: msg.id });
					if (seenIncoming.current.has(msg.id)) break;
					seenIncoming.current.add(msg.id);
					decryptFrom(identity, msg.from, msg.enc)
						.then((body) =>
							setMessages((prev) => [
								...prev,
								{
									id: msg.id,
									peer: msg.from,
									direction: 'in',
									body,
									at: Date.now(),
								},
							]),
						)
						.catch((error) =>
							setChatError(
								error instanceof Error ? error.message : String(error),
							),
						);
					break;
				}
				case 'error':
					setRelayError(`${msg.code}: ${msg.message}`);
					break;
				case 'kicked':
					setRelayError('Another device connected with this identity.');
					setWsStatus('closed');
					break;
			}
		},
		[identity, peer, sendToRelay],
	);

	const handleServerMsgRef = useRef(handleServerMsg);
	useEffect(() => {
		handleServerMsgRef.current = handleServerMsg;
	}, [handleServerMsg]);

	// Ask the relay whether the current peer is online whenever we (re)connect or
	// switch peers.
	useEffect(() => {
		if (wsStatus === 'connected' && peer !== '') {
			setPeerOnline(null);
			sendToRelay({ t: 'probe', address: peer });
		}
	}, [wsStatus, peer, sendToRelay]);

	const connect = useCallback(async () => {
		if (!identity) return;
		closeSocket();
		setRelayError(null);
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
			ws.onmessage = (event) => handleServerMsgRef.current(String(event.data));
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

	// Step 1 of 2: ask for notification permission. Separate from subscribing so
	// the two can be offered as distinct buttons — a user may hold permission
	// without this device being the active push target.
	const grantPermission = useCallback(async () => {
		setPushError(null);
		try {
			setPermission(await requestNotificationPermission());
		} catch (error) {
			setPushError(error instanceof Error ? error.message : String(error));
		}
	}, []);

	// Step 2 of 2: subscribe this device and register it with the relay.
	// Reusing the existing browser subscription makes this idempotent.
	const enablePush = useCallback(async () => {
		if (!vapidPublicKey) return;
		setPushError(null);
		setPushStatus('subscribing');
		try {
			const subscription = await subscribeToPush(vapidPublicKey);
			if (!sendToRelay({ t: 'push', subscription })) {
				throw new Error('Not connected to the relay.');
			}
			setPushStatus('subscribed');
		} catch (error) {
			setPushError(error instanceof Error ? error.message : String(error));
			setPushStatus('error');
		}
	}, [vapidPublicKey, sendToRelay]);

	// The reverse: drop the local subscription and tell the relay to forget
	// this device as the push target.
	const disablePush = useCallback(async () => {
		setPushError(null);
		setPushStatus('unsubscribing');
		try {
			await unsubscribeFromPush();
			if (!sendToRelay({ t: 'unpush' })) {
				throw new Error('Not connected to the relay.');
			}
			setPushStatus('idle');
		} catch (error) {
			setPushError(error instanceof Error ? error.message : String(error));
			setPushStatus('error');
		}
	}, [sendToRelay]);

	// Once connected, reflect whether this device already has a subscription —
	// and if so, reassert it with the relay (a fresh session may mean the relay
	// forgot the target, or another device took it over). This never creates a
	// new subscription or prompts for permission; that only ever happens via the
	// explicit buttons below.
	useEffect(() => {
		if (wsStatus !== 'connected' || !vapidPublicKey) return;
		let cancelled = false;
		void existingPushSubscription().then((subscription) => {
			if (cancelled) return;
			if (subscription) {
				sendToRelay({ t: 'push', subscription });
				setPushStatus('subscribed');
			} else {
				setPushStatus('idle');
			}
		});
		return () => {
			cancelled = true;
		};
	}, [wsStatus, vapidPublicKey, sendToRelay]);

	const openChat = useCallback(
		(event: FormEvent) => {
			event.preventDefault();
			setChatError(null);
			setPeer(peerInput.trim());
		},
		[peerInput],
	);

	const probePeer = useCallback(() => {
		if (peer === '') return;
		setPeerOnline(null);
		sendToRelay({ t: 'probe', address: peer });
	}, [peer, sendToRelay]);

	const sendChat = useCallback(
		async (event: FormEvent) => {
			event.preventDefault();
			if (!identity || peer === '' || draft.trim() === '') return;
			const body = draft;
			setChatError(null);
			try {
				const enc = await encryptFor(identity, peer, body);
				const id = randomId();
				if (!sendToRelay({ t: 'msg', to: peer, id, enc })) {
					throw new Error('Not connected to the relay.');
				}
				setMessages((prev) => [
					...prev,
					{ id, peer, direction: 'out', body, at: Date.now() },
				]);
				setDraft('');
			} catch (error) {
				setChatError(error instanceof Error ? error.message : String(error));
			}
		},
		[identity, peer, draft, sendToRelay],
	);

	const words = identity ? identity.mnemonic.split(' ') : [];
	const connecting = wsStatus === 'authenticating' || wsStatus === 'connecting';
	const conversation = messages.filter((message) => message.peer === peer);

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
				</dl>
				{relayError ? (
					<p role="alert">
						<strong>Relay error:</strong> {relayError}
					</p>
				) : null}
				{wsStatus === 'connected' ? (
					vapidPublicKey ? (
						pushSupported() ? (
							<div>
								<p>
									<button
										type="button"
										onClick={grantPermission}
										disabled={
											permission === 'granted' || permission === 'denied'
										}
									>
										{permission === 'granted'
											? 'Notification permission granted'
											: permission === 'denied'
												? 'Notification permission blocked'
												: 'Grant notification permission'}
									</button>
									{permission === 'denied' ? (
										<>
											{' '}
											<small>
												Blocked in browser settings; this page can't re-prompt.
											</small>
										</>
									) : null}
								</p>
								<p>
									<button
										type="button"
										onClick={
											pushStatus === 'subscribed' ? disablePush : enablePush
										}
										disabled={
											permission !== 'granted' ||
											pushStatus === 'subscribing' ||
											pushStatus === 'unsubscribing'
										}
									>
										{pushStatus === 'subscribed'
											? 'Unsubscribe this device'
											: pushStatus === 'subscribing'
												? 'Subscribing…'
												: pushStatus === 'unsubscribing'
													? 'Unsubscribing…'
													: 'Subscribe this device'}
									</button>{' '}
									<small>
										Whichever device last subscribed is notified about messages
										that arrive while it's offline.
									</small>
								</p>
							</div>
						) : (
							<p>
								<small>This browser can't show push notifications.</small>
							</p>
						)
					) : (
						<p>
							<small>Push notifications aren't configured on this relay.</small>
						</p>
					)
				) : null}
				{pushError ? (
					<p role="alert">
						<strong>Push error:</strong> {pushError}
					</p>
				) : null}
			</section>

			<hr />

			<section aria-labelledby="chat-heading">
				<h2 id="chat-heading">Chat</h2>
				{wsStatus === 'connected' ? (
					<>
						<form onSubmit={openChat}>
							<label htmlFor="peer-input">Peer address</label>
							<input
								id="peer-input"
								value={peerInput}
								onChange={(event) => setPeerInput(event.target.value)}
								placeholder="their address (public key)"
							/>
							<button type="submit" disabled={peerInput.trim() === ''}>
								Open chat
							</button>
						</form>

						{peer ? (
							<>
								<p>
									Chatting with <code>{peer}</code>{' '}
									<output>
										{peerOnline === null
											? '(checking…)'
											: peerOnline
												? '● online'
												: '○ offline'}
									</output>{' '}
									<button type="button" onClick={probePeer}>
										Refresh
									</button>
								</p>

								{conversation.length > 0 ? (
									<ol>
										{conversation.map((message) => (
											<li key={message.id}>
												<strong>
													{message.direction === 'out' ? 'You' : 'Them'}:
												</strong>{' '}
												{message.body}
											</li>
										))}
									</ol>
								) : (
									<p>
										<small>No messages yet.</small>
									</p>
								)}

								<form onSubmit={sendChat}>
									<label htmlFor="chat-input">Message</label>
									<input
										id="chat-input"
										value={draft}
										onChange={(event) => setDraft(event.target.value)}
										placeholder="Type a message"
									/>
									<button type="submit" disabled={draft.trim() === ''}>
										Send
									</button>
								</form>

								{chatError ? (
									<p role="alert">
										<strong>Chat error:</strong> {chatError}
									</p>
								) : null}
							</>
						) : (
							<p>Enter a peer's address to open a chat.</p>
						)}
					</>
				) : (
					<p>Connect to the relay above to start chatting.</p>
				)}
			</section>
		</main>
	);
}
