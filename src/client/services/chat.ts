/**
 * The chat service — everything about conversations and messages, including
 * their at-rest encryption.
 *
 * The UI only ever touches the *local database*: reading is a pair of live
 * queries ({@link useConversations}, {@link useMessages}) that re-render
 * whenever the database changes underneath them; writing
 * ({@link useSendMessage}) just drops rows in. Sending never awaits the
 * network — it enqueues a `pending` message and returns.
 *
 * Every field but `id`/`owner` is sealed with the owning identity's
 * local-storage key (`deriveLocalStorageKey`, self-ECDH — deterministic, so
 * the same identity always re-derives it, nothing extra to remember). That
 * key only exists while the identity's private key does, so a logged-out
 * database reveals neither who a user talked to nor what was said. Every
 * read/write here takes the full `Identity`, not just its address, because
 * decrypting needs the key pair.
 *
 * Conversations aren't stored — they're derived from messages, grouped by
 * peer. A chat you've opened but not yet sent a word in doesn't persist
 * across a reload; it only exists once a real message does.
 *
 * The *relay* half — the message endpoints (`sendMessage`, `readMessage`,
 * `streamMessages`) — lives in {@link file://./relay.ts}, and the UI never calls
 * it: the always-on {@link file://./sync.ts} service drives it, draining the
 * outbox to the relay and writing incoming messages straight back into the
 * database, so the screen only ever reflects the database.
 */

import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback } from 'react';
import type { Identity } from '@/shared/auth';
import { decrypt, deriveLocalStorageKey, encrypt } from '@/shared/crypto';
import { db, type EncryptedMessageRow, type StoredMessage } from '../db';
import { useAuth } from './auth';

/** A conversation plus the bits the list needs to render at a glance. */
export interface ConversationSummary {
	peer: string;
	/** The most recent message either way. */
	lastMessage: StoredMessage;
	/** Incoming messages not yet read. */
	unreadCount: number;
}

// --- local-storage crypto ---------------------------------------------------
// The key is stable for the life of an identity, so derive it once. Keyed by
// address rather than held as a single value so a stale reference can't leak
// across a login/logout/login cycle.

const localKeyCache = new Map<string, Promise<CryptoKey>>();

function localKey(identity: Identity): Promise<CryptoKey> {
	let key = localKeyCache.get(identity.address);
	if (!key) {
		key = deriveLocalStorageKey(identity.keyPair);
		localKeyCache.set(identity.address, key);
	}
	return key;
}

/** Drop cached local-storage keys. Call on logout so nothing decryptable
 * stays resident once the identity is gone. */
export function clearLocalKeyCache(): void {
	localKeyCache.clear();
}

async function encryptRow(identity: Identity, message: StoredMessage) {
	return encrypt(await localKey(identity), JSON.stringify(message));
}

async function decryptRow(
	identity: Identity,
	row: EncryptedMessageRow,
): Promise<StoredMessage> {
	return JSON.parse(
		await decrypt(await localKey(identity), row.payload),
	) as StoredMessage;
}

/** Decrypt every row belonging to `identity`. The only way to read a chat's
 * history, so it's also the only way to list conversations or filter to one
 * peer's messages — both just filter this in memory. */
async function loadOwnerMessages(identity: Identity): Promise<StoredMessage[]> {
	const rows = await db.messages
		.where('owner')
		.equals(identity.address)
		.toArray();
	return Promise.all(rows.map((row) => decryptRow(identity, row)));
}

// --- reads -------------------------------------------------------------

/** This identity's conversations, most recently active first, each carrying its
 * last message and unread count, live. `undefined` until the first read resolves
 * — so callers can tell "loading" from "none". */
export function useConversations(): ConversationSummary[] | undefined {
	const { identity } = useAuth();
	return useLiveQuery<ConversationSummary[]>(async () => {
		if (!identity) return [];
		const messages = await loadOwnerMessages(identity);
		const byPeer = new Map<string, StoredMessage[]>();
		for (const message of messages) {
			const forPeer = byPeer.get(message.peer);
			if (forPeer) forPeer.push(message);
			else byPeer.set(message.peer, [message]);
		}
		const summaries = [...byPeer.entries()].map(([peer, peerMessages]) => {
			const sorted = peerMessages.sort((a, b) => a.at - b.at);
			const unreadCount = peerMessages.filter(
				(message) => message.direction === 'in' && !message.read,
			).length;
			return { peer, lastMessage: sorted[sorted.length - 1], unreadCount };
		});
		// Freshest chat on top.
		return summaries.sort((a, b) => b.lastMessage.at - a.lastMessage.at);
	}, [identity]);
}

