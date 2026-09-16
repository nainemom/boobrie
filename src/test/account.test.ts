/**
 * Getting into an account, staying in it, and getting out.
 *
 * The account *is* twelve words: there is no password to reset and no record on
 * the relay to fall back on, so what matters is that the words always lead back
 * to the same address, that what the device keeps is a key it can use but never
 * read out, and that signing out leaves nothing behind.
 *
 * Most of this runs against the real relay, which answers a real challenge. The
 * exceptions are the few cases that need the relay to misbehave on cue — a
 * working one won't — and the ones probing what it refuses at the door, which
 * no client can even ask for.
 */

import { createHash } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db as local } from '@/client/db';
import {
	authState,
	generate,
	login,
	logout,
	restore,
} from '@/client/services/auth';
import { enqueueOutgoing, getPendingOutgoing } from '@/client/services/chat';
import { closeDb, db } from '@/relay/db/index.ts';
import { signToken } from '@/relay/services/jwt.ts';
import { addressOf } from '@/shared/auth';
import { openSeal } from '@/shared/crypto';
import { bytesToBase58 } from '@/shared/encoding';
import { generateMnemonic, mnemonicToKeyPair } from '@/shared/mnemonic';
import type {
	ChallengeResponse,
	MeResponse,
	VerifyResponse,
} from '@/shared/protocol';
import {
	call,
	interceptRelay,
	login as registerUser,
	solveChallenge,
	someHandle,
} from '@/test/setup/app';
import { testIdentity } from '@/test/setup/crypto';

// Asserting against the relay's database gave this worker a pool of its own, and
// the global teardown that closes the relay's runs in another process. The pool
// reclaims idle sockets by itself, so this is tidiness rather than a leak fixed.
afterAll(closeDb);

/** Whether the relay holds an account for this address. Scoped rather than
 * counted: the database keeps everything every run has ever created. */
const accountExists = async (address: string) =>
	(await db.user.findUnique({ where: { address } })) !== null;

describe('creating an account', () => {
	it('shows the words, and creates nothing until you use them', async () => {
		const identity = await generate(true);

		expect(identity.mnemonic?.split(' ')).toHaveLength(12);
		expect(identity.address).toBe(await addressOf(identity.keyPair));
		// Generating is not signing in. Someone who never writes the words down
		// has not silently ended up with an account they can't get back into.
		expect(authState.state.identity).toBeNull();
		expect(await accountExists(identity.address)).toBe(false);
		expect(await local.auth.count()).toBe(0);
	});

	it('proves the key, keeps the session, and remembers the key', async () => {
		const mnemonic = generateMnemonic();
		const identity = await login({ mnemonic });

		// The relay only ever saw a public key and a solved challenge.
		expect(identity.address).toBe(
			await addressOf(await mnemonicToKeyPair(mnemonic)),
		);
		expect(authState.state.session?.address).toBe(identity.address);
		expect(
			await db.user.findUnique({ where: { address: identity.address } }),
		).toMatchObject({ address: identity.address, role: 'user' });
		// The key is kept, so the next visit doesn't ask for the words again.
		expect(await local.auth.count()).toBe(1);
	});

	it('takes a handle on the way in', async () => {
		const handle = someHandle();
		const identity = await login({ mnemonic: generateMnemonic(), handle });

		const me = await call<MeResponse>('GET', '/auth/me', {
			token: authState.state.session?.token,
		});
		expect(me.body).toMatchObject({ address: identity.address, handle });
	});

	it('leads to the same address every time, from the same words', async () => {
		const mnemonic = generateMnemonic();
		const first = await login({ mnemonic });
		await logout();
		const second = await login({ mnemonic });
		expect(second.address).toBe(first.address);
	});

	it('refuses a phrase that is not a recovery phrase', async () => {
		await expect(login({ mnemonic: 'not twelve words' })).rejects.toThrow(
			'Invalid recovery phrase',
		);
		// Nothing half-done: no session and no key. There is no address to look
		// for on the relay either, which is the point — it was never asked.
		expect(authState.state.identity).toBeNull();
		expect(await local.auth.count()).toBe(0);
	});

	it('keeps a key the page can use but cannot read back', async () => {
		await login({ mnemonic: generateMnemonic() });
		const stored = await local.auth.get('keyPair');

		// This is the whole point of keeping a key instead of the words: a
		// compromised page can act as you while the tab is open, but cannot walk
		// away with the account.
		expect(stored?.privateKey.extractable).toBe(false);
		await expect(
			crypto.subtle.exportKey('jwk', stored?.privateKey as CryptoKey),
		).rejects.toThrow();
	});

	it('never keeps the words themselves', async () => {
		const mnemonic = generateMnemonic();
		await login({ mnemonic });
		const stored = await local.auth.get('keyPair');
		const keys = Object.keys(stored ?? {});
		expect(keys).not.toContain('mnemonic');
		for (const word of mnemonic.split(' ')) expect(keys).not.toContain(word);
	});

	it('does not half-sign-in when the relay turns the handle down', async () => {
		const mnemonic = generateMnemonic();
		const address = await addressOf(await mnemonicToKeyPair(mnemonic));

		// A handle the relay will not have. (Refused because it is malformed
		// rather than because it is taken: the client retries a conflict for nine
		// seconds before giving up, and the same thing is being checked either
		// way — a rejected handle fails the whole login. The taken case is next
		// door, in the handles flow.)
		await expect(login({ mnemonic, handle: 'BAD--' })).rejects.toThrow();
		expect(authState.state.session).toBeNull();
		expect(await local.auth.count()).toBe(0);
		expect(await accountExists(address)).toBe(false);
	});
});

