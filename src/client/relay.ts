/**
 * Talking to the relay — client side.
 *
 * {@link authenticate} runs the whole login dance over plain HTTP — before any
 * WebSocket is opened — and hands back a session token. {@link relayWsUrl} then
 * builds the socket URL that carries that token.
 *
 * Lives in the client (not `shared`) because only the client authenticates *to*
 * the relay; the relay server never imports this.
 */

import type { Identity } from '@/shared/auth';
import { openSeal } from '@/shared/crypto';
import { bytesToBase58 } from '@/shared/encoding';
import type {
	ChallengeResponse,
	HandleResponse,
	MeResponse,
	ResolveHandleResponse,
	VerifyResponse,
} from '@/shared/protocol';

/** A proven session: the token to present to the relay, and when it expires. */
export interface RelaySession {
	token: string;
	expiresAt: number;
	address: string;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
	const res = await fetch(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	});
	if (!res.ok) {
		let detail = '';
		try {
			detail = ((await res.json()) as { error?: string }).error ?? '';
		} catch {
			// non-JSON error body; fall back to the status
		}
		throw new Error(detail || `Request to ${url} failed (${res.status})`);
	}
	return res.json() as Promise<T>;
}

/**
 * Prove to the relay that we hold the private key, and get a session token back.
 *   1. ask for a challenge — a random nonce sealed to our public key
 *   2. open it with our private key to recover the nonce
 *   3. send the nonce back; a correct answer earns a signed token
 * Throws if the relay is unreachable or rejects the proof.
 */
export async function authenticate(
	baseUrl: string,
	identity: Identity,
): Promise<RelaySession> {
	const { challengeToken, box } = await postJson<ChallengeResponse>(
		new URL('/auth/challenge', baseUrl).toString(),
		{ address: identity.address },
	);
	const nonce = await openSeal(identity.keyPair.privateKey, box);
	const { token, expiresAt } = await postJson<VerifyResponse>(
		new URL('/auth/verify', baseUrl).toString(),
		{ challengeToken, response: bytesToBase58(nonce) },
	);
	return { token, expiresAt, address: identity.address };
}

/** Build the token-gated WebSocket URL for a session. */
export function relayWsUrl(baseUrl: string, token: string): string {
	const url = new URL('/ws', baseUrl);
	url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
	url.searchParams.set('token', token);
	return url.toString();
}

export async function getMe(
	baseUrl: string,
	token: string,
): Promise<MeResponse> {
	const res = await fetch(new URL('/auth/me', baseUrl).toString(), {
		headers: {
			Authorization: `Bearer ${token}`,
		},
	});
	if (!res.ok) {
		let detail = '';
		try {
			detail = ((await res.json()) as { error?: string }).error ?? '';
		} catch {}
		throw new Error(detail || `Request to /auth/me failed (${res.status})`);
	}
	return res.json() as Promise<MeResponse>;
}

export async function updateHandle(
	baseUrl: string,
	token: string,
	handle: string,
): Promise<HandleResponse> {
	const res = await fetch(new URL('/auth/handle', baseUrl).toString(), {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			Authorization: `Bearer ${token}`,
		},
		body: JSON.stringify({ handle }),
	});
	if (!res.ok) {
		let detail = '';
		try {
			detail = ((await res.json()) as { error?: string }).error ?? '';
		} catch {}
		throw new Error(
			detail || `Request to update handle failed (${res.status})`,
		);
	}
	return res.json() as Promise<HandleResponse>;
}

export async function resolveHandle(
	baseUrl: string,
	token: string,
	handle: string,
): Promise<ResolveHandleResponse> {
	const res = await fetch(
		new URL(`/auth/handle/${encodeURIComponent(handle)}`, baseUrl).toString(),
		{
			headers: {
				Authorization: `Bearer ${token}`,
			},
		},
	);
	if (!res.ok) {
		let detail = '';
		try {
			detail = ((await res.json()) as { error?: string }).error ?? '';
		} catch {}
		throw new Error(detail || `Handle lookup failed (${res.status})`);
	}
	return res.json() as Promise<ResolveHandleResponse>;
}