/** The conversation with `peer`, oldest message first, live. `undefined`
 * until the first read resolves — so callers can tell "loading" from "empty". */
export function useMessages(peer: string): StoredMessage[] | undefined {
	const { identity } = useAuth();
	return useLiveQuery<StoredMessage[]>(async () => {
		if (!identity) return [];
		const messages = await loadOwnerMessages(identity);
		return messages
			.filter((message) => message.peer === peer)
			.sort((a, b) => a.at - b.at);
	}, [identity, peer]);
}

// --- writes (shared with the sync service) ---------------------------------

/** Queue an outgoing message. It lands in the database immediately as `pending`;
 * the sync service sends it and flips it to `sent`. */
export async function enqueueOutgoing(
	identity: Identity,
	peer: string,
	body: string,
): Promise<void> {
	const message: StoredMessage = {
		id: crypto.randomUUID(),
		owner: identity.address,
		peer,
		direction: 'out',
		body,
		at: Date.now(),
		status: 'pending',
		read: true,
	};
	await db.messages.add({
		id: message.id,
		owner: message.owner,
		payload: await encryptRow(identity, message),
	});
}

/** Persist a decrypted incoming message, arriving unread. Idempotent on the
 * relay id, since delivery is at-least-once and the same message may arrive
 * twice: a redelivery is left untouched (never re-marked unread) and reported as
 * not-new. Resolves `true` only when the message was genuinely new. */
export async function saveIncoming(
	identity: Identity,
	incoming: Pick<StoredMessage, 'id' | 'peer' | 'body' | 'at'>,
): Promise<boolean> {
	if (await db.messages.get(incoming.id)) return false;
	const message: StoredMessage = {
		...incoming,
		owner: identity.address,
		direction: 'in',
		status: 'received',
		read: false,
	};
	await db.messages.add({
		id: message.id,
		owner: message.owner,
		payload: await encryptRow(identity, message),
	});
	return true;
}

/** This identity's outbox, oldest first: pending messages the sync service
 * still needs to send. */
export async function getPendingOutgoing(
	identity: Identity,
): Promise<StoredMessage[]> {
	const messages = await loadOwnerMessages(identity);
	return messages
		.filter((message) => message.status === 'pending')
		.sort((a, b) => a.at - b.at);
}

/** Flip an outgoing message to `sent` once the relay has accepted it. */
export async function markSent(identity: Identity, id: string): Promise<void> {
	const row = await db.messages.get(id);
	if (!row) return;
	const message = await decryptRow(identity, row);
	await db.messages.put({
		id: row.id,
		owner: row.owner,
		payload: await encryptRow(identity, { ...message, status: 'sent' }),
	});
}

/** Mark every unread incoming message from `peer` as read. */
export async function markConversationRead(
	identity: Identity,
	peer: string,
): Promise<void> {
	const rows = await db.messages
		.where('owner')
		.equals(identity.address)
		.toArray();
	await Promise.all(
		rows.map(async (row) => {
			const message = await decryptRow(identity, row);
			if (message.peer !== peer || message.direction !== 'in' || message.read) {
				return;
			}
			await db.messages.put({
				id: row.id,
				owner: row.owner,
				payload: await encryptRow(identity, { ...message, read: true }),
			});
		}),
	);
}

/** Send a message to `peer` — from the UI's side, just a write to the database.
 * The sync service takes it from there. */
export function useSendMessage(): (
	peer: string,
	body: string,
) => Promise<void> {
	const { identity } = useAuth();
	return useCallback(
		async (peer: string, body: string) => {
			if (!identity) throw new Error('Not signed in.');
			await enqueueOutgoing(identity, peer, body);
		},
		[identity],
	);
}

/** Clear the unread badge for a conversation — call it while the chat is open. */
export function useMarkConversationRead(): (peer: string) => Promise<void> {
	const { identity } = useAuth();
	return useCallback(
		async (peer: string) => {
			if (!identity) return;
			await markConversationRead(identity, peer);
		},
		[identity],
	);
}
