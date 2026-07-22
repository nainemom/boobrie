/** Wire-level data shapes shared by client and server. */

/** An AES-GCM ciphertext plus its random IV, both base64url. */
export interface EncryptedPayload {
	iv: string;
	ct: string;
}

/** An ECIES "sealed box": ciphertext encrypted to a public key using a
 * throwaway ephemeral key whose public half travels alongside it. */
export interface SealedBox {
	/** Ephemeral public key (raw, base64url). */
	epk: string;
	iv: string;
	ct: string;
}

/** The browser `PushSubscription.toJSON()` shape the server needs to notify. */
export interface PushSubscriptionJson {
	endpoint: string;
	keys: { p256dh: string; auth: string };
}

/**
 * The (encrypted-in-transit) payload the relay pushes and the service worker
 * renders. Deliberately metadata-only: the relay never sees plaintext, so a
 * push is just a nudge to reconnect and pull the real message over the socket.
 */
export interface PushPayload {
	type: 'message';
	/** Sender address (public key). Already known to the relay; never plaintext. */
	from: string;
	/** The waiting message's id, so a click could deep-link later. */
	id: string;
}

export const ROLES = ['user', 'admin'] as const;

export type Role = (typeof ROLES)[number];

export interface AuthClaims {
	address: string;
}
