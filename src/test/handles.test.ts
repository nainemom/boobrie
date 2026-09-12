/**
 * Picking a name people can find you by.
 *
 * An address is ninety characters of base58, so a handle is the only part of an
 * account a person could say out loud. It has to be exclusive to be worth
 * anything, and a link built from one has to keep working — including after
 * someone gives theirs up and another account takes it.
 *
 * Every handle here comes from {@link someHandle} rather than being written
 * out: exclusivity is the whole subject, and a name spelled into a test would
 * be taken by the account the last run gave it to.
 */

import { afterAll, describe, expect, it } from 'vitest';
import { closeDb, db } from '@/relay/db/index.ts';
import { bytesToBase58 } from '@/shared/encoding';
import type { MeResponse, UserResponse } from '@/shared/protocol';
import { call, login, solveChallenge, someHandle } from '@/test/setup/app';
import { testIdentity } from '@/test/setup/crypto';

// Asserting against the relay's database gave this worker a pool of its own, and
// the global teardown that closes the relay's runs in another process. The pool
// reclaims idle sockets by itself, so this is tidiness rather than a leak fixed.
afterAll(closeDb);

/** Answer a challenge and offer `handle` with the answer — signing up and
 * claiming a name in the one request the relay takes them in. */
const verifyWith = (
	{ challengeToken, nonce }: { challengeToken: string; nonce: Uint8Array },
	handle?: string | null,
) =>
	call<{ error: string }>('POST', '/auth/verify', {
		body: { challengeToken, response: bytesToBase58(nonce), handle },
	});

const handleOf = async (token: string) =>
	(await call<MeResponse>('GET', '/auth/me', { token })).body.handle;

const setHandle = (token: string, handle: string | null) =>
	call<{ handle: string | null; error: string }>('PATCH', '/auth/me/handle', {
		token,
		body: { handle },
	});

describe('claiming one', () => {
	it('takes the handle offered at sign-up', async () => {
		const name = someHandle();
		const user = await login(name);
		expect(await handleOf(user.token)).toBe(name);
	});

	it('refuses one somebody else already holds', async () => {
		const name = someHandle();
		await login(name);
		const other = await testIdentity();

		const { status, body } = await verifyWith(
			await solveChallenge(other),
			name,
		);
		expect(status).toBe(409);
		expect(body.error).toBe('handle already taken');
		// The refused claim must not have created the account either.
		expect(
			await db.user.findUnique({ where: { address: other.address } }),
		).toBeNull();
	});

	it('lets a returning account present its own again', async () => {
		const name = someHandle();
		const user = await login(name);
		// Signing in from a second device offers the same handle; that is not a
		// conflict with itself.
		expect((await verifyWith(await solveChallenge(user), name)).status).toBe(
			200,
		);
	});

	it('refuses a malformed one before it reaches the database', async () => {
		const identity = await testIdentity();
		const { status } = await verifyWith(
			await solveChallenge(identity),
			'BAD--',
		);
		expect(status).toBe(400);
		expect(
			await db.user.findUnique({ where: { address: identity.address } }),
		).toBeNull();
	});
});

describe('changing or giving it up', () => {
	it('sets, changes, and clears', async () => {
		const user = await login();
		const first = someHandle();

		expect(await setHandle(user.token, first)).toMatchObject({
			status: 200,
			body: { handle: first },
		});
		const second = someHandle();
		expect(await setHandle(user.token, second)).toMatchObject({
			status: 200,
			body: { handle: second },
		});

		// Clearing it is a change like any other, and leaves you with none.
		expect((await setHandle(user.token, null)).status).toBe(200);
		expect(await handleOf(user.token)).toBeNull();
	});

	it("refuses to take another account's", async () => {
		const name = someHandle();
		await login(name);
		const user = await login();

		const { status, body } = await setHandle(user.token, name);
		expect(status).toBe(409);
		expect(body.error).toBe('handle already taken');
	});

	it('accepts re-setting your own to itself', async () => {
		const name = someHandle();
		const user = await login(name);
		expect((await setHandle(user.token, name)).status).toBe(200);
	});

	it('refuses a malformed one', async () => {
		const user = await login();
		for (const handle of ['Upper', 'a--b', '-x', 'admin']) {
			expect((await setHandle(user.token, handle)).status, handle).toBe(400);
		}
	});

	it('needs a session', async () => {
		expect(
			(await call('PATCH', '/auth/me/handle', { body: { handle: 'x' } }))
				.status,
		).toBe(401);
	});
});

describe('finding someone by their handle', () => {
	it('points at the address behind it, without a session', async () => {
		const name = someHandle();
		const user = await login(name);

		const { status, headers } = await call('GET', `/handles/${name}`);
		expect(status).toBe(302);
		expect(headers.get('location')).toBe(`/users/${user.address}`);
	});

	it('leads all the way to their profile', async () => {
		// What a client following the link actually ends up with.
		const name = someHandle();
		const user = await login(name);

		const { status, body } = await call<UserResponse>(
			'GET',
			`/handles/${name}`,
			{ redirect: 'follow' },
		);
		expect(status).toBe(200);
		expect(body.address).toBe(user.address);
	});

	it('404s for one nobody holds', async () => {
		expect((await call('GET', `/handles/${someHandle()}`)).status).toBe(404);
	});

	it('404s for one that was given up', async () => {
		const name = someHandle();
		const user = await login(name);
		await setHandle(user.token, null);
		expect((await call('GET', `/handles/${name}`)).status).toBe(404);
	});

	it('follows it to its new owner after it changes hands', async () => {
		const name = someHandle();
		const first = await login(name);
		await setHandle(first.token, null);
		const second = await login(name);

		const { headers } = await call('GET', `/handles/${name}`);
		expect(headers.get('location')).toBe(`/users/${second.address}`);
	});

	it('is case-sensitive, because handles are always lowercase', async () => {
		const name = someHandle();
		await login(name);
		expect((await call('GET', `/handles/${name.toUpperCase()}`)).status).toBe(
			404,
		);
	});
});
