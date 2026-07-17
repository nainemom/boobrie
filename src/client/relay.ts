/**
 * Talking to the relay — client side.
 *
 * {@link authenticate} runs the whole login dance over plain HTTP and hands
 * back a session token; every other call presents that token as a `Bearer`
 * header. {@link streamMessages} opens the long-lived `GET /messages`
 * Server-Sent Events connection — plain `EventSource` can't set an
 * `Authorization` header, so it's hand-rolled over `fetch` and a streamed
 * response body instead.
 *
 * Lives in the client (not `shared`) because only the client talks *to* the
 * relay; the relay server never imports this.
 */

import type { Identity } from '@/shared/auth';
import { openSeal } from '@/shared/crypto';
import { bytesToBase58 } from '@/shared/encoding';
import type {
	ChallengeResponse,
	EditHandleRequest,
	EditHandleResponse,
	EditPushSubscriptionRequest,
	EditPushSubscriptionResponse,
	MeResponse,
	Message,
	PresenceResponse,
	SendMessageRequest,
	UserResponse,
	VerifyResponse,
} from '@/shared/protocol';
import type { PushSubscriptionJson } from '@/shared/types';

/** A proven session: the token to present to the relay, and when it expires. */
export interface RelaySession {
	token: string;
	expiresAt: number;
	address: string;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
	const res = await fetch(url, init);
	if (!res.ok) {
		let detail = '';
		try {
			detail = ((await res.json()) as { error?: string }).error ?? '';
		} catch {
			// non-JSON error body; fall back to the status
		}
		throw new Error(detail || `Request to ${url} failed (${res.status})`);
	}
	if (res.status === 204) return undefined as T;
	return res.json() as Promise<T>;
}

const authHeaders = (token: string): HeadersInit => ({
	Authorization: `Bearer ${token}`,
});

const jsonHeaders = (token: string): HeadersInit => ({
	'content-type': 'application/json',
	...authHeaders(token),
});

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
	const { challengeToken, box } = await request<ChallengeResponse>(
		new URL('/auth/challenge', baseUrl).toString(),
		{
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ address: identity.address }),
		},
	);
	const nonce = await openSeal(identity.keyPair.privateKey, box);
	const { token, expiresAt } = await request<VerifyResponse>(
		new URL('/auth/verify', baseUrl).toString(),
		{
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ challengeToken, response: bytesToBase58(nonce) }),
		},
	);
	return { token, expiresAt, address: identity.address };
}

export async function getMe(
	baseUrl: string,
	token: string,
): Promise<MeResponse> {
	return request(new URL('/auth/me', baseUrl).toString(), {
		headers: authHeaders(token),
	});
}

export async function updateHandle(
	baseUrl: string,
	token: string,
	handle: string,
): Promise<EditHandleResponse> {
	return request(new URL('/auth/me/handle', baseUrl).toString(), {
		method: 'PATCH',
		headers: jsonHeaders(token),
		body: JSON.stringify({ handle } satisfies EditHandleRequest),
	});
}

/** Look up a user by address or `@handle`. */
export async function getUser(
	baseUrl: string,
	token: string,
	user: string,
): Promise<UserResponse> {
	return request(
		new URL(`/users/${encodeURIComponent(user)}`, baseUrl).toString(),
		{ headers: authHeaders(token) },
	);
}

export async function editPushSubscription(
	baseUrl: string,
	token: string,
	pushSubscription: PushSubscriptionJson | null,
): Promise<EditPushSubscriptionResponse> {
	return request(new URL('/auth/me/push-subscription', baseUrl).toString(), {
		method: 'PUT',
		headers: jsonHeaders(token),
		body: JSON.stringify({
			pushSubscription,
		} satisfies EditPushSubscriptionRequest),
	});
}

/** Send an end-to-end encrypted message to `recipient`. */
export async function sendMessage(
	baseUrl: string,
	token: string,
	recipient: string,
	payload: string,
): Promise<Message> {
	return request(new URL('/messages', baseUrl).toString(), {
		method: 'POST',
		headers: jsonHeaders(token),
		body: JSON.stringify({ recipient, payload } satisfies SendMessageRequest),
	});
}

/** Tell the relay a message was received, so it drops its stored copy. */
export async function readMessage(
	baseUrl: string,
	token: string,
	id: string,
): Promise<void> {
	await request(
		new URL(`/messages/${encodeURIComponent(id)}`, baseUrl).toString(),
		{ method: 'DELETE', headers: authHeaders(token) },
	);
}

export async function getPresence(
	baseUrl: string,
	token: string,
	address: string,
): Promise<PresenceResponse> {
	return request(
		new URL(`/presence/${encodeURIComponent(address)}`, baseUrl).toString(),
		{ headers: authHeaders(token) },
	);
}

export interface MessageStream {
	/** Stop listening and abort the underlying request. */
	close(): void;
}

export interface MessageStreamHandlers {
	/** The connection was accepted; queued messages (if any) follow. */
	onOpen?: () => void;
	onMessage: (message: Message) => void;
	/** The connection ended (relay closed it, or {@link MessageStream.close} was
	 * called). Not fired after {@link close} is called explicitly. */
	onClose?: () => void;
	onError?: (error: unknown) => void;
}

/**
 * Open the `GET /messages` Server-Sent Events stream. Hand-rolled over
 * `fetch` (rather than `EventSource`) because the endpoint is gated by an
 * `Authorization` header, which `EventSource` cannot send.
 */
export function streamMessages(
	baseUrl: string,
	token: string,
	handlers: MessageStreamHandlers,
): MessageStream {
	const controller = new AbortController();

	(async () => {
		let res: Response;
		try {
			res = await fetch(new URL('/messages', baseUrl).toString(), {
				headers: authHeaders(token),
				signal: controller.signal,
			});
		} catch (error) {
			if (controller.signal.aborted) return;
			handlers.onError?.(error);
			return;
		}
		if (!res.ok || !res.body) {
			handlers.onError?.(
				new Error(`Request to /messages failed (${res.status})`),
			);
			return;
		}

		handlers.onOpen?.();

		try {
			const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
			let buffer = '';
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += value;

				let boundary = buffer.indexOf('\n\n');
				while (boundary !== -1) {
					const frame = buffer.slice(0, boundary);
					buffer = buffer.slice(boundary + 2);
					const data = frame
						.split('\n')
						.filter((line) => line.startsWith('data:'))
						.map((line) => line.slice(5).trimStart())
						.join('\n');
					if (data) {
						try {
							handlers.onMessage(JSON.parse(data) as Message);
						} catch (error) {
							handlers.onError?.(error);
						}
					}
					boundary = buffer.indexOf('\n\n');
				}
			}
			handlers.onClose?.();
		} catch (error) {
			if (controller.signal.aborted) return;
			handlers.onError?.(error);
		}
	})();

	return { close: () => controller.abort() };
}