describe('coming back later', () => {
	it('signs in again from the kept key, with no words needed', async () => {
		const { address } = await login({ mnemonic: generateMnemonic() });
		// A fresh page load: the key is still on the device, the session isn't.
		authState.set({ identity: null, session: null });

		expect(await restore()).toBe(true);
		expect(authState.state.session?.address).toBe(address);
		// Restored from a key, so there are no words to show — only a freshly
		// generated account carries those.
		expect(authState.state.identity?.mnemonic).toBeUndefined();
	});

	it('reports no session when the device has nothing kept', async () => {
		expect(await restore()).toBe(false);
		expect(authState.state.session).toBeNull();
	});
});

describe('signing out', () => {
	it('clears the session and the kept key, and stays out', async () => {
		await login({ mnemonic: generateMnemonic() });
		await logout();

		expect(authState.state).toEqual({ identity: null, session: null });
		expect(await local.auth.count()).toBe(0);
		expect(await restore()).toBe(false);
	});

	it('tells the relay to stop pushing to this device', async () => {
		const { address } = await login({ mnemonic: generateMnemonic() });
		const devicesOnRecord = () =>
			db.pushSubscription.count({ where: { address } });

		await call('PUT', '/auth/me/push-subscription', {
			token: authState.state.session?.token,
			body: {
				pushSubscription: {
					endpoint: 'https://push.example/abc',
					keys: { p256dh: 'p', auth: 'a' },
				},
			},
		});
		expect(await devicesOnRecord()).toBe(1);

		await logout();
		// Otherwise the relay would go on nudging a device nobody is signed in on.
		expect(await devicesOnRecord()).toBe(0);
	});

	it('leaves the messages unreadable rather than deleted', async () => {
		const mnemonic = generateMnemonic();
		const identity = await login({ mnemonic });
		await enqueueOutgoing(identity, 'peer-address', 'still here');

		await logout();
		// The rows survive. What's gone is the key to read them, and it comes back
		// only with the account.
		expect(await local.messages.count()).toBe(1);
		const back = await login({ mnemonic });
		expect((await getPendingOutgoing(back))[0].body).toBe('still here');
	});

	it('signs out even when the relay cannot be reached', async () => {
		await login({ mnemonic: generateMnemonic() });
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new Error('offline');
			}),
		);

		// The client retries a failed request three times, three seconds apart, so
		// this is what a real sign-out would sit through — skipped rather than
		// waited out. Being unable to reach the relay is no reason to stay in.
		vi.useFakeTimers({ toFake: ['setTimeout'] });
		const signingOut = logout();
		await vi.advanceTimersByTimeAsync(30_000);
		await expect(signingOut).resolves.toBeUndefined();
		vi.useRealTimers();

		expect(authState.state.identity).toBeNull();
		expect(await local.auth.count()).toBe(0);
		expect(console.error).toHaveBeenCalledWith(
			'Failed to remove push subscription:',
			expect.anything(),
		);
	});
});

