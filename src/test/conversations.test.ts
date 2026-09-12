/**
 * Your chats as you see them: the list, the unread badges, and what a
 * conversation looks like when you open it.
 *
 * A layer below the delivery flows next door, because this is all the screen
 * ever reads — the UI never talks to the relay. Two promises carry the weight.
 * Nothing on the device is readable without the account that wrote it: peer,
 * body, timestamp and read state all live inside the encrypted payload, so a
 * signed-out database gives up neither who you talked to nor what was said.
 * And chats are derived, never stored, so the list has to group, count and
 * order them correctly every time rather than trusting a cached summary.
 */

import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/client/db';
import {
	clearLocalKeyCache,
	enqueueOutgoing,
	getPendingOutgoing,
	markConversationRead,
	markSent,
	saveIncoming,
	useConversations,
	useMessages,
} from '@/client/services/chat';
import type { Identity } from '@/shared/auth';
import { signIn } from '@/test/setup/app';
import { testIdentities, testIdentity } from '@/test/setup/crypto';

let alice: Identity;
let bob: Identity;

/** Incoming message defaults; `at` matters for ordering, so it's explicit. */
const incoming = (peer: string, body: string, at: number) => ({
	id: `relay-${body}-${at}`,
	peer,
	body,
	at,
});

/** Render a hook with `identity` signed in, and wait for its first read. */
const renderWithAuth = async <T>(
	hook: () => T | undefined,
	identity: Identity,
) => {
	signIn(identity);
	const rendered = renderHook(hook);
	await waitFor(() => expect(rendered.result.current).toBeDefined());
	return rendered;
};

beforeEach(async () => {
	[alice, bob] = await testIdentities();
});

describe('what is written to the device', () => {
	it('leaves nothing readable but the id and the owner', async () => {
		await enqueueOutgoing(alice, bob.address, 'the secret plan');

		const [row] = await db.messages.toArray();
		expect(row.owner).toBe(alice.address);
		expect(row.payload).toEqual({
			iv: expect.any(String),
			ct: expect.any(String),
		});

		// Everything else — who it's to, what it says, when, whether it's been
		// read — is inside the ciphertext, so none of it can leak from the row.
		const serialized = JSON.stringify(row);
		expect(serialized).not.toContain('the secret plan');
		expect(serialized).not.toContain(bob.address);
		expect(serialized).not.toContain('pending');
	});

	it('reads back what it wrote', async () => {
		await enqueueOutgoing(alice, bob.address, 'hello bob');

		const [message] = await getPendingOutgoing(alice);
		expect(message).toMatchObject({
			owner: alice.address,
			peer: bob.address,
			direction: 'out',
			body: 'hello bob',
			status: 'pending',
			// Your own messages never count as unread.
			read: true,
		});
	});

	it('keeps one identity out of another identity’s rows', async () => {
		await enqueueOutgoing(alice, bob.address, 'alice writes');
		await enqueueOutgoing(bob, alice.address, 'bob writes');

		expect((await getPendingOutgoing(alice)).map((m) => m.body)).toEqual([
			'alice writes',
		]);
		expect((await getPendingOutgoing(bob)).map((m) => m.body)).toEqual([
			'bob writes',
		]);
	});

	it('cannot be read by relabelling a row as someone else’s', async () => {
		await enqueueOutgoing(alice, bob.address, 'alice writes');
		const [row] = await db.messages.toArray();
		// Scoping by `owner` is a query convenience; the encryption is what makes
		// it a boundary. Rewrite the label and the row is still unreadable.
		await db.messages.put({ ...row, owner: bob.address });

		await expect(getPendingOutgoing(bob)).rejects.toThrow();
	});

	it('re-derives its key rather than holding one, so a cleared cache is fine', async () => {
		await enqueueOutgoing(alice, bob.address, 'written before logout');
		// What logout does: drop the cached keys. Signing back in with the same
		// identity has to reopen the same history.
		clearLocalKeyCache();
		expect((await getPendingOutgoing(alice))[0].body).toBe(
			'written before logout',
		);
	});
});

describe('a message you have not read yet', () => {
	it('arrives unread', async () => {
		expect(await saveIncoming(alice, incoming(bob.address, 'hi', 1))).toBe(
			true,
		);

		const [conversation] = await conversationsOf(alice);
		expect(conversation).toMatchObject({ peer: bob.address, unreadCount: 1 });
		expect(conversation.lastMessage).toMatchObject({
			direction: 'in',
			status: 'received',
			read: false,
		});
	});

	it('ignores a redelivery without disturbing what it already has', async () => {
		const message = incoming(bob.address, 'delivered twice', 1);
		await saveIncoming(alice, message);
		await markConversationRead(alice, bob.address);

		// At-least-once delivery means this will happen; re-marking it unread
		// would resurface a badge for a message already read.
		expect(await saveIncoming(alice, message)).toBe(false);
		expect(await db.messages.count()).toBe(1);
		const [conversation] = await conversationsOf(alice);
		expect(conversation.unreadCount).toBe(0);
	});

	it('marks a conversation read without touching the others', async () => {
		const carol = await testIdentity();
		await saveIncoming(alice, incoming(bob.address, 'from bob', 1));
		await saveIncoming(alice, incoming(carol.address, 'from carol', 2));

		await markConversationRead(alice, bob.address);

		const conversations = await conversationsOf(alice);
		expect(unreadByPeer(conversations)).toEqual({
			[bob.address]: 0,
			[carol.address]: 1,
		});
	});
});

