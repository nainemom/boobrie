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
 * Both flows run in one tab only, however many are open — see "one engine per
 * browser, not per tab" below — because the database they reconcile is shared
 * and a second copy of them would send everything twice.
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
import { authState, relinquish } from './auth';
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

// --- one engine per browser, not per tab ------------------------------------
// Tabs share one database, so each one's outbox watcher sees every other one's
// pending message and they would all send it — the relay mints a fresh id per
// POST, so the recipient cannot tell the copies apart.
//
// So one tab runs the engine: whichever holds a Web Lock named for the identity.
// A lock because the browser releases it when the tab closes *or* crashes. The
// others need nothing, since Dexie carries a write in one tab to the live
// queries in all of them — except whether the stream is up, which only the
// leader knows, so that goes in `localStorage` for them to read.

/** Keyed by address so two identities never contend: they share a test process,
 * if not a browser. */
const coordinationKey = (owner: string) => `boobrie-sync-${owner}`;

/** The leader's stream state, as the other tabs see it. Guarded because storage
 * can be turned off, and an icon is not worth failing a sign-in over. */
function readStatus(owner: string): boolean {
	try {
		return localStorage.getItem(coordinationKey(owner)) === '1';
	} catch (_) {
		return false;
	}
}

/** `null` takes the flag away: nobody here is connected as this identity. */
function writeStatus(owner: string, connected: boolean | null): void {
	try {
		const key = coordinationKey(owner);
		if (connected === null) localStorage.removeItem(key);
		else localStorage.setItem(key, connected ? '1' : '0');
	} catch (_) {}
}

/** Where there is one: a DOM standing in for a browser may not have it. Then a
 * tab leads straight away — safe, because the same secure context gates
 * `crypto.subtle`, so such an origin cannot run this app at all. */
const lockManager = globalThis.navigator?.locks as LockManager | undefined;

// --- the engine -------------------------------------------------------------

/** What the leading tab owns: the inbound stream, and the outbox watcher. */
interface Engine {
	stream: MessageStream;
	outbox: Subscription;
}

/** What this tab is doing about the signed-in identity. `null` means nobody is
 * signed in; `engine` means this is the tab doing the work. */
interface Tab {
	identity: Identity;
	/** `identity.address`, derived once for the db queries below. */
	owner: string;
	/** Withdraws a lock request still queued behind another tab. */
	withdraw: AbortController;
	/** Gives the lock back. `null` until it has been granted. */
	resign: (() => void) | null;
	engine: Engine | null;
}

let tab: Tab | null = null;

/** Tell the relay a message was received, so it drops its stored copy. */
function ack(id: string): void {
	readMessage(id).catch((error) =>
		console.error('Failed to ack message:', error),
	);
}

async function handleIncoming(message: Message): Promise<void> {
	const self = tab;
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
	const self = tab;
	// Not the leading tab: its pending messages are the leader's to send, and
	// sending them here is exactly the duplicate this is all in aid of.
	if (!self?.engine) return;
	const pending = await getPendingOutgoing(self.identity);
	for (const message of pending) {
		// Signed out under us.
		if (tab !== self) return;
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

/** Only the leader calls this, because only the leader knows. */
function reportStatus(connected: boolean): void {
	streamStatusStore.set(connected);
	if (tab) writeStatus(tab.owner, connected);
}

/** Open the inbound stream. Only the leading tab does this. */
function openStream(): MessageStream {
	return streamMessages({
		// (Re)connected: push anything that queued while we were away.
		onOpen: () => {
			flush.trigger();
			reportStatus(true);
		},
		onMessage: (message) => void handleIncoming(message),
		onError: (error) => console.error('Message stream error:', error),
		onClose: () => reportStatus(false),
		// Signed in on another device. Anything still in the outbox stays there: the
		// relay refuses every write from a device it no longer recognises.
		onDisplaced: () => {
			// The last thing that ever runs for this session, so whatever goes wrong,
			// the session still goes.
			void relinquish().catch((error) => {
				console.error('Failed to sign out after being displaced:', error);
				authState.set({ identity: null, session: null });
			});
		},
	});
}

// --- react to the auth service ---------------------------------------------

let started = false;

/** Start the background sync service. Call once, at app boot; idempotent. */
export const startSync = () => {
	if (started) return;
	started = true;

	// The leader's flag arriving in the other tabs; never in the one that wrote it.
	window.addEventListener('storage', (event) => {
		const self = tab;
		if (!self || self.engine) return;
		if (event.key !== coordinationKey(self.owner)) return;
		streamStatusStore.set(event.newValue === '1');
	});

	/** Hand back the lock, tear any engine down, return to idle. */
	const stop = () => {
		const self = tab;
		if (!self) return;
		tab = null;
		// Both: withdrawing does nothing once granted, resigning nothing until.
		self.withdraw.abort();
		self.resign?.();
		if (self.engine) {
			// The leader's to clear: a follower doing it would blank a flag the
			// leader is still keeping true.
			writeStatus(self.owner, null);
			self.engine.stream.close();
			self.engine.outbox.unsubscribe();
			self.engine = null;
			flush.stop();
		}
		keyCache.clear();
		streamStatusStore.set(false);
	};

	/** Take up the work and hold the lock until {@link stop} resigns — the promise
	 * returned here *is* the lock's tenure, so it must not settle before then. */
	const lead = (self: Tab) =>
		new Promise<void>((resign) => {
			// Signed out while this was queued behind another tab: take the lock and
			// give it straight back.
			if (tab !== self) {
				resign();
				return;
			}
			self.resign = resign;
			// Not connected yet, and the flag may hold what a crashed leader left.
			reportStatus(false);
			self.engine = {
				stream: openStream(),
				// Any change, from any tab: flushing is cheap to no-op, and `status`
				// lives inside the encrypted payload so there is nothing to filter on.
				outbox: liveQuery(() =>
					db.messages.where('owner').equals(self.owner).count(),
				).subscribe({
					next: () => flush.trigger(),
					error: (error) => console.error('Outbox watch failed:', error),
				}),
			};
		});

	/** Join the session for an identity, and stand in line to lead it. */
	const start = (identity: Identity) => {
		stop();
		const self: Tab = {
			identity,
			owner: identity.address,
			withdraw: new AbortController(),
			resign: null,
			engine: null,
		};
		tab = self;

		// Read rather than waited for: the next change may be a long way off.
		streamStatusStore.set(readStatus(self.owner));

		if (!lockManager) {
			void lead(self);
			return;
		}
		lockManager
			.request(
				coordinationKey(self.owner),
				{ signal: self.withdraw.signal },
				() => lead(self),
			)
			.catch((error) => {
				// Withdrawing is how a follower's wait ordinarily ends, on sign-out.
				if (self.withdraw.signal.aborted) return;
				console.error('Sync leadership failed:', error);
			});
	};

	const syncFromAuth = () => {
		const { identity, session } = authState.state;
		if (identity && session) {
			// By address, because re-authenticating hands back a new `identity`.
			if (tab?.owner === identity.address) return;
			start(identity);
		} else if (tab) {
			stop();
		}
	};

	authState.subscribe(syncFromAuth);
	// Pick up a session that auto-login may have restored before this ran.
	syncFromAuth();
};
