/**
 * Sending someone a message, from typing it to them reading it.
 *
 * Everything here is real except the browser: two people each have their own
 * copy of the client, talking to a relay that is actually listening, backed by
 * an actual Postgres. Nobody stubs the crypto, the stream, or the queue — so
 * what these tests establish is the thing the app promises rather than the
 * behaviour of any one module: a message reaches the person it was for, in
 * readable form, and reaches nobody else in any form.
 *
 * The relay's queue holds every message every run ever left behind, so nothing
 * here counts rows outright — it counts the ones addressed to the person the
 * test is about.
 */

import { afterAll, describe, expect, it } from 'vitest';
import { closeDb, db } from '@/relay/db/index.ts';
import { createApp } from '@/relay/main.ts';
import { stopWatching, watchMessages } from '@/relay/services/messaging.ts';
import { decrypt, encrypt } from '@/shared/crypto';
import { generateMnemonic } from '@/shared/mnemonic';
import type { EncryptedPayload } from '@/shared/types';
import { sleep } from '@/shared/utils.ts';
import {
	call,
	login,
	openStream,
	type Person,
	serveRelay,
	signUp,
	waitFor,
} from '@/test/setup/app';
import { conversationKey } from '@/test/setup/crypto';

// Asserting against the relay's database gave this worker a pool of its own, and
// the global teardown that closes the relay's runs in another process. The pool
// reclaims idle sockets by itself, so this is tidiness rather than a leak fixed.
afterAll(closeDb);

/** How many messages the relay is holding for somebody. */
const waitingFor = (who: Person | { address: string }) =>
	db.pendingMessage.count({ where: { recipient: who.address } });

/** Wait until the relay stops seeing this person as connected — their own
 * session, not anyone else's. */
const waitOffline = (person: Person) =>
	waitFor(
		async () =>
			(await db.session.count({ where: { address: person.address } })) === 0,
	);

/** Open a sealed payload as `reader` would. */
const open = async (reader: Person, sender: Person, payload: string) =>
	decrypt(
		await conversationKey(reader.identity, sender.identity),
		JSON.parse(payload) as EncryptedPayload,
	);

describe('sending someone a message', () => {
	it('arrives, readable, in their own copy of the app', async () => {
		const alice = await signUp();
		const bob = await signUp();

		await alice.send(bob, 'meet at six');

		// Nothing else happens: Alice's app drains its outbox, the relay fans the
		// message out, Bob's app decrypts it and writes it down.
		const conversation = await bob.sees(alice, 'meet at six');
		expect(conversation).toHaveLength(1);
		expect(conversation[0]).toMatchObject({
			peer: alice.address,
			direction: 'in',
			body: 'meet at six',
			read: false,
		});
	});

	it('shows on the sender’s own screen at once, then turns to sent', async () => {
		const alice = await signUp();
		const bob = await signUp();

		await alice.send(bob, 'on its way');

		// The chat screen never waits for the network — it reads the database,
		// which already has the message.
		const mine = await alice.sees(bob, 'on its way');
		expect(mine[0]).toMatchObject({ direction: 'out', read: true });

		await waitFor(
			async () => (await alice.conversation(bob))[0]?.status === 'sent',
		);
	});

	it('crosses the wire as ciphertext only they can open', async () => {
		const alice = await signUp();
		const bob = await signUp();
		// Kept waiting at the relay, so there is something to inspect.
		bob.closeApp();
		await waitOffline(bob);

		await alice.send(bob, 'the account number is 12345');
		await waitFor(async () => (await waitingFor(bob)) === 1);
		const [held] = await db.pendingMessage.findMany({
			where: { recipient: bob.address },
		});

		// The relay stores and forwards something it cannot read.
		expect(held.payload).not.toContain('account number');
		expect(held.payload).not.toContain('12345');
		expect(await open(bob, alice, held.payload)).toBe(
			'the account number is 12345',
		);

		// Someone else holding both addresses still cannot open it.
		const eve = await signUp();
		await expect(open(eve, alice, held.payload)).rejects.toThrow();

		// And in the app, Bob simply reads it.
		await bob.openApp();
		expect(await bob.sees(alice, 'the account number is 12345')).toHaveLength(
			1,
		);
	});

	it('is not delivered to anyone else', async () => {
		const alice = await signUp();
		const bob = await signUp();
		const carol = await signUp();

		await alice.send(bob, 'for bob only');
		await bob.sees(alice, 'for bob only');

		// Carol was connected the whole time, and the relay announces every
		// message on a channel every pod hears — so this is the check that the
		// recipient, not the announcement, decides delivery.
		expect(await carol.chats()).toEqual([]);
	});

	it('is let go of once they have it', async () => {
		const alice = await signUp();
		const bob = await signUp();

		await alice.send(bob, 'delivered');
		await bob.sees(alice, 'delivered');

		// The relay keeps its copy only until the recipient says they have it.
		await waitFor(async () => (await waitingFor(bob)) === 0);
	});
});

