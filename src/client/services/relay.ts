import { type FetchHook, ofetch } from 'ofetch';
import type {
	CreateDepositRequest,
	CreateDepositResponse,
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
import { getSession, restore } from './auth';

const RELAY_URL = import.meta.env.VITE_RELAY_URL ?? 'http://localhost:5200';

/** Attach the current session token (if any) as a `Bearer` header, so every
 * relay call carries auth without each endpoint threading the token itself. */
const attachToken: FetchHook = ({ options }) => {
	const token = getSession()?.token;
	if (token) {
		options.headers.set('authorization', `Bearer ${token}`);
	}
};

const api = ofetch.create({
	baseURL: RELAY_URL,
	headers: { 'content-type': 'application/json' },
	onRequest: [attachToken],
	onResponseError: [
		async ({ response }) => {
			if (response?.status === 401 && getSession()?.token) {
				await restore();
			}
		},
	],
	retry: 3,
	retryDelay: 3000,
	retryStatusCodes: [408, 409, 425, 429, 500, 502, 503, 504],
});

/** A separate client for the long-lived `GET /messages` SSE stream: it hands the
 * response body back as a raw byte stream instead of parsing it, and never
 * retries — you don't retry a live connection (reconnecting is the sync
 * service's job). */
const streamApi = ofetch.create({
	baseURL: RELAY_URL,
	onRequest: [attachToken],
	retry: false,
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
	/** The connection was accepted; queued messages (if any) follow. */
	onOpen?: () => void;
	onMessage: (message: Message) => void;
	/** The connection ended (relay closed it, or {@link MessageStream.close} was
	 * called). Not fired after {@link close} is called explicitly. */
	onClose?: () => void;
	onError?: (error: unknown) => void;
}

/**
 * Open the `GET /messages` Server-Sent Events stream. Goes through {@link
 * streamApi} (rather than `EventSource`) because the endpoint is gated by an
 * `Authorization` header, which `EventSource` cannot send; `responseType:
 * 'stream'` hands back the raw body so we can parse SSE frames as they arrive
 * instead of ofetch buffering and JSON-parsing the whole response.
 */
export const streamMessages = (
	handlers: MessageStreamHandlers,
): MessageStream => {
	const controller = new AbortController();

	(async () => {
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
			handlers.onClose?.();
		} catch (error) {
			if (controller.signal.aborted) return;
			handlers.onError?.(error);
		}
	})();

	return { close: () => controller.abort() };
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

export const createDeposit = (body: CreateDepositRequest) =>
	api<CreateDepositResponse>('/billing/deposit', {
		method: 'POST',
		body,
	});
