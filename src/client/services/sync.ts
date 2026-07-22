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
import { playDing } from '../utils/sound';
import {
	getIdentity,
	getSession,
	type RelaySession,
	subscribe as subscribeAuth,
} from './auth';
import { saveIncoming } from './chat';
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

let currentIdentity: Identity | null = null;
let currentToken: string | null = null;
let currentOwner: string | null = null;
let stream: MessageStream | null = null;
let outbox: Subscription | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
// A flush is single-flight; overlapping triggers coalesce into one re-run.
let flushing = false;
let flushAgain = false;

/** Tell the relay a message was received, so it drops its stored copy. */
function ack(id: string): void {
	readMessage(id).catch((error) =>
		console.error('Failed to ack message:', error),
	);
}

async function handleIncoming(message: Message): Promise<void> {
	const identity = currentIdentity;
	const token = currentToken;
	const owner = currentOwner;
	if (!identity || !token || !owner) return;

	let body: string;
	try {
		body = await decryptFrom(identity, message.sender, message.payload);
	} catch (error) {
		// Not for us / tampered: drop it so the relay stops redelivering, but
		// never let it reach the database.
		console.error('Failed to decrypt incoming message; dropping:', error);
		ack(message.id);
		return;
	}

	try {
		const isNew = await saveIncoming(owner, {
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

/** Drain the outbox: send every pending message, in order, flipping each to
 * `sent`. Stops at the first failure and schedules a retry, so ordering holds. */
async function flushOutbox(): Promise<void> {
	const identity = currentIdentity;
	const token = currentToken;
	const owner = currentOwner;
	if (!identity || !token || !owner) return;
	if (flushing) {
		flushAgain = true;
		return;
	}
	flushing = true;
	try {
		const pending = await db.messages
			.where('[owner+status]')
			.equals([owner, 'pending'])
			.sortBy('at');
		for (const message of pending) {
			if (currentToken !== token) break; // session changed under us
			try {
				const payload = await encryptFor(identity, message.peer, message.body);
				await sendMessage({ recipient: message.peer, payload });
				await db.messages.update(message.id, { status: 'sent' });
			} catch (error) {
				console.error('Failed to send message; will retry:', error);
				scheduleRetry();
				break;
			}
		}
	} finally {
		flushing = false;
		if (flushAgain) {
			flushAgain = false;
			void flushOutbox();
		}
	}
}

function scheduleRetry(): void {
	if (retryTimer) return;
	retryTimer = setTimeout(() => {
		retryTimer = null;
		void flushOutbox();
	}, RETRY_MS);
}

/** Bring the engine up for a session: open the inbound stream and start
 * watching the outbox. */
function start(identity: Identity, session: RelaySession): void {
	stop();
	currentIdentity = identity;
	currentToken = session.token;
	currentOwner = identity.address;
	const owner = identity.address;

	stream = streamMessages({
		// (Re)connected: push anything that queued while we were away.
		onOpen: () => void flushOutbox(),
		onMessage: (message) => void handleIncoming(message),
		onError: (error) => console.error('Message stream error:', error),
	});

	// Re-run the outbox whenever the set of pending messages changes (a new send,
	// or one we just marked sent).
	outbox = liveQuery(() =>
		db.messages.where('[owner+status]').equals([owner, 'pending']).count(),
	).subscribe({
		next: () => void flushOutbox(),
		error: (error) => console.error('Outbox watch failed:', error),
	});
}

/** Tear the engine down and return to a clean idle state. */
function stop(): void {
	stream?.close();
	stream = null;
	outbox?.unsubscribe();
	outbox = null;
	if (retryTimer) {
		clearTimeout(retryTimer);
		retryTimer = null;
	}
	flushing = false;
	flushAgain = false;
	keyCache.clear();
	currentIdentity = null;
	currentToken = null;
	currentOwner = null;
}

// --- react to the auth service ---------------------------------------------

// The token we last brought the engine up for — so a new session reconnects but
// repeat notifications for the same one are ignored.
let connectedToken: string | null = null;

function syncFromAuth(): void {
	const identity = getIdentity();
	const session = getSession();
	if (identity && session) {
		if (session.token === connectedToken) return;
		connectedToken = session.token;
		start(identity, session);
	} else if (connectedToken !== null) {
		connectedToken = null;
		stop();
	}
}

let started = false;

/** Start the background sync service. Call once, at app boot; idempotent. */
export function startSync(): void {
	if (started) return;
	started = true;
	subscribeAuth(syncFromAuth);
	// Pick up a session that auto-login may have restored before this ran.
	syncFromAuth();
}
