/**
 * Finding somebody, and being findable.
 *
 * Three things hang together here. Whether you look online is derived from the
 * connections the relay is holding, not from a flag anyone sets — so it has to
 * survive a pod dying without cleaning up, and the record of it has to be gone
 * once nobody is heartbeating it. Being offered to a stranger is opt-out, so
 * the opt-out has to be honoured. And a profile anyone can read without signing
 * in had better disclose only what it means to.
 *
 * `POST /random` picks from everyone the relay can see, which is more than the
 * cast of any one test — so each of these tells it to skip the rest, via
 * {@link everyoneBut}. That is the same `exclude` a client sends to say "next",
 * used here to make a shared relay behave as if the test had it to itself.
 */

import { afterAll, describe, expect, it } from 'vitest';
import { closeDb, db } from '@/relay/db/index.ts';
import { env } from '@/relay/env.ts';
import { sweepSessions } from '@/relay/services/messaging.ts';
import type {
	MeResponse,
	RandomMatchResponse,
	UserResponse,
} from '@/shared/protocol';
import { call, login, openStream, someHandle, waitFor } from '@/test/setup/app';

// Asserting against the relay's database gave this worker a pool of its own, and
// the global teardown that closes the relay's runs in another process. The pool
// reclaims idle sockets by itself, so this is tidiness rather than a leak fixed.
afterAll(closeDb);

/** How long a connection counts as online without being touched: three
 * heartbeats, whatever the relay under test was told a heartbeat is. */
const presenceTtlMs = () => 3 * env.RELAY_HEARTBEAT_MS;

/** Longer than the presence window, by any reading of it. */
const LONG_AGO_MS = 5 * 60_000;

/** How long to give a stream to report in, in heartbeats — whatever this relay
 * was told a heartbeat is. A flat budget would pass under CI's two seconds and
 * time out against a development `.env` carrying a longer one, which says
 * nothing about the relay and everything about the number. */
const beats = (count: number) => count * env.RELAY_HEARTBEAT_MS + 1_000;

/** A connection record with no live socket behind it — how a pod that died
 * without cleaning up looks to every other pod. Nothing is heartbeating it, so
 * the relay's sweep takes it within a TTL: a test that stands one up has that
 * long to get to its assertion. */
const orphanedSession = (address: string, agoMs = 0) =>
	db.session.create({
		data: { address, createdAt: new Date(Date.now() - agoMs) },
	});

const sessionsOf = (address: string) =>
	db.session.count({ where: { address } });

/**
 * Everyone the relay currently counts as online who isn't one of `ours` — what
 * `/random` has to be told to skip for its answer to be about this test.
 *
 * Only fresh connections. `/random` ignores a stale one anyway, and a row on
 * its way to the next sweep has no business lengthening an exclude list.
 */
async function everyoneBut(...ours: string[]): Promise<string[]> {
	const sessions = await db.session.findMany({
		where: { createdAt: { gt: new Date(Date.now() - presenceTtlMs()) } },
		select: { address: true },
	});
	const others = new Set(sessions.map((session) => session.address));
	for (const address of ours) others.delete(address);
	return [...others];
}

/** Ask to be offered somebody, from among `ours` and nobody else. */
const offerFrom = async (token: string, ...ours: string[]) =>
	(
		await call<RandomMatchResponse>('POST', '/random', {
			token,
			body: { exclude: await everyoneBut(...ours) },
		})
	).body.address;

describe('the record of who is connected', () => {
	it('appears while they are connected and is gone once they drop', async () => {
		const bob = await login();

		expect(await sessionsOf(bob.address)).toBe(0);

		const stream = await openStream(bob.token);
		await waitFor(async () => (await sessionsOf(bob.address)) === 1);

		// Dropping has to clear the record, or somebody who closed their tab would
		// go on looking online until the sweep got to them.
		await stream.close();
		await waitFor(async () => (await sessionsOf(bob.address)) === 0);
	});

	it(
		'keeps somebody who is just sitting there from going stale',
		async () => {
			const bob = await login();
			const stream = await openStream(bob.token);
			await waitFor(async () => (await sessionsOf(bob.address)) === 1);

			// Backdate his record to just short of where the relay would write him
			// off. Nothing but the stream's own heartbeat can save it now.
			const ttlMs = presenceTtlMs();
			await db.session.updateMany({
				where: { address: bob.address },
				data: { createdAt: new Date(Date.now() - ttlMs * 0.9) },
			});

			// The stream touches its row on every heartbeat, which is the only reason
			// somebody who never went anywhere stays online.
			await waitFor(async () => {
				const [row] = await db.session.findMany({
					where: { address: bob.address },
				});
				return Boolean(row) && Date.now() - row.createdAt.getTime() < ttlMs / 2;
			}, beats(2));

			await stream.close();
		},
		beats(3),
	);

	it('is one per account however many times they reconnect', async () => {
		const bob = await login();
		const first = await openStream(bob.token);
		// Reconnecting while the old connection is still half-open must not leave
		// two live streams — and two connection records — for one account.
		const second = await openStream(bob.token);
		await waitFor(async () => (await sessionsOf(bob.address)) === 1);

		await second.close();
		await first.close();
	});

	it('is swept away when the pod holding it never cleaned up', async () => {
		const bob = await login();
		await orphanedSession(bob.address, LONG_AGO_MS);
		expect(await sessionsOf(bob.address)).toBe(1);

		// Swept here rather than waited for: the relay runs this on a timer one
		// TTL wide, and sitting through one says nothing `setInterval` hasn't
		// already promised. Nothing is heartbeating that row and nothing ever
		// will — the sweep is all that stands between this table and a row per pod
		// that ever died.
		await sweepSessions();

		expect(await sessionsOf(bob.address)).toBe(0);
	});

	it(
		'survives the sweep taking a live row out from under it',
		async () => {
			const bob = await login();
			const stream = await openStream(bob.token);
			await waitFor(async () => (await sessionsOf(bob.address)) === 1);

			// What a sweep racing a slow heartbeat does. The connection is still up, so
			// the next beat has to put the row back rather than leave them dark.
			await db.session.deleteMany({ where: { address: bob.address } });
			await waitFor(
				async () => (await sessionsOf(bob.address)) === 1,
				beats(2),
			);

			await stream.close();
		},
		beats(3),
	);
});

