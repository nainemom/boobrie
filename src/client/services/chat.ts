/**
 * Chat, from the UI's point of view: read and write the local database, nothing
 * more. Reading is a pair of live queries ({@link useConversations},
 * {@link useMessages}) that re-render whenever the database changes underneath
 * them; writing ({@link useCreateConversation}, {@link useSendMessage}) just
 * drops rows in. Sending never awaits the network — it enqueues a `pending`
 * message and returns.
 *
 * The relay is somebody else's job: the always-on {@link file://./sync.ts}
 * service drains the outbox to the relay and writes incoming messages straight
 * back here, so the screen only ever reflects the database.
 */

import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback } from 'react';
import { db, type StoredConversation, type StoredMessage } from '../db';
import { useIdentity } from './auth';

/** This identity's conversations, oldest first, live. `undefined` until the
 * first read resolves — so callers can tell "loading" from "none". */
export function useConversations(): StoredConversation[] | undefined {
	const owner = useIdentity()?.address ?? null;
	return useLiveQuery<StoredConversation[]>(
		() =>
			owner
				? db.conversations.where('owner').equals(owner).sortBy('createdAt')
				: [],
		[owner],
	);
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
		});
	});
}

/** Persist a decrypted incoming message. Idempotent on the relay id, since
 * delivery is at-least-once and the same message may arrive twice. */
export async function saveIncoming(
	owner: string,
	message: { id: string; peer: string; body: string; at: number },
): Promise<void> {
	await db.transaction('rw', db.conversations, db.messages, async () => {
		await ensureConversation(owner, message.peer);
		await db.messages.put({
			id: message.id,
			owner,
			peer: message.peer,
			direction: 'in',
			body: message.body,
			at: message.at,
			status: 'received',
		});
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
