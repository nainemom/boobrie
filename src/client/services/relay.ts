import { type FetchHook, ofetch } from 'ofetch';
import type {
	EditDiscoverableRequest,
	EditHandleRequest,
	EditPushSubscriptionRequest,
	MeResponse,
	Message,
	RandomMatchRequest,
	RandomMatchResponse,
	SendMessageRequest,
	UserResponse,
} from '@/shared/protocol';
import { authState, restore } from './auth';

const RELAY_URL = import.meta.env.VITE_RELAY_URL ?? 'http://localhost:5200';

/** Attach the current session token (if any) as a `Bearer` header, so every
 * relay call carries auth without each endpoint threading the token itself. */
const attachToken: FetchHook = ({ options }) => {
	const token = authState.state.session?.token;
	if (token) {
		options.headers.set('authorization', `Bearer ${token}`);
	}
};

/** A stale/expired token means the relay answers with 401. Re-authenticate via
 * {@link restore} so the *retried* request — see `retryStatusCodes` below on
 * both clients — goes out with a fresh one: ofetch reruns `onRequest` (and so
 * `attachToken`) on every retry, and awaits this hook before deciding to
 * retry, so by then `restore()` has already updated the session. */
const restoreOn401: FetchHook = async ({ response }) => {
	if (response?.status === 401 && authState.state.session?.token) {
		await restore();
	}
};

const api = ofetch.create({
	baseURL: RELAY_URL,
	headers: { 'content-type': 'application/json' },
	onRequest: [attachToken],
	onResponseError: [restoreOn401],
	retry: 3,
	retryDelay: 3000,
	retryStatusCodes: [408, 409, 425, 429, 500, 502, 503, 504],
});

/** A separate client for the long-lived `GET /messages` SSE stream: it hands the
 * response body back as a raw byte stream instead of parsing it. Only retries
 * a 401 in place (via `restoreOn401`, same as `api`) — any other failure is
 * {@link streamMessages}'s own job to reconnect from, not a request-level retry. */
const streamApi = ofetch.create({
	baseURL: RELAY_URL,
	onRequest: [attachToken],
	onResponseError: [restoreOn401],
	retry: 3,
	retryDelay: 0,
	retryStatusCodes: [401],
});

export const sendMessage = (body: SendMessageRequest) =>
	api('/messages', {
		method: 'POST',
		body,
	});

export const readMessage = (id: string) =>
	api(`/messages/${id}`, {
		method: 'DELETE',
	});

export interface MessageStream {
	/** Stop listening and abort the underlying request. */
	close(): void;
}

export interface MessageStreamHandlers {
	/** The connection was accepted; queued messages (if any) follow. Fires
	 * again after every reconnect, not just the first connection. */
	onOpen?: () => void;
	onMessage: (message: Message) => void;
	/** The connection is down — it failed to open, dropped mid-stream, or the
	 * relay ended it cleanly — and a reconnect is already scheduled. Never
	 * fires after {@link MessageStream.close} was called explicitly. */
	onClose?: () => void;
	/** Either paired with `onClose` (a connection-level failure) or standalone
	 * (a single unparseable message frame; the stream reads on regardless). */
	onError?: (error: unknown) => void;
}

/** How long to wait before reopening the stream after it drops for any reason
 * other than {@link MessageStream.close} being called. */
const RECONNECT_MS = 5000;

/**
 * Open the `GET /messages` Server-Sent Events stream. Goes through {@link
 * streamApi} (rather than `EventSource`) because the endpoint is gated by an
 * `Authorization` header, which `EventSource` cannot send — but like
 * `EventSource`, the subscription keeps itself alive: any drop is followed by
 * a reconnect after {@link RECONNECT_MS}, until {@link MessageStream.close} is
 * called. `responseType: 'stream'` hands back the raw body so we can parse SSE
 * frames as they arrive instead of ofetch buffering and JSON-parsing the whole
 * response. A 401 (expired/rotated token) already re-authenticated and
 * retried itself inside `streamApi` before this ever sees an error — see
 * `restoreOn401` above.
 */
export const streamMessages = (
	handlers: MessageStreamHandlers,
): MessageStream => {
	const controller = new AbortController();
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

	function scheduleReconnect(): void {
		reconnectTimer = setTimeout(() => {
			reconnectTimer = null;
			void connect();
		}, RECONNECT_MS);
	}

	async function connect(): Promise<void> {
		let body: ReadableStream<Uint8Array>;
		try {
			body = await streamApi('/messages', {
				responseType: 'stream',
				signal: controller.signal,
			});
		} catch (error) {
			// ofetch throws on a non-2xx response, a network failure, or the abort.
			if (controller.signal.aborted) return;
			handlers.onError?.(error);
			handlers.onClose?.();
			scheduleReconnect();
			return;
		}

		handlers.onOpen?.();

		try {
			const reader = body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });

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
		} catch (error) {
			if (controller.signal.aborted) return;
			handlers.onError?.(error);
		}

		// Reached whether the relay ended the stream cleanly or the read loop
		// threw — either way the connection is gone and worth reopening.
		handlers.onClose?.();
		scheduleReconnect();
	}

	void connect();

	return {
		close: () => {
			controller.abort();
			if (reconnectTimer) clearTimeout(reconnectTimer);
		},
	};
};

export const getMe = () => api<MeResponse>('/auth/me');

export const updateHandle = (body: EditHandleRequest) =>
	api('/auth/me/handle', {
		method: 'PATCH',
		body,
	});

export const setDiscoverable = (body: EditDiscoverableRequest) =>
	api('/auth/me/discoverable', {
		method: 'PATCH',
		body,
	});

export const editPushSubscription = (body: EditPushSubscriptionRequest) =>
	api('/auth/me/push-subscription', {
		method: 'PUT',
		body,
	});

export const getUser = (address: string) =>
	api<UserResponse>(`/users/${address}`);

export const getUserByHandle = (handle: string) =>
	api<UserResponse>(`/handles/${handle}`);

export const getRandomMatch = (body: RandomMatchRequest) =>
	api<RandomMatchResponse>('/random', {
		method: 'POST',
		body,
	});