describe('being offered somebody to talk to', () => {
	it('offers another account that is online and willing', async () => {
		const alice = await login();
		const bob = await login();
		await orphanedSession(bob.address);

		expect(await offerFrom(alice.token, bob.address)).toBe(bob.address);
	});

	it('never offers you yourself', async () => {
		const alice = await login();
		await orphanedSession(alice.address);

		// Alice is the only one left in the running, and she doesn't count.
		expect(await offerFrom(alice.token, alice.address)).toBeNull();
	});

	it('skips the ones you ask it to skip', async () => {
		const alice = await login();
		const bob = await login();
		const carol = await login();
		await orphanedSession(bob.address);
		await orphanedSession(carol.address);

		// Bob and Carol are both online and both eligible. Skipping somebody you
		// were just offered is how "next" works, so naming Bob has to leave Carol.
		expect(await offerFrom(alice.token, carol.address)).toBe(carol.address);
		// And naming them both leaves nobody.
		expect(await offerFrom(alice.token)).toBeNull();
	});

	it('respects somebody who opted out of being found', async () => {
		const alice = await login();
		const bob = await login();
		await orphanedSession(bob.address);
		expect(
			await call('PATCH', '/auth/me/discoverable', {
				token: bob.token,
				body: { discoverable: false },
			}),
		).toMatchObject({ status: 200, body: { discoverable: false } });

		expect(await offerFrom(alice.token, bob.address)).toBeNull();

		// And it is visible to them as their own setting.
		const me = await call<MeResponse>('GET', '/auth/me', { token: bob.token });
		expect(me.body.discoverable).toBe(false);
	});

	it('skips somebody whose connection has gone stale', async () => {
		const alice = await login();
		const bob = await login();
		await orphanedSession(bob.address, LONG_AGO_MS);

		expect(await offerFrom(alice.token, bob.address)).toBeNull();
	});

	it('counts somebody once however many devices they are on', async () => {
		const alice = await login();
		const bob = await login();
		// Two devices, one person: a multi-device user must not come up more often
		// than anyone else.
		await orphanedSession(bob.address);
		await orphanedSession(bob.address);

		expect(await offerFrom(alice.token, bob.address)).toBe(bob.address);
	});

	it('offers nobody when nobody else is around', async () => {
		const alice = await login();
		expect(await offerFrom(alice.token)).toBeNull();
	});

	it('needs a session, and a boolean to opt out', async () => {
		expect((await call('POST', '/random', { body: {} })).status).toBe(401);
		expect(
			(await call('PATCH', '/auth/me/discoverable', { body: {} })).status,
		).toBe(401);

		const user = await login();
		expect(
			(
				await call('PATCH', '/auth/me/discoverable', {
					token: user.token,
					body: { discoverable: 'yes' },
				})
			).status,
		).toBe(400);
	});
});

describe('what somebody else can see about you', () => {
	it('is readable without signing in, because a link has to work', async () => {
		const name = someHandle();
		const user = await login(name);

		const { status, body } = await call<UserResponse>(
			'GET',
			`/users/${user.address}`,
		);
		expect(status).toBe(200);
		expect(body).toEqual({
			address: user.address,
			handle: name,
			createdAt: expect.any(String),
		});
	});

	it('shows no handle for somebody who has not claimed one', async () => {
		const user = await login();
		const { body } = await call<UserResponse>('GET', `/users/${user.address}`);
		expect(body.handle).toBeNull();
	});

	it('discloses nothing beyond an address, a handle and a join date', async () => {
		const user = await login(someHandle());
		await call('PUT', '/auth/me/push-subscription', {
			token: user.token,
			body: {
				pushSubscription: {
					endpoint: 'https://push.example/abc',
					keys: { p256dh: 'p', auth: 'a' },
				},
			},
		});

		const { body } = await call<Record<string, unknown>>(
			'GET',
			`/users/${user.address}`,
		);
		// Role, discoverability and the push endpoint are your own business.
		expect(Object.keys(body).sort()).toEqual([
			'address',
			'createdAt',
			'handle',
		]);
	});

	it('404s for an address nobody holds', async () => {
		const { status, body } = await call<{ error: string }>(
			'GET',
			'/users/nobody-here',
		);
		expect(status).toBe(404);
		expect(body.error).toBe('user not found');
	});
});
