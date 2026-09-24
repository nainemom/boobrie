import { createHash, timingSafeEqual } from 'node:crypto';
import {
	defineHandler,
	defineMiddleware,
	HTTPError,
	readValidatedBody,
} from 'h3';
import { seal } from '@/shared/crypto';
import { base58ToBytes, bytesToBase58 } from '@/shared/encoding';
import {
	type ChallengeResponse,
	challengeSchema,
	type EditDiscoverableResponse,
	type EditOnlineStatusResponse,
	editDiscoverableSchema,
	editOnlineStatusSchema,
	type MeResponse,
	type VerifyResponse,
	verifySchema,
} from '@/shared/protocol';
import type { AuthClaims, Role } from '@/shared/types';
import { db } from '../db/index.ts';
import { env } from '../env.ts';
import { signToken, verifyToken } from './jwt.ts';
import { disconnectOtherDevices } from './messaging.ts';
import { deleteSubscription, getSubscription, vapidPublicKey } from './push.ts';

const NONCE_BYTES = 32;

interface ChallengeClaims {
	typ: 'challenge';
	address: string;
	nonceHash: string;
}

declare module 'h3' {
	interface H3EventContext {
		claim?: AuthClaims;
	}
}

const sha256 = (bytes: Uint8Array): Buffer =>
	createHash('sha256').update(bytes).digest();

/** Assemble the full `GET /auth/me` view for an address, or null if unknown. */
const buildMe = async (address: string): Promise<MeResponse | null> => {
	const user = await db.user.findUnique({ where: { address } });
	if (!user) return null;

	return {
		address: user.address,
		role: user.role as Role,
		handle: user.handle,
		discoverable: user.discoverable,
		onlineStatus: user.onlineStatus,
		pushSubscription: await getSubscription(address),
		vapidPublicKey: vapidPublicKey(),
		createdAt: user.createdAt,
	};
};

/** Read from the account, not the token: a login elsewhere moves the account
 * while this device's token stays valid, and that gap is the thing enforced. */
const isActiveDevice = async (
	address: string,
	deviceId: string,
): Promise<boolean> => {
	const user = await db.user.findUnique({
		where: { address },
		select: { activeDeviceId: true },
	});
	// No user record at all: nothing to contradict.
	return !user || user.activeDeviceId === deviceId;
};

/**
 * Middleware: verify the session token and stash its claims on
 * `event.context.claim`. A bad or non-session token is a 401, which the client
 * answers by re-authenticating; a good one from a device that no longer holds
 * the account is a 409, which re-authenticating would not help.
 */
export const requireAuth = defineMiddleware(async (event) => {
	const header = event.req.headers.get('authorization');
	const token = header?.startsWith('Bearer ') ? header.slice(7) : '';
	let claim: Partial<AuthClaims>;
	try {
		claim = verifyToken<Partial<AuthClaims>>(token);
	} catch {
		throw new HTTPError({ status: 401, message: 'unauthorized' });
	}
	const { typ, address, deviceId } = claim;
	if (typ !== 'session' || !address || !deviceId) {
		throw new HTTPError({ status: 401, message: 'invalid token' });
	}
	if (!(await isActiveDevice(address, deviceId))) {
		throw new HTTPError({
			status: 409,
			message: 'account is signed in on another device',
		});
	}
	event.context.claim = { typ, address, deviceId };
});

export const challengeHandler = defineHandler(async (event) => {
	const { address } = await readValidatedBody(event, challengeSchema);

	const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
	let box: ChallengeResponse['box'];
	try {
		box = await seal(base58ToBytes(address), nonce);
	} catch {
		throw new HTTPError({
			status: 400,
			message: 'address is not a valid public key',
		});
	}

	const claims: ChallengeClaims = {
		typ: 'challenge',
		address,
		nonceHash: bytesToBase58(sha256(nonce)),
	};
	return {
		challengeToken: signToken(claims, env.RELAY_CHALLENGE_TTL_MS),
		box,
	} satisfies ChallengeResponse;
});

