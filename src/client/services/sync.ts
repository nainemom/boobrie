/**
 * The always-on chat sync service — the one bridge between the local database
 * and the relay. It watches auth ({@link file://./auth.ts}) and, whenever a
 * session is up, keeps two flows running for the life of that session:
 *
 *   - inbound: the relay's message stream is decrypted and written straight to
 *     the database ({@link file://./chat.ts}), then acked so the relay drops
 *     its copy; undecryptable messages are dropped, never stored;
 *   - outbound: any message the UI queued (`status: 'pending'`) is encrypted,
 *     sent, and flipped to `sent` — in order, retried on failure and re-driven
 *     on reconnect.
 *
 * The UI never calls in here; it reads and writes the database and this service
 * reconciles it with the relay. Started once, at boot ({@link startSync}).
 */

import { liveQuery, type Subscription } from 'dexie';
import type { Identity } from '@/shared/auth';
import { decrypt, deriveConversationKey, encrypt } from '@/shared/crypto';
import { base58ToBytes } from '@/shared/encoding';
import type { Message } from '@/shared/protocol';
import type { EncryptedPayload } from '@/shared/types';
import { db } from '../db';
import { createExternalState, useExternalState } from '../utils/externalState';
import { createRetryingTask } from '../utils/retryingTask';
import { playDing } from '../utils/sound';
import { authState } from './auth';
import { getPendingOutgoing, markSent, saveIncoming } from './chat';
import {
	type MessageStream,
	readMessage,
	sendMessage,
	streamMessages,
} from './relay';

/** How long to wait before retrying the outbox after a send fails. */
const RETRY_MS = 5000;

// --- conversation crypto ----------------------------------------------------
// Keys are stable for the life of an (identity, peer) pair, so derive once. Only
// the sync service touches plaintext now, so encryption lives with it.

const keyCache = new Map<string, Promise<CryptoKey>>();

function conversationKey(identity: Identity, peer: string): Promise<CryptoKey> {
	const cacheKey = `${identity.address}|${peer}`;
	let key = keyCache.get(cacheKey);
	if (!key) {
		key = deriveConversationKey(
			identity.keyPair.privateKey,
			base58ToBytes(peer),
			identity.address,
			peer,
		);
		keyCache.set(cacheKey, key);
	}
	return key;
}

/** Encrypt a plaintext message for `peer`, ready to send as the relay's
 * `payload` string. */
async function encryptFor(
	identity: Identity,
	peer: string,
	message: string,
): Promise<string> {
	const payload = await encrypt(await conversationKey(identity, peer), message);
	return JSON.stringify(payload);
}

/** Decrypt a `payload` string that came from `peer`. Throws if it wasn't sealed
 * for this conversation (wrong peer, tampered ciphertext). */
async function decryptFrom(
	identity: Identity,
	peer: string,
	payload: string,
): Promise<string> {
	return decrypt(
		await conversationKey(identity, peer),
		JSON.parse(payload) as EncryptedPayload,
	);
}

// --- incoming-message ding --------------------------------------------------
// A short two-tone chime for messages that arrive while you're looking away.
// Synthesised with the Web Audio API so there's no audio asset to ship, and
// throttled so a burst (e.g. a backlog draining on reconnect) chimes just once.

/** The peer whose chat is on screen right now, parsed from the URL, or `null`. */
function currentConversationPeer(): string | null {
	const match = window.location.pathname.match(/^\/i\/([^/]+)/);
	return match ? decodeURIComponent(match[1]) : null;
}

/** Ding unless you're already watching this exact chat with the tab focused. */
function shouldAlert(sender: string): boolean {
	const watching = document.hasFocus() && currentConversationPeer() === sender;
	return !watching;
}

// --- the engine -------------------------------------------------------------

/** One live session with the relay: the identity driving it, the inbound
 * stream, and the outbox watcher. `engine` is `null` whenever no session is
 * up, so "is a session running" is a single check instead of several
 * variables that must be kept in sync by hand. */
interface Engine {
	identity: Identity;
	// Derived once from `identity.address`, so the many db queries below don't
	// have to spell it out — never mutated, so it can't drift from `identity`.
	owner: string;
	stream: MessageStream;
	outbox: Subscription;
}

