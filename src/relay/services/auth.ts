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
	type EditHandleResponse,
	editDiscoverableSchema,
	editHandleSchema,
	type MeResponse,
	type VerifyResponse,
	verifySchema,
} from '@/shared/protocol';
import type { AuthClaims, Role } from '@/shared/types';
import { config } from '../config.ts';
import { db } from '../db/index.ts';
import { signToken, verifyToken } from './jwt.ts';
import { getSubscription, vapidPublicKey } from './push.ts';

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
		pushSubscription: await getSubscription(address),
		vapidPublicKey: vapidPublicKey(),
		createdAt: user.createdAt,
	};
};

/** Middleware: verify the session token from the `Authorization` header and
 * stash the claims on `event.context.claim`. Throws 401 when it fails. */
export const requireAuth = defineMiddleware((event) => {
	const header = event.req.headers.get('authorization');
	const token = header?.startsWith('Bearer ') ? header.slice(7) : '';
	let claim: AuthClaims;
	try {
		claim = verifyToken<AuthClaims>(token);
	} catch {
		throw new HTTPError({ status: 401, message: 'unauthorized' });
	}
	if (!claim.address) {
		throw new HTTPError({ status: 401, message: 'invalid token' });
	}
	event.context.claim = claim;
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
		challengeToken: signToken(claims, config.challengeTtlMs),
		box,
	} satisfies ChallengeResponse;
});

export const verifyHandler = defineHandler(async (event) => {
	const { challengeToken, response, handle } = await readValidatedBody(
		event,
		verifySchema,
	);

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
		data: [{ address: claims.address, handle: handle || null }],
		skipDuplicates: true,
	});

	if (inserted.count === 0 && handle) {
		await db.user.update({
			where: { address: claims.address },
			data: { handle },
		});
	}

	return {
		token: signToken({ address: claims.address }, config.sessionTtlMs),
		expiresAt: Date.now() + config.sessionTtlMs,
		created: inserted.count > 0,
	} satisfies VerifyResponse;
});

export const getMeHandler = defineHandler(async (event) => {
	const me = await buildMe(event.context.claim?.address || '');
	if (!me) throw new HTTPError({ status: 404, message: 'user not found' });
	return me;
});

export const editHandleHandler = defineHandler(async (event) => {
	const address = event.context.claim?.address || '';
	const { handle } = await readValidatedBody(event, editHandleSchema);

	if (handle !== null) {
		const existing = await db.user.findUnique({
			where: { handle },
			select: { address: true },
		});
		if (existing && existing.address !== address) {
			throw new HTTPError({ status: 409, message: 'handle already taken' });
		}
	}
	await db.user.update({ where: { address }, data: { handle } });

	return {
		handle,
	} satisfies EditHandleResponse;
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
