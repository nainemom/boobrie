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

/** The key pair this browser is signed in with, and whose it is. The address is
 * stored so a tab can tell when another account has taken the one slot. */
export interface StoredKeyPair {
	keyPair: CryptoKeyPair;
	address: string;
}

export const db = new Dexie('boobrie') as Dexie & {
	auth: Table<StoredKeyPair, string>;
	messages: Table<EncryptedMessageRow, string>;
	/** This browser's id on an account, keyed by the account's address. */
	device: Table<string, string>;
};

db.version(1).stores({
	auth: '',
	// Primary key `id`; `owner` lists one identity's rows. Everything else lives
	// inside the encrypted `payload`, so nothing else can be an index.
	messages: 'id, owner',
});

db.version(2).stores({
	auth: '',
	messages: 'id, owner',
	device: '',
});

/** How the relay tells this browser from another holding the same account. Per
 * account, and random, so it cannot link two accounts to one browser. */
export function deviceIdFor(owner: string): Promise<string> {
	// In a transaction, or two tabs opening together each mint one.
	return db.transaction('rw', db.device, async () => {
		const known = await db.device.get(owner);
		if (known) return known;
		const minted = crypto.randomUUID();
		await db.device.put(minted, owner);
		return minted;
	});
}