describe('when the relay will not have it', () => {
	// A relay that is actually working cannot be made to reject a good key, or
	// be counted while it does. These few tests answer for it themselves — by
	// watching what the client asks for, and by turning one answer into a
	// refusal. Everything else still goes to the real thing.

	const relay = { challenges: 0, rejectVerify: false };

	beforeEach(() => {
		relay.challenges = 0;
		relay.rejectVerify = false;
		interceptRelay((route) => {
			if (route === 'POST /auth/challenge') relay.challenges += 1;
			if (route === 'POST /auth/verify' && relay.rejectVerify) {
				return new Response(JSON.stringify({ error: 'unauthorized' }), {
					status: 401,
					headers: { 'content-type': 'application/json' },
				});
			}
		});
	});

	it('forgets a key the relay no longer accepts', async () => {
		await login({ mnemonic: generateMnemonic() });
		relay.rejectVerify = true;

		expect(await restore()).toBe(false);
		// Keeping it would mean retrying a dead key on every load, for ever.
		expect(await local.auth.count()).toBe(0);
	});

	it('shares one attempt between callers who all noticed at once', async () => {
		await login({ mnemonic: generateMnemonic() });
		relay.challenges = 0;

		// Several in-flight requests each getting a 401 trigger several restores;
		// they must not each run their own handshake.
		expect(await Promise.all([restore(), restore(), restore()])).toEqual([
			true,
			true,
			true,
		]);
		expect(relay.challenges).toBe(1);
	});

	it('runs a fresh attempt after the last one settled', async () => {
		await login({ mnemonic: generateMnemonic() });
		await restore();
		const before = relay.challenges;
		// Not memoised: a later 401 has to be able to re-authenticate.
		expect(await restore()).toBe(true);
		expect(relay.challenges).toBe(before + 1);
	});
});

describe('what the relay refuses at the door', () => {
	// No client can ask for any of this — a forged ticket, someone else's
	// challenge, an expired token — so these knock on the door directly.

	it('seals the challenge to the address that asked, and nobody else', async () => {
		const alice = await testIdentity();
		const bob = await testIdentity();
		const { body: challenge } = await call<ChallengeResponse>(
			'POST',
			'/auth/challenge',
			{ body: { address: alice.address } },
		);
		const { challengeToken, box } = challenge;

		// Bob intercepts Alice's challenge and cannot open it, so cannot answer.
		await expect(openSeal(bob.keyPair.privateKey, box)).rejects.toThrow();
		const { status } = await call('POST', '/auth/verify', {
			body: { challengeToken, response: bytesToBase58(new Uint8Array(32)) },
		});
		expect(status).toBe(401);
	});

	it('turns away an address that is not a public key', async () => {
		// Junk in, 400 out — never a 500 from the crypto layer.
		const { status, body } = await call<{ error: string }>(
			'POST',
			'/auth/challenge',
			{ body: { address: 'not-a-key' } },
		);
		expect(status).toBe(400);
		expect(body.error).toBe('address is not a valid public key');
	});

	it('turns away a challenge request with no address', async () => {
		expect((await call('POST', '/auth/challenge', { body: {} })).status).toBe(
			400,
		);
	});

	it('turns away a wrong answer, and a truncated one', async () => {
		const identity = await testIdentity();

		const wrong = await solveChallenge(identity);
		wrong.nonce[0] ^= 0xff;
		const rejected = await call<{ error: string }>('POST', '/auth/verify', {
			body: {
				challengeToken: wrong.challengeToken,
				response: bytesToBase58(wrong.nonce),
			},
		});
		expect(rejected.status).toBe(401);
		expect(rejected.body.error).toBe('wrong response');

		// A shorter answer must fail on length, not crash the comparison.
		const short = await solveChallenge(identity);
		expect(
			(
				await call('POST', '/auth/verify', {
					body: {
						challengeToken: short.challengeToken,
						response: bytesToBase58(short.nonce.slice(0, 16)),
					},
				})
			).status,
		).toBe(401);
		expect(await accountExists(identity.address)).toBe(false);
	});

	it('turns away an answer that is not even base58', async () => {
		const identity = await testIdentity();
		const { challengeToken } = await solveChallenge(identity);
		const { status, body } = await call<{ error: string }>(
			'POST',
			'/auth/verify',
			{ body: { challengeToken, response: '0OIl' } },
		);
		expect(status).toBe(400);
		expect(body.error).toBe('response is not valid base58');
	});

	it('turns away a ticket it never signed', async () => {
		const identity = await testIdentity();
		const { challengeToken, nonce } = await solveChallenge(identity);
		const [header, payload] = challengeToken.split('.');

		// The right answer, presented with a ticket the relay never signed.
		const { status } = await call('POST', '/auth/verify', {
			body: {
				challengeToken: `${header}.${payload}.forged`,
				response: bytesToBase58(nonce),
			},
		});
		expect(status).toBe(401);
	});

	it('turns away a well-formed ticket that is not a challenge', async () => {
		const identity = await testIdentity();
		const { nonce } = await solveChallenge(identity);

		// Everything a challenge ticket has — the address, the right nonce hash,
		// the relay's own signature — except `typ`. Only that guard stands
		// between another kind of token and a free login.
		const notAChallenge = signToken(
			{
				typ: 'session',
				address: identity.address,
				nonceHash: bytesToBase58(createHash('sha256').update(nonce).digest()),
			},
			60_000,
		);
		const { status, body } = await call<{ error: string }>(
			'POST',
			'/auth/verify',
			{
				body: {
					challengeToken: notAChallenge,
					response: bytesToBase58(nonce),
				},
			},
		);
		expect(status).toBe(401);
		expect(body.error).toBe('not a challenge ticket');
		expect(await accountExists(identity.address)).toBe(false);
	});

	it('turns away an expired challenge', async () => {
		const identity = await testIdentity();
		const { nonce } = await solveChallenge(identity);
		// Same claims the relay would mint, already past their life.
		const expired = signToken(
			{ typ: 'challenge', address: identity.address, nonceHash: 'x' },
			-1000,
		);
		const { status, body } = await call<{ error: string }>(
			'POST',
			'/auth/verify',
			{ body: { challengeToken: expired, response: bytesToBase58(nonce) } },
		);
		expect(status).toBe(401);
		expect(body.error).toBe('challenge expired or invalid');
	});

	it('knows a returning account from a new one', async () => {
		const identity = await testIdentity();
		const solve = async () => {
			const { challengeToken, nonce } = await solveChallenge(identity);
			return call<VerifyResponse>('POST', '/auth/verify', {
				body: { challengeToken, response: bytesToBase58(nonce) },
			});
		};

		expect((await solve()).body.created).toBe(true);
		// Signing in again is not signing up again: one address, one account.
		expect((await solve()).body.created).toBe(false);
		expect(await db.user.count({ where: { address: identity.address } })).toBe(
			1,
		);
	});
});

