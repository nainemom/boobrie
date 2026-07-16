/**
 * The relay protocol.
 *
 * Auth happens *outside* the WebSocket, over plain HTTP, so the socket only ever
 * opens for someone who has already proven they hold the private key:
 *
 *   client -> POST /auth/challenge   sends its address (public key)
 *   relay  -> ChallengeResponse      a nonce sealed to that key + a signed ticket
 *   client -> POST /auth/verify      the decrypted nonce + the ticket
 *   relay  -> VerifyResponse         a signed session token
 *   client -> GET  /ws?token=…       connects; the relay rejects a bad token
 *
 * There is no username and no key directory: the address *is* the public key, so
 * anyone who has it can already encrypt to you. The relay is a pure transport.
 *
 * Everything below is plain JSON. The HTTP shapes are request/response bodies;
 * the WebSocket shapes are text frames, each tagged with a `t` discriminant.
 */

import type {
	EncryptedPayload,
	Feature,
	Flag,
	PushSubscriptionJson,
	SealedBox,
	User,
} from './types.ts';

// --- HTTP auth handshake ---------------------------------------------------

/** `POST /auth/challenge` body: the address (public key) asking to log in. */
export interface ChallengeRequest {
	address: string;
}

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
export interface VerifyRequest {
	challengeToken: string;
	/** The nonce the client recovered from {@link ChallengeResponse.box}, base58. */
	response: string;
}

/** `POST /auth/verify` reply: the session token that opens the WebSocket. */
export interface VerifyResponse {
	/** Signed session token; present it as `?token=` when opening the socket. */
	token: string;
	/** Epoch millis when the token stops being accepted. */
	expiresAt: number;
	/** True only when this verify created the user record (first-ever login). */
	created: boolean;
}

/** `GET /auth/me` reply. */
export interface MeResponse extends User {
	flag: Flag;
	features: Feature[];
}

// --- WebSocket messages (post-auth transport) ------------------------------

export type ClientMsg =
	/** Send an end-to-end encrypted message to a peer address. */
	| { t: 'msg'; to: string; id: string; enc: EncryptedPayload }
	/** Confirm receipt of a `msg` so the relay can drop its stored copy. */
	| { t: 'ack'; id: string }
	/** Ask whether an address currently has a connected device. */
	| { t: 'probe'; address: string }
	/** Register this device for offline Web Push notifications. */
	| { t: 'push'; subscription: PushSubscriptionJson }
	/** Forget this address's push target (the opposite of `push`). */
	| { t: 'unpush' };

/** Reasons a request can fail. */
export type ErrorCode = 'unauthorized' | 'bad-request';

export type ServerMsg =
	/** Connected and bound to `address`. Queued offline messages follow.
	 * `vapidPublicKey` is present only when the relay has Web Push configured;
	 * the client uses it to subscribe this device for offline notifications. */
	| { t: 'ready'; address: string; vapidPublicKey?: string }
	/** Another device took over this address; this session is closing. */
	| { t: 'kicked' }
	/** Something went wrong. */
	| { t: 'error'; code: ErrorCode; message: string }
	/** An incoming end-to-end encrypted message. `from` is the sender's address
	 * (public key), which the recipient uses to derive the shared key. */
	| { t: 'msg'; from: string; id: string; enc: EncryptedPayload }
	/** Presence answer to a `probe`. */
	| { t: 'presence'; address: string; online: boolean };
