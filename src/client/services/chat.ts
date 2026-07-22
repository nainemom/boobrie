/**
 * The chat service — everything about conversations and messages.
 *
 * The UI only ever touches the *local database*: reading is a pair of live
 * queries ({@link useConversations}, {@link useMessages}) that re-render
 * whenever the database changes underneath them; writing
 * ({@link useCreateConversation}, {@link useSendMessage}) just drops rows in.
 * Sending never awaits the network — it enqueues a `pending` message and returns.
 *
 * The *relay* half — the message endpoints (`sendMessage`, `readMessage`,
 * `streamMessages`) — lives in {@link file://./relay.ts}, and the UI never calls
 * it: the always-on {@link file://./sync.ts} service drives it, draining the
 * outbox to the relay and writing incoming messages straight back into the
 * database, so the screen only ever reflects the database.
 */

import Dexie from 'dexie';
import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback } from 'react';
import { db, type StoredConversation, type StoredMessage } from '../db';
import { useIdentity } from './auth';

/** A conversation plus the bits the list needs to render at a glance. */
export interface ConversationSummary extends StoredConversation {
	/** The most recent message either way, or `undefined` if none yet. */
	lastMessage: StoredMessage | undefined;
	/** Incoming messages not yet read. */
	unreadCount: number;
}

/** This identity's conversations, most recently active first, each carrying its
 * last message and unread count, live. `undefined` until the first read resolves
 * — so callers can tell "loading" from "none". */
export function useConversations(): ConversationSummary[] | undefined {
	const owner = useIdentity()?.address ?? null;
	return useLiveQuery<ConversationSummary[]>(async () => {
		if (!owner) return [];
		const conversations = await db.conversations
			.where('owner')
			.equals(owner)
			.toArray();
		const summaries = await Promise.all(
			conversations.map(async (conversation) => {
				const lastMessage = await db.messages
					.where('[owner+peer+at]')
					.between(
						[owner, conversation.peer, Dexie.minKey],
						[owner, conversation.peer, Dexie.maxKey],
					)
					.last();
				const unreadCount = await db.messages
					.where('[owner+peer]')
					.equals([owner, conversation.peer])
					.filter((message) => message.direction === 'in' && !message.read)
					.count();
				return { ...conversation, lastMessage, unreadCount };
			}),
		);
		// Freshest chat on top; one with no messages yet falls back to its
		// creation time.
		return summaries.sort(
			(a, b) =>
				(b.lastMessage?.at ?? b.createdAt) - (a.lastMessage?.at ?? a.createdAt),
		);
	}, [owner]);
}

/** The conversation with `address`, oldest message first, live. `undefined`
 * until the first read resolves — so callers can tell "loading" from "empty". */
export function useMessages(address: string): StoredMessage[] | undefined {
	const owner = useIdentity()?.address ?? null;
	return useLiveQuery<StoredMessage[]>(
		() =>
			owner
				? db.messages
						.where('[owner+peer]')
						.equals([owner, address])
						.sortBy('at')
				: [],
		[owner, address],
	);
}

// --- writes (shared with the sync service) ---------------------------------

/** Ensure a conversation row exists for `peer`, leaving an existing one (and its
 * original creation time) untouched. */
export async function ensureConversation(
	owner: string,
	peer: string,
): Promise<void> {
	if (await db.conversations.get([owner, peer])) return;
	await db.conversations.put({ owner, peer, createdAt: Date.now() });
}

/** Queue an outgoing message. It lands in the database immediately as `pending`;
 * the sync service sends it and flips it to `sent`. */
export async function enqueueOutgoing(
	owner: string,
	peer: string,
	body: string,
): Promise<void> {
	await db.transaction('rw', db.conversations, db.messages, async () => {
		await ensureConversation(owner, peer);
		await db.messages.add({
			id: crypto.randomUUID(),
			owner,
			peer,
			direction: 'out',
			body,
			at: Date.now(),
			status: 'pending',
			read: true,
		});
	});
}

/** Persist a decrypted incoming message, arriving unread. Idempotent on the
 * relay id, since delivery is at-least-once and the same message may arrive
 * twice: a redelivery is left untouched (never re-marked unread) and reported as
 * not-new. Resolves `true` only when the message was genuinely new. */
export async function saveIncoming(
	owner: string,
	message: Pick<StoredMessage, 'id' | 'peer' | 'body' | 'at'>,
): Promise<boolean> {
	return db.transaction('rw', db.conversations, db.messages, async () => {
		await ensureConversation(owner, message.peer);
		if (await db.messages.get(message.id)) return false;
		await db.messages.add({
			id: message.id,
			owner,
			peer: message.peer,
			direction: 'in',
			body: message.body,
			at: message.at,
			status: 'received',
			read: false,
		});
		return true;
	});
}

/** Open (or surface) a conversation with `peer`, for the current identity. */
export function useCreateConversation(): (peer: string) => Promise<void> {
	const owner = useIdentity()?.address ?? null;
	return useCallback(
		async (peer: string) => {
			if (!owner) throw new Error('Not signed in.');
			await ensureConversation(owner, peer);
		},
		[owner],
	);
}

/** Send a message to `peer` — from the UI's side, just a write to the database.
 * The sync service takes it from there. */
export function useSendMessage(): (
	peer: string,
	body: string,
) => Promise<void> {
	const owner = useIdentity()?.address ?? null;
	return useCallback(
		async (peer: string, body: string) => {
			if (!owner) throw new Error('Not signed in.');
			await enqueueOutgoing(owner, peer, body);
		},
		[owner],
	);
}

/** Mark every unread incoming message from `peer` as read. */
export async function markConversationRead(
	owner: string,
	peer: string,
): Promise<void> {
	await db.messages
		.where('[owner+peer]')
		.equals([owner, peer])
		.filter((message) => message.direction === 'in' && !message.read)
		.modify({ read: true });
}

/** Clear the unread badge for a conversation — call it while the chat is open. */
export function useMarkConversationRead(): (peer: string) => Promise<void> {
	const owner = useIdentity()?.address ?? null;
	return useCallback(
		async (peer: string) => {
			if (!owner) return;
			await markConversationRead(owner, peer);
		},
		[owner],
	);
}