describe('the session token', () => {
	it.each([
		['no header', undefined],
		['an empty token', ''],
		['a random string', 'not-a-token'],
		['only two segments', 'a.b'],
	])('refuses a protected route with %s', async (_label, token) => {
		const { status, body } = await call<{ error: string }>(
			'GET',
			'/auth/me',
			token === undefined ? {} : { token },
		);
		expect(status).toBe(401);
		expect(body.error).toBe('unauthorized');
	});

	it('refuses a token whose claims were edited', async () => {
		const victim = await registerUser();
		const attacker = await testIdentity();
		const [header, , signature] = victim.token.split('.');

		// Swap in the attacker's address but keep the signature: the HMAC over
		// header and payload is what makes this unusable.
		const forged = Buffer.from(
			JSON.stringify({
				address: attacker.address,
				iat: Math.floor(Date.now() / 1000),
				exp: Math.floor(Date.now() / 1000) + 3600,
			}),
		).toString('base64url');

		expect(
			(
				await call('GET', '/auth/me', {
					token: `${header}.${forged}.${signature}`,
				})
			).status,
		).toBe(401);
	});

	it('refuses an expired one, and one with no address', async () => {
		const user = await registerUser();
		expect(
			(
				await call('GET', '/auth/me', {
					token: signToken({ address: user.address }, -1000),
				})
			).status,
		).toBe(401);

		const { status, body } = await call<{ error: string }>('GET', '/auth/me', {
			token: signToken({}, 60_000),
		});
		expect(status).toBe(401);
		expect(body.error).toBe('invalid token');
	});

	it('404s for a token whose account has been deleted', async () => {
		const user = await registerUser();
		await db.user.deleteMany({ where: { address: user.address } });
		expect((await call('GET', '/auth/me', { token: user.token })).status).toBe(
			404,
		);
	});
});
