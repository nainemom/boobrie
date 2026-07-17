import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.ts';

const base64url = (input: string): string =>
	Buffer.from(input).toString('base64url');

const hmac = (data: string): string =>
	createHmac('sha256', config.jwtSecret).update(data).digest('base64url');

/** Sign a compact HS256 JWT that expires `ttlMs` from now. */
export const signToken = (payload: object, ttlMs: number): string => {
	const now = Math.floor(Date.now() / 1000);
	const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
	const body = base64url(
		JSON.stringify({
			...payload,
			iat: now,
			exp: now + Math.floor(ttlMs / 1000),
		}),
	);
	const data = `${header}.${body}`;
	return `${data}.${hmac(data)}`;
};

/** Verify an HS256 JWT and return its claims. Throws if malformed, tampered,
 * or expired. */
export const verifyToken = <T>(token: string): T => {
	const [header, body, signature] = token.split('.');
	if (!header || !body || !signature) throw new Error('malformed token');

	const expected = hmac(`${header}.${body}`);
	const given = Buffer.from(signature);
	const want = Buffer.from(expected);
	if (given.length !== want.length || !timingSafeEqual(given, want)) {
		throw new Error('bad signature');
	}

	const claims = JSON.parse(Buffer.from(body, 'base64url').toString()) as T & {
		exp?: number;
	};
	if (
		typeof claims.exp === 'number' &&
		Math.floor(Date.now() / 1000) >= claims.exp
	) {
		throw new Error('token expired');
	}
	return claims;
};