describe('when the person you are writing to is not there', () => {
	it('waits, and arrives when they open the app', async () => {
		const alice = await signUp();
		const bob = await signUp();
		bob.closeApp();
		await waitOffline(bob);

		await alice.send(bob, 'call me when you are back');
		// Held for him — not lost, and not delivered anywhere else.
		await waitFor(async () => (await waitingFor(bob)) === 1);

		await bob.openApp();
		expect(await bob.sees(alice, 'call me when you are back')).toHaveLength(1);
	});

	it('arrives in the order it was sent', async () => {
		const alice = await signUp();
		const bob = await signUp();
		bob.closeApp();
		await waitOffline(bob);

		for (const line of ['first', 'second', 'third']) {
			await alice.send(bob, line);
		}
		await bob.openApp();
		await bob.sees(alice, 'third');

		// A conversation read back out of order is a broken conversation.
		const conversation = await bob.conversation(alice);
		expect(conversation.map((message) => message.body)).toEqual([
			'first',
			'second',
			'third',
		]);
	});

	it('sends what you wrote while your own app was closed', async () => {
		const alice = await signUp();
		const bob = await signUp();
		alice.closeApp();
		await waitOffline(alice);

		// It never reached the relay, so it has to go out when she comes back
		// rather than being dropped.
		await alice.send(bob, 'written while offline');
		expect(await waitingFor(bob)).toBe(0);

		await alice.openApp();
		expect(await bob.sees(alice, 'written while offline')).toHaveLength(1);
	});
});

describe('with the app open in more than one tab', () => {
	// Tabs share one database, so each one's outbox watcher sees every other one's
	// pending message. Only one of them may act on it.

	/** By id — a new one per stream, so these say *which* as well as how many. */
	const connectionsOf = async (who: Person) =>
		(
			await db.session.findMany({
				where: { address: who.address },
				select: { id: true },
			})
		).map((row) => row.id);

	it('sends what you typed once, not once per open tab', async () => {
		const alice = await signUp();
		const bob = await signUp();
		await alice.openTab();
		// Kept waiting at the relay, where copies can be counted before they go.
		bob.closeApp();
		await waitOffline(bob);

		await alice.send(bob, 'hello, once');
		await waitFor(async () => (await waitingFor(bob)) === 1);
		// Her outbox is drained, so a second tab would have acted by now.
		await waitFor(
			async () => (await alice.conversation(bob))[0]?.status === 'sent',
		);
		await sleep(500);
		expect(await waitingFor(bob)).toBe(1);

		await bob.openApp();
		// Through `sees` first: opening resolves when the connection does, before
		// anything queued has crossed it, and an empty conversation would satisfy
		// the length check below.
		await bob.sees(alice, 'hello, once');
		expect(await bob.conversation(alice)).toHaveLength(1);
	});

	it('sends what you typed in the tab that is not driving', async () => {
		const alice = await signUp();
		const bob = await signUp();
		const otherTab = await alice.openTab();

		// Only the tab holding the lock talks to the relay, so a message written
		// anywhere else reaches it through the database they share.
		await otherTab.send(bob, 'typed in the second tab');

		expect(await bob.sees(alice, 'typed in the second tab')).toHaveLength(1);
	});

	it('holds one connection to the relay between them', async () => {
		const alice = await signUp();
		const [first] = await connectionsOf(alice);

		await alice.openTab();
		await alice.openTab();

		// Three tabs, one stream, the same one throughout: the relay keeps a single
		// stream per address, so tabs opening their own would evict each other.
		await sleep(500);
		expect(await connectionsOf(alice)).toEqual([first]);
	});

	it('signs the other tabs out when another account logs in', async () => {
		const alice = await signUp();

		// One browser holds one account: the tabs share a single key-pair slot, and
		// the newest login owns it. Without this both tabs go on working until a
		// reload, which silently comes back as whoever logged in last.
		await alice.openTab(generateMnemonic());

		await alice.waitSignedOut();
	});

	it('signs the other tabs out when one of them signs out', async () => {
		const alice = await signUp();
		// Opening it waits for a connection, so there is a session here to lose.
		const otherTab = await alice.openTab();

		await alice.logOut();

		// Signing out deletes the key pair, which every tab shares — one that missed
		// it would carry on streaming on a session nobody kept.
		await otherTab.waitSignedOut();
	});
});

