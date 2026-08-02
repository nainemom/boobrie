import Dexie, { type Table } from 'dexie';
import type { EncryptedPayload } from '@/shared/types';

/** Where an outgoing message is in its journey to the relay. Incoming messages
 * are always `received`. */
export type MessageStatus = 'pending' | 'sent' | 'received';

/** A chat message as the UI reads and writes it: decrypted, and never stored
 * in this shape — see {@link EncryptedMessageRow} for what's actually on disk. */
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
	/** Whether the local user has seen this message. Outgoing messages are always
	 * `true`; incoming ones start `false` and flip when their chat is opened. */
	read: boolean;
}

/** What's actually persisted: everything but `id`/`owner` is sealed inside
 * `payload`, encrypted with the owning identity's local-storage key (see
 * {@link file://../services/chat.ts}) — so logging out (deleting that identity's
 * key) is all it takes to make every peer and message unreadable at rest. */
export interface EncryptedMessageRow {
	id: string;
	owner: string;
	payload: EncryptedPayload;
}

export const db = new Dexie('boobrie') as Dexie & {
	auth: Table<CryptoKeyPair, string>;
	messages: Table<EncryptedMessageRow, string>;
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

db.version(3)
	.stores({
		auth: '',
		conversations: '[owner+peer], owner',
		// [owner+peer+at] finds a conversation's most recent message in one read.
		messages: 'id, [owner+peer], [owner+status], [owner+peer+at]',
	})
	// Everything predating read tracking counts as already seen, so upgrading
	// never surfaces a wall of unread badges.
	.upgrade((tx) =>
		tx
			.table('messages')
			.toCollection()
			.modify((message) => {
				message.read = true;
			}),
	);

db.version(4)
	.stores({
		auth: '',
		// Conversations are now derived from messages, not stored separately.
		conversations: null,
		// peer/direction/body/at/status/read all move inside the encrypted
		// `payload` — none of them can be indexed columns anymore.
		messages: 'id, owner',
	})
	// The old rows are plaintext under a shape this version no longer
	// understands; there's no local secret to migrate them with that isn't
	// already sealed the old (plaintext) way, so start clean instead of
	// carrying forward unencrypted history.
	.upgrade((tx) => tx.table('messages').clear());
