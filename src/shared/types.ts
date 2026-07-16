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

/** A chat message as the UI stores and renders it (already decrypted locally). */
export interface ChatMessage {
	id: string;
	/** Address of the peer this message belongs to (the other end of the chat). */
	peer: string;
	direction: 'in' | 'out';
	body: string;
	/** Epoch millis, stamped locally on send/receive. */
	at: number;
}

export const FEATURES = ['message', 'notifications', 'handle', 'file'] as const;

export type Feature = (typeof FEATURES)[number];

export const FLAGS = ['margherita', 'pepperoni', 'bistecca'] as const;

export type Flag = (typeof FLAGS)[number];

export const FLAG_FEATURES: Record<Flag, Feature[]> = {
	margherita: ['message'],
	pepperoni: ['message', 'notifications'],
	bistecca: ['message', 'notifications', 'handle', 'file'],
};