describe('what the relay will and will not carry', () => {
	// Reaching past the app, because a real client cannot ask for most of this.

	it('takes a message for an address that has never signed in', async () => {
		const sender = await login();
		const stranger = { address: `never-seen-${Date.now()}` };
		// The relay cannot tell a not-yet-registered address from an offline one,
		// and shouldn't: the message waits, and arrives if they ever turn up.
		const { status } = await call('POST', '/messages', {
			token: sender.token,
			body: { recipient: stranger.address, payload: 'hello?' },
		});
		expect(status).toBe(201);
		expect(await waitingFor(stranger)).toBe(1);
	});

	it('turns away a send with no recipient or no payload', async () => {
		const sender = await login();
		const bob = await login();
		for (const body of [
			{ payload: 'x' },
			{ recipient: bob.address },
			{ recipient: '', payload: 'x' },
			{ recipient: bob.address, payload: '' },
		]) {
			const { status } = await call('POST', '/messages', {
				token: sender.token,
				body,
			});
			expect(status, JSON.stringify(body)).toBe(400);
		}
		expect(await waitingFor(bob)).toBe(0);
	});

	it('needs a session to send, to receive, or to acknowledge', async () => {
		expect(
			(
				await call('POST', '/messages', {
					body: { recipient: 'a', payload: 'b' },
				})
			).status,
		).toBe(401);
		expect((await call('GET', '/messages')).status).toBe(401);
		expect((await call('DELETE', '/messages/abc')).status).toBe(401);
	});

	it('drops a message the recipient cannot read, without storing it', async () => {
		const bob = await signUp();
		const stranger = await login();

		// Two ways for a payload to be unreadable: it isn't a payload at all, and
		// it is one sealed for a conversation this isn't.
		for (const payload of ['not json at all', '{"iv":"abc","ct":"def"}']) {
			await call('POST', '/messages', {
				token: stranger.token,
				body: { recipient: bob.address, payload },
			});
		}

		// Acknowledged, so the relay stops redelivering — but never written down.
		await waitFor(async () => (await waitingFor(bob)) === 0);
		expect(await bob.chats()).toEqual([]);
	});

	it('cannot be told a message came from somebody it did not', async () => {
		const alice = await signUp();
		const bob = await signUp();
		const carol = await login();

		// Genuinely sealed for Alice-and-Bob, but posted by Carol. The key each
		// side derives includes the other's address, so relabelling the sender
		// makes it unreadable: the relay cannot forge who wrote something.
		const payload = JSON.stringify(
			await encrypt(
				await conversationKey(alice.identity, bob.identity),
				'from alice, really',
			),
		);
		await call('POST', '/messages', {
			token: carol.token,
			body: { recipient: bob.address, payload },
		});

		await waitFor(async () => (await waitingFor(bob)) === 0);
		expect(await bob.chats()).toEqual([]);
	});
});

describe('acknowledging a message', () => {
	it("cannot be done for somebody else's", async () => {
		const alice = await login();
		const bob = await login();
		const carol = await login();
		const sent = await call<{ id: string }>('POST', '/messages', {
			token: alice.token,
			body: { recipient: bob.address, payload: 'for bob' },
		});

		// Carol knows the id — it travelled over her network, say — and tries to
		// delete it. Scoped to the caller's own messages, so it is a no-op rather
		// than a way to drop other people's mail.
		const { status } = await call('DELETE', `/messages/${sent.body.id}`, {
			token: carol.token,
		});
		expect(status).toBe(204);
		expect(await waitingFor(bob)).toBe(1);
	});

	it('can be done twice, and for an id that never existed', async () => {
		const alice = await login();
		const bob = await login();
		const sent = await call<{ id: string }>('POST', '/messages', {
			token: alice.token,
			body: { recipient: bob.address, payload: 'x' },
		});

		// At-least-once delivery means a client may acknowledge the same message
		// twice; neither that nor an unknown id is an error.
		for (const id of [sent.body.id, sent.body.id, 'does-not-exist']) {
			expect(
				(await call('DELETE', `/messages/${id}`, { token: bob.token })).status,
			).toBe(204);
		}
		expect(await waitingFor(bob)).toBe(0);
	});
});

describe('when the relay re-establishes its subscription', () => {
	it('delivers a message whose announcement it never heard', async () => {
		// A relay of our own, in this process, so the test can take its
		// subscription away and give it back — the shared one runs where it
		// cannot be reached.
		const own = await serveRelay(createApp());
		await watchMessages();

		const alice = await login();
		const bob = await login();
		const stream = await openStream(bob.token, own.url);

		// A queued message with no announcement behind it — exactly what a
		// notification fired while the relay was disconnected leaves behind,
		// because Postgres does not hold them for a subscriber that isn't there.
		await db.pendingMessage.create({
			data: {
				sender: alice.address,
				recipient: bob.address,
				payload: 'ciphertext nobody announced',
			},
		});

		// Re-subscribing is what makes the relay replay its queue to the streams
		// it is holding. Without that, this message would sit there until Bob
		// himself reconnected.
		await stopWatching();
		await watchMessages();

		await waitFor(() => stream.received.length === 1);
		expect(stream.received[0].payload).toBe('ciphertext nobody announced');

		await stream.close();
		await stopWatching();
		await own.close();
	});
});
