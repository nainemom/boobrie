import Dexie, { type Table } from 'dexie';

/** A conversation, one row per peer. Scoped by `owner` (the local identity's
 * address) so signing in as a different identity never sees another's chats. */
export interface StoredConversation {
	/** Local identity address these rows belong to. */
	owner: string;
	/** The other end of the conversation. */
	peer: string;
	/** Epoch millis the conversation was first opened. */
	createdAt: number;
}

/** Where an outgoing message is in its journey to the relay. Incoming messages
 * are always `received`. */
export type MessageStatus = 'pending' | 'sent' | 'received';

/** A chat message as the UI stores and renders it (already decrypted locally). */
export interface StoredMessage {
	/** A locally-minted uuid for outgoing messages; the relay's id for incoming
	 * ones (so at-least-once redelivery is idempotent on `put`). */
	id: string;
	/** Local identity address this row belongs to. */
	owner: string;
	/** The peer at the other end of the conversation. */
	peer: string;
	direction: 'in' | 'out';
	body: string;
	/** Epoch millis, stamped locally on enqueue / on receipt. */
	at: number;
	status: MessageStatus;
}

export const db = new Dexie('boobrie') as Dexie & {
	auth: Table<CryptoKeyPair, string>;
	conversations: Table<StoredConversation, [string, string]>;
	messages: Table<StoredMessage, string>;
};

db.version(1).stores({
	auth: '',
});

db.version(2).stores({
	auth: '',
	// Compound primary key [owner+peer]; `owner` index lists one identity's chats.
	conversations: '[owner+peer], owner',
	// Primary key `id`; [owner+peer] lists a conversation, [owner+status] finds
	// the outbox (pending messages waiting to be sent).
	messages: 'id, [owner+peer], [owner+status]',
});
