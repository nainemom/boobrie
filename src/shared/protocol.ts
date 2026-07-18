/**
 * The relay protocol — the wire contract shared by client and relay.
 *
 * Request bodies, params, and queries are zod schemas with their types inferred,
 * so both sides work from one source of truth: the relay validates inbound
 * requests with them, and the client can reuse the same schemas/types to build
 * requests. Responses are the plain shapes the relay produces and the client
 * consumes.
 */

import { z } from 'zod';
import { HANDLE_REGEX, RESERVED_HANDLES } from './constants.ts';
import type {
	Feature,
	Flag,
	PushSubscriptionJson,
	Role,
	SealedBox,
} from './types.ts';

// --- HTTP auth handshake ---------------------------------------------------

/** `POST /auth/challenge` body: the address (public key) asking to log in. */
export const challengeSchema = z.object({
	address: z.string().min(1, 'address is required'),
});
export type ChallengeRequest = z.infer<typeof challengeSchema>;

/** `POST /auth/challenge` reply. */
export interface ChallengeResponse {
	/** A signed, short-lived ticket the client echoes back to `/auth/verify`.
	 * It commits to the nonce (by hash) so the relay stays stateless. */
	challengeToken: string;
	/** The nonce, sealed to the caller's public key. Only the matching private
	 * key can open it — that is the proof. */
	box: SealedBox;
}

/** `POST /auth/verify` body. */
export const verifySchema = z.object({
	challengeToken: z.string().min(1, 'challengeToken and response are required'),
	response: z.string().min(1, 'challengeToken and response are required'),
});
export type VerifyRequest = z.infer<typeof verifySchema>;

/** `POST /auth/verify` reply: the session token that opens the message stream. */
export interface VerifyResponse {
	/** Signed session token; present it as a `Bearer` token on later requests. */
	token: string;
	/** Epoch millis when the token stops being accepted. */
	expiresAt: number;
	/** True only when this verify created the user record (first-ever login). */
	created: boolean;
}

/** `GET /auth/me` reply. */
export interface MeResponse {
	address: string;
	role: Role;
	handle: string;
	fingerprint: string;
	flag: Flag;
	features: Feature[];
	/** The device push subscription on record, or null if none is registered. */
	pushSubscription: PushSubscriptionJson | null;
	/** The relay's Web Push VAPID public key, or null when push is not configured.
	 * The client needs it to subscribe this device before `POST /auth/push`. */
	vapidPublicKey: string | null;
	createdAt: Date;
}

/** A browser Web Push subscription — the `PushSubscription.toJSON()` shape. */
export const pushSubscriptionSchema = z
	.object({
		endpoint: z.string().min(1),
		keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
	})
	.nullable();

/** `PUT /auth/me/push-subscription` body. */
export const editPushSubscriptionSchema = z.object({
	pushSubscription: pushSubscriptionSchema,
});
export type EditPushSubscriptionRequest = z.infer<
	typeof editPushSubscriptionSchema
>;

/** `PUT /auth/me/push-subscription` reply. */
export type EditPushSubscriptionResponse = EditPushSubscriptionRequest;

/** `PUT /auth/me/handle` body. */
export const editHandleSchema = z.object({
	handle: z
		.string()
		.min(1)
		.regex(
			HANDLE_REGEX,
			'handle must be lowercase, start/end with an alphanumeric character, and only contain single hyphens or underscores (no consecutive delimiters)',
		)
		.refine(
			(handle) => !RESERVED_HANDLES.includes(handle as never),
			'handle is reserved and cannot be used',
		),
});
export type EditHandleRequest = z.infer<typeof editHandleSchema>;

/** `PUT /auth/me/handle` reply. */
export type EditHandleResponse = EditHandleRequest;

// --- Users -----------------------------------------------------------------

/** `GET /users/:address` params — an address, or `@handle`. */
export const redirectUserSchema = z.object({
	handle: z.string().min(1, 'handle param is required'),
});
export type RecirectUserParams = z.infer<typeof redirectUserSchema>;

/** `GET /users/:address` params — an address, or `@handle`. */
export const userParamsSchema = z.object({
	address: z.string().min(1, 'address param is required'),
});
export type UserParams = z.infer<typeof userParamsSchema>;

/** `GET /users/:address` reply — another user's public profile. */
export interface UserResponse {
	address: string;
	handle: string;
	fingerprint: string;
	createdAt: Date;
}

// --- Messaging (SSE receive + HTTP send) -----------------------------------

/** `POST /messages` body — an end-to-end encrypted message for `recipient`. */
export const sendMessageSchema = z.object({
	recipient: z.string().min(1, 'recipient and payload are required'),
	payload: z.string().min(1, 'recipient and payload are required'),
});
export type SendMessageRequest = z.infer<typeof sendMessageSchema>;

/** `DELETE /messages/:id` params. */
export const messageParamsSchema = z.object({
	id: z.string().min(1, 'message id is required'),
});
export type MessageParams = z.infer<typeof messageParamsSchema>;

/** `GET /presence/:address` params. */
export const presenceParamsSchema = z.object({
	address: z.string().min(1, 'address is required'),
});
export type PresenceParams = z.infer<typeof presenceParamsSchema>;

/** A queued or freshly-sent message, as streamed over `GET /messages`. */
export interface Message {
	id: string;
	sender: string;
	payload: string;
	/** ISO-8601 timestamp. */
	createdAt: string;
}

/** `GET /presence/:address` reply. */
export interface PresenceResponse {
	address: string;
	online: boolean;
}
