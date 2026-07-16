import { createHash, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { randomBytes, seal } from '@/shared/crypto';
import { base58ToBytes, bytesToBase58 } from '@/shared/encoding';
import type {
	ChallengeRequest,
	ChallengeResponse,
	MeResponse,
	VerifyRequest,
	VerifyResponse,
} from '@/shared/protocol';
import { FLAG_FEATURES, type Flag } from '@/shared/types';
import { config } from '../config.ts';
import { db } from '../db/index.ts';
import { userFlags, users } from '../db/schema.ts';

const NONCE_BYTES = 32;

interface ChallengeClaims {
	typ: 'challenge';
	address: string;
	nonceHash: string;
}

function sha256(bytes: Uint8Array): Buffer {
	return createHash('sha256').update(bytes).digest();
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
	app.post<{ Body: ChallengeRequest }>(
		'/auth/challenge',
		async (req, reply) => {
			const address = req.body?.address;
			if (typeof address !== 'string' || address === '') {
				return reply.code(400).send({ error: 'address is required' });
			}

			const nonce = randomBytes(NONCE_BYTES);
			let box: ChallengeResponse['box'];
			try {
				box = await seal(base58ToBytes(address), nonce);
			} catch {
				return reply
					.code(400)
					.send({ error: 'address is not a valid public key' });
			}

			const claims: ChallengeClaims = {
				typ: 'challenge',
				address,
				nonceHash: bytesToBase58(sha256(nonce)),
			};
			const body: ChallengeResponse = {
				challengeToken: app.jwt.sign(claims, {
					expiresIn: config.challengeTtlMs,
				}),
				box,
			};
			return reply.send(body);
		},
	);

	app.post<{ Body: VerifyRequest }>('/auth/verify', async (req, reply) => {
		const { challengeToken, response } = req.body ?? {};
		if (typeof challengeToken !== 'string' || typeof response !== 'string') {
			return reply
				.code(400)
				.send({ error: 'challengeToken and response are required' });
		}

		let claims: ChallengeClaims;
		try {
			claims = app.jwt.verify<ChallengeClaims>(challengeToken);
		} catch {
			return reply.code(401).send({ error: 'challenge expired or invalid' });
		}
		if (claims.typ !== 'challenge' || !claims.address || !claims.nonceHash) {
			return reply.code(401).send({ error: 'not a challenge ticket' });
		}

		let given: Buffer;
		try {
			given = sha256(base58ToBytes(response));
		} catch {
			return reply.code(400).send({ error: 'response is not valid base58' });
		}
		const expected = Buffer.from(base58ToBytes(claims.nonceHash));
		if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
			return reply.code(401).send({ error: 'wrong response' });
		}

		const inserted = await db
			.insert(users)
			.values({ address: claims.address })
			.onConflictDoNothing()
			.returning({ address: users.address });

		const body: VerifyResponse = {
			token: app.jwt.sign(
				{ address: claims.address },
				{ expiresIn: config.sessionTtlMs },
			),
			expiresAt: Date.now() + config.sessionTtlMs,
			created: inserted.length > 0,
		};
		return reply.send(body);
	});

	app.get<{ Reply: MeResponse | { error: string } }>(
		'/auth/me',
		async (req, reply) => {
			const authHeader = req.headers.authorization;
			if (!authHeader?.startsWith('Bearer ')) {
				return reply.code(401).send({ error: 'unauthorized' });
			}
			const token = authHeader.substring(7);
			let claims: { address?: string };
			try {
				claims = app.jwt.verify<{ address?: string }>(token);
			} catch {
				return reply.code(401).send({ error: 'invalid token' });
			}

			if (!claims.address) {
				return reply.code(401).send({ error: 'invalid token payload' });
			}

			const userRecords = await db
				.select()
				.from(users)
				.where(eq(users.address, claims.address))
				.limit(1);

			if (userRecords.length === 0) {
				return reply.code(404).send({ error: 'user not found' });
			}

			const user = userRecords[0];

			let flag: Flag = 'margherita';
			const userFlagRecords = await db
				.select()
				.from(userFlags)
				.where(eq(userFlags.address, claims.address))
				.limit(1);

			if (userFlagRecords.length === 1) {
				flag = userFlagRecords[0].flag;
			}

			const features = FLAG_FEATURES[flag];

			return reply.send({
				...user,
				flag,
				features,
			});
		},
	);
}