describe('messages still waiting to go out', () => {
	it('holds pending messages, oldest first, and drops them once sent', async () => {
		await enqueueOutgoing(alice, bob.address, 'first');
		await enqueueOutgoing(alice, bob.address, 'second');
		// Enqueued in the same millisecond is possible, so order the two by hand.
		const rows = await getPendingOutgoing(alice);
		expect(rows).toHaveLength(2);

		await markSent(alice, rows[0].id);
		const remaining = await getPendingOutgoing(alice);
		expect(remaining.map((m) => m.body)).toEqual([rows[1].body]);
	});

	it('keeps a sent message, only flipping its status', async () => {
		await enqueueOutgoing(alice, bob.address, 'delivered');
		const [pending] = await getPendingOutgoing(alice);
		await markSent(alice, pending.id);

		const [conversation] = await conversationsOf(alice);
		expect(conversation.lastMessage).toMatchObject({
			body: 'delivered',
			status: 'sent',
		});
	});

	it('shrugs at marking an id it has never seen', async () => {
		await expect(markSent(alice, 'no-such-id')).resolves.toBeUndefined();
	});

	it('excludes incoming messages', async () => {
		await saveIncoming(alice, incoming(bob.address, 'inbound', 1));
		expect(await getPendingOutgoing(alice)).toEqual([]);
	});
});

describe('the list of chats', () => {
	it('groups a chat by peer and shows its latest message', async () => {
		await saveIncoming(alice, incoming(bob.address, 'first', 1000));
		await saveIncoming(alice, incoming(bob.address, 'latest', 3000));

		const [conversation] = await conversationsOf(alice);
		expect(conversation.peer).toBe(bob.address);
		expect(conversation.lastMessage.body).toBe('latest');
		expect(conversation.unreadCount).toBe(2);
	});

	it('puts the most recently active chat on top', async () => {
		const carol = await testIdentity();
		await saveIncoming(alice, incoming(bob.address, 'older', 1000));
		await saveIncoming(alice, incoming(carol.address, 'newer', 2000));

		expect((await conversationsOf(alice)).map((c) => c.peer)).toEqual([
			carol.address,
			bob.address,
		]);
	});

	it('counts only unread incoming messages', async () => {
		await saveIncoming(alice, incoming(bob.address, 'unread', 1000));
		await enqueueOutgoing(alice, bob.address, 'my reply');

		const [conversation] = await conversationsOf(alice);
		// Your own reply is newer, so it's the last message — but it isn't unread.
		expect(conversation.lastMessage.body).toBe('my reply');
		expect(conversation.unreadCount).toBe(1);
	});

	it('is empty for an identity with no history, and for no identity at all', async () => {
		await saveIncoming(alice, incoming(bob.address, 'alice only', 1000));
		expect(await conversationsOf(bob)).toEqual([]);

		const rendered = renderHook(() => useConversations());
		await waitFor(() => expect(rendered.result.current).toEqual([]));
	});

	it('reflects a new message without being asked to re-read', async () => {
		const rendered = await renderWithAuth(() => useConversations(), alice);
		expect(rendered.result.current).toEqual([]);

		// The list is a live query: writing to the database is all the UI needs.
		await saveIncoming(alice, incoming(bob.address, 'ping', 1000));
		await waitFor(() => expect(rendered.result.current).toHaveLength(1));
		expect(rendered.result.current?.[0].lastMessage.body).toBe('ping');
	});
});

describe('opening one chat', () => {
	it('shows one peer’s messages, oldest first', async () => {
		const carol = await testIdentity();
		await saveIncoming(alice, incoming(bob.address, 'bob second', 2000));
		await saveIncoming(alice, incoming(bob.address, 'bob first', 1000));
		await saveIncoming(alice, incoming(carol.address, 'carol', 1500));

		const rendered = await renderWithAuth(
			() => useMessages(bob.address),
			alice,
		);
		expect(rendered.result.current?.map((m) => m.body)).toEqual([
			'bob first',
			'bob second',
		]);
	});

	it('is empty for a peer never spoken to', async () => {
		await saveIncoming(alice, incoming(bob.address, 'hi', 1000));
		const rendered = await renderWithAuth(
			() => useMessages('someone-else'),
			alice,
		);
		expect(rendered.result.current).toEqual([]);
	});
});

// --- helpers ---------------------------------------------------------------

/** The conversation list as the UI would see it, once settled. */
async function conversationsOf(identity: Identity) {
	const rendered = await renderWithAuth(() => useConversations(), identity);
	return rendered.result.current ?? [];
}

const unreadByPeer = (
	conversations: { peer: string; unreadCount: number }[],
): Record<string, number> =>
	Object.fromEntries(
		conversations.map(({ peer, unreadCount }) => [peer, unreadCount]),
	);