export const verifyHandler = defineHandler(async (event) => {
	const { challengeToken, response, handle, deviceId, claim } =
		await readValidatedBody(event, verifySchema);

	let claims: ChallengeClaims;
	try {
		claims = verifyToken<ChallengeClaims>(challengeToken);
	} catch {
		throw new HTTPError({
			status: 401,
			message: 'challenge expired or invalid',
		});
	}
	if (claims.typ !== 'challenge' || !claims.address || !claims.nonceHash) {
		throw new HTTPError({ status: 401, message: 'not a challenge ticket' });
	}

	let given: Buffer;
	try {
		given = sha256(base58ToBytes(response));
	} catch {
		throw new HTTPError({
			status: 400,
			message: 'response is not valid base58',
		});
	}
	const expected = Buffer.from(base58ToBytes(claims.nonceHash));
	if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
		throw new HTTPError({ status: 401, message: 'wrong response' });
	}

	if (handle) {
		const existing = await db.user.findUnique({
			where: { handle },
			select: { address: true },
		});
		if (existing && existing.address !== claims.address) {
			throw new HTTPError({ status: 409, message: 'handle already taken' });
		}
	}

	const inserted = await db.user.createMany({
		data: [
			{
				address: claims.address,
				handle: handle || null,
				// A first login is a claim whatever the caller said: there is no
				// earlier device for it to be taking anything from.
				activeDeviceId: deviceId,
			},
		],
		skipDuplicates: true,
	});

	if (inserted.count === 0 && handle) {
		await db.user.update({
			where: { address: claims.address },
			data: { handle },
		});
	}

	// A claim takes the account from whichever device had it; an account with no
	// device on record is adopted by whoever verifies first. One update settles
	// both, so `moved.count` means "this verify is the one that moved it".
	if (inserted.count === 0) {
		const moved = await db.user.updateMany({
			where: {
				address: claims.address,
				// Spelled out: `not` does not match a null column.
				...(claim
					? {
							OR: [
								{ activeDeviceId: null },
								{ activeDeviceId: { not: deviceId } },
							],
						}
					: { activeDeviceId: null }),
			},
			data: { activeDeviceId: deviceId },
		});

		// So notifications follow the account, not the device that just lost it.
		if (claim && moved.count > 0) {
			await Promise.all([
				deleteSubscription(claims.address),
				disconnectOtherDevices(claims.address, deviceId),
			]);
		}
	}

	return {
		// `typ` tells this from the challenge ticket it was traded for, which is
		// signed with the same key and handed to anybody who asks.
		token: signToken(
			{
				typ: 'session',
				address: claims.address,
				deviceId,
			} satisfies AuthClaims,
			env.RELAY_SESSION_TTL_MS,
		),
		expiresAt: Date.now() + env.RELAY_SESSION_TTL_MS,
		created: inserted.count > 0,
	} satisfies VerifyResponse;
});

export const getMeHandler = defineHandler(async (event) => {
	const me = await buildMe(event.context.claim?.address || '');
	if (!me) throw new HTTPError({ status: 404, message: 'user not found' });
	return me;
});

export const editDiscoverableHandler = defineHandler(async (event) => {
	const address = event.context.claim?.address || '';
	const { discoverable } = await readValidatedBody(
		event,
		editDiscoverableSchema,
	);

	await db.user.update({ where: { address }, data: { discoverable } });

	return { discoverable } satisfies EditDiscoverableResponse;
});

export const editOnlineStatusHandler = defineHandler(async (event) => {
	const address = event.context.claim?.address || '';
	const { onlineStatus } = await readValidatedBody(
		event,
		editOnlineStatusSchema,
	);

	await db.user.update({ where: { address }, data: { onlineStatus } });

	return { onlineStatus } satisfies EditOnlineStatusResponse;
});