let engine: Engine | null = null;

/** Tell the relay a message was received, so it drops its stored copy. */
function ack(id: string): void {
	readMessage(id).catch((error) =>
		console.error('Failed to ack message:', error),
	);
}

async function handleIncoming(message: Message): Promise<void> {
	const self = engine;
	if (!self) return;

	let body: string;
	try {
		body = await decryptFrom(self.identity, message.sender, message.payload);
	} catch (error) {
		// Not for us / tampered: drop it so the relay stops redelivering, but
		// never let it reach the database.
		console.error('Failed to decrypt incoming message; dropping:', error);
		ack(message.id);
		return;
	}

	try {
		const isNew = await saveIncoming(self.identity, {
			id: message.id,
			peer: message.sender,
			body,
			at: new Date(message.createdAt).getTime(),
		});
		ack(message.id);
		// Only a genuinely new message you aren't already looking at earns a ding.
		if (isNew && shouldAlert(message.sender)) playDing();
	} catch (_) {}
}

/** Send every pending message, in order, flipping each to `sent`. Throws on
 * the first failure and stops there — {@link flush} is what retries. */
async function attemptFlush(): Promise<void> {
	const self = engine;
	if (!self) return;
	const pending = await getPendingOutgoing(self.identity);
	for (const message of pending) {
		if (engine !== self) return; // session changed under us
		const payload = await encryptFor(self.identity, message.peer, message.body);
		await sendMessage({ recipient: message.peer, payload });
		await markSent(self.identity, message.id);
	}
}

/** Drains the outbox. A new send, a reconnect, and a retry can all ask for a
 * flush around the same time; {@link createRetryingTask} coalesces those into
 * one run at a time and keeps retrying a failed one on its own. */
const flush = createRetryingTask(attemptFlush, RETRY_MS);

const streamStatusStore = createExternalState<boolean>(false);

export const useSyncStatus = () => useExternalState(streamStatusStore);

// --- react to the auth service ---------------------------------------------

let started = false;

/** Start the background sync service. Call once, at app boot; idempotent. */
export const startSync = () => {
	if (started) return;
	started = true;

	/** Tear the engine down and return to a clean idle state. */
	const stop = () => {
		if (!engine) return;
		engine.stream.close();
		engine.outbox.unsubscribe();
		flush.stop();
		keyCache.clear();
		streamStatusStore.set(false);
		engine = null;
	};

	/** Bring the engine up for an identity: open the inbound stream and start
	 * watching the outbox. */
	const start = (identity: Identity) => {
		stop();
		const owner = identity.address;
		engine = {
			identity,
			owner,
			stream: streamMessages({
				// (Re)connected: push anything that queued while we were away.
				onOpen: () => {
					flush.trigger();
					streamStatusStore.set(true);
				},
				onMessage: (message) => void handleIncoming(message),
				onError: (error) => console.error('Message stream error:', error),
				onClose: () => {
					streamStatusStore.set(false);
				},
			}),
			// Re-run the outbox whenever this identity's messages change (a new
			// send, one we just marked sent, an incoming arrival, ...). Flushing is
			// cheap to no-op, so triggering on any change is simpler than tracking
			// pending-only — and the encrypted payload can't be filtered on status
			// without decrypting it anyway.
			outbox: liveQuery(() =>
				db.messages.where('owner').equals(owner).count(),
			).subscribe({
				next: () => flush.trigger(),
				error: (error) => console.error('Outbox watch failed:', error),
			}),
		};
	};

	const syncFromAuth = () => {
		const { identity, session } = authState.state;
		if (identity && session) {
			// Same identity already running: leave it alone. `identity` gets a new
			// object on every re-authentication (e.g. a token refresh after a
			// 401), so this compares the stable address rather than object
			// identity.
			if (engine?.owner === identity.address) return;
			start(identity);
		} else if (engine) {
			stop();
		}
	};

	authState.subscribe(syncFromAuth);
	// Pick up a session that auto-login may have restored before this ran.
	syncFromAuth();
};
