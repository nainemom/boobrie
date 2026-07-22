/**
 * The chat service — everything about conversations and messages.
 *
 * The UI only ever touches the *local database*: reading is a pair of live
 * queries ({@link useConversations}, {@link useMessages}) that re-render
 * whenever the database changes underneath them; writing
 * ({@link useCreateConversation}, {@link useSendMessage}) just drops rows in.
 * Sending never awaits the network — it enqueues a `pending` message and returns.
 *
 * The *relay* half — the message endpoints ({@link sendMessage},
 * {@link readMessage}, {@link streamMessages} — lives at
 * the bottom of this file, but the UI never calls it: the always-on
 * {@link file://./sync.ts} service drives it, draining the outbox to the relay
 * and writing incoming messages straight back into the database, so the screen
 * only ever reflects the database.
 */

import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback } from 'react';
import type { Message, SendMessageRequest } from '@/shared/protocol';
import { db, type StoredConversation, type StoredMessage } from '../db';
import { authHeaders, jsonHeaders, RELAY_URL, request } from '../utils/request';
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

// --- the relay message endpoints (driven by the sync service) ---------------
// Every call presents a session token (from the auth service) as a `Bearer`
// header. Only the sync service calls in here; the UI stays on the database
// helpers above.

/** Send an end-to-end encrypted message to `recipient`. */
export async function sendMessage(
	token: string,
	recipient: string,
	payload: string,
): Promise<Message> {
	return request('/messages', {
		method: 'POST',
		headers: jsonHeaders(token),
		body: JSON.stringify({ recipient, payload } satisfies SendMessageRequest),
	});
}

/** Tell the relay a message was received, so it drops its stored copy. */
export async function readMessage(token: string, id: string): Promise<void> {
	await request(`/messages/${encodeURIComponent(id)}`, {
		method: 'DELETE',
		headers: authHeaders(token),
	});
}

export interface MessageStream {
	/** Stop listening and abort the underlying request. */
	close(): void;
}

export interface MessageStreamHandlers {
	/** The connection was accepted; queued messages (if any) follow. */
	onOpen?: () => void;
	onMessage: (message: Message) => void;
	/** The connection ended (relay closed it, or {@link MessageStream.close} was
	 * called). Not fired after {@link close} is called explicitly. */
	onClose?: () => void;
	onError?: (error: unknown) => void;
}

/**
 * Open the `GET /messages` Server-Sent Events stream. Hand-rolled over `fetch`
 * (rather than `EventSource`) because the endpoint is gated by an
 * `Authorization` header, which `EventSource` cannot send.
 */
export function streamMessages(
	token: string,
	handlers: MessageStreamHandlers,
): MessageStream {
	const controller = new AbortController();

	(async () => {
		let res: Response;
		try {
			res = await fetch(new URL('/messages', RELAY_URL).toString(), {
				headers: authHeaders(token),
				signal: controller.signal,
			});
		} catch (error) {
			if (controller.signal.aborted) return;
			handlers.onError?.(error);
			return;
		}
		if (!res.ok || !res.body) {
			handlers.onError?.(
				new Error(`Request to /messages failed (${res.status})`),
			);
			return;
		}

		handlers.onOpen?.();

		try {
			const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
			let buffer = '';
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += value;

				let boundary = buffer.indexOf('\n\n');
				while (boundary !== -1) {
					const frame = buffer.slice(0, boundary);
					buffer = buffer.slice(boundary + 2);
					const data = frame
						.split('\n')
						.filter((line) => line.startsWith('data:'))
						.map((line) => line.slice(5).trimStart())
						.join('\n');
					if (data) {
						try {
							handlers.onMessage(JSON.parse(data) as Message);
						} catch (error) {
							handlers.onError?.(error);
						}
					}
					boundary = buffer.indexOf('\n\n');
				}
			}
			handlers.onClose?.();
		} catch (error) {
			if (controller.signal.aborted) return;
			handlers.onError?.(error);
		}
	})();

	return { close: () => controller.abort() };
}
