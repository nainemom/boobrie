/**
 * Auth: everything you do with an account, in one place.
 *
 * An account is a key pair (see mnemonic.ts) backed by 12 words. Make a fresh
 * one with `generateIdentity`; the `address` is its public key as text — what
 * you hand out to others, and what says whether the account is anonymous (see
 * `isAnonymous`).
 *
 * With messages you `encryptMessage` (lock it using someone's address; only
 * they can open it) and `decryptMessage` (open one locked to you).
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { exportPublicKeyRaw, openSeal, seal } from './crypto.ts';
import {
	base58ToBytes,
	bytesToBase58,
	bytesToUtf8,
	utf8ToBytes,
} from './encoding.ts';
import { generateMnemonic, mnemonicToKeyPair } from './mnemonic.ts';
import type { SealedBox } from './types.ts';

/** A ready-to-use account: the keys, the address, and (when known) the words. */
export interface Identity {
	/** The public + private key. The private half stays on this device. */
	keyPair: CryptoKeyPair;
	/** The public key written as text — the address you hand out to others. */
	address: string;
	/** The 12 words that back up this account. Present for a freshly generated
	 * account; absent when restored from a persisted key. */
	mnemonic?: string;
}

/** Get the address (the public key as text) for a key pair. */
export async function addressOf(keyPair: CryptoKeyPair): Promise<string> {
	return bytesToBase58(await exportPublicKeyRaw(keyPair.publicKey));
}

/**
 * Whether an address belongs to an anonymous account — one bit of its hash.
 *
 * Anyone can read this off any address they have seen, with no lookup and no
 * network, which is the point: it has to work for a peer you have never
 * fetched. Because the address *is* the public key, the bit can't be flipped
 * without throwing the account away — so it's a choice made once, at creation,
 * and `generateIdentity` makes it by generating phrases until one lands on the
 * side it was asked for (two tries on average).
 *
 * It's a hash bit rather than a leading character on purpose: the address gets
 * pasted into links and chats, and a legible marker would brand every one of
 * them with the account's choice.
 */
export function isAnonymous(address: string): boolean {
	return (sha256(utf8ToBytes(address))[0] & 1) === 1;
}

/** Make a brand-new account, anonymous or not (see {@link isAnonymous}).
 * Returns the whole identity, including the 12 words to show once for backup —
 * they're the only way back in. Does not log in. */
export async function generateIdentity(anonymous: boolean): Promise<Identity> {
	for (;;) {
		const mnemonic = generateMnemonic();
		const keyPair = await mnemonicToKeyPair(mnemonic);
		const address = await addressOf(keyPair);
		if (isAnonymous(address) === anonymous) {
			return { keyPair, address, mnemonic };
		}
	}
}

/** Lock a message to someone's address so only they can read it. You only need
 * their address to do this. */
export async function encryptMessage(
	address: string,
	message: string,
): Promise<SealedBox> {
	return seal(base58ToBytes(address), utf8ToBytes(message));
}

/** Open a message that was locked to this account, using its private key.
 * Throws if the message wasn't meant for this account. */
export async function decryptMessage(
	identity: Identity,
	box: SealedBox,
): Promise<string> {
	return bytesToUtf8(await openSeal(identity.keyPair.privateKey, box));
}

/** Turn a locked message into a plain string so it can be sent or displayed. */
export function serializeSealedBox(box: SealedBox): string {
	return JSON.stringify(box);
}

/** Read a locked message back from text, checking it has the right pieces. */
export function parseSealedBox(text: string): SealedBox {
	const parsed: unknown = JSON.parse(text);
	if (
		typeof parsed !== 'object' ||
		parsed === null ||
		typeof (parsed as SealedBox).epk !== 'string' ||
		typeof (parsed as SealedBox).iv !== 'string' ||
		typeof (parsed as SealedBox).ct !== 'string'
	) {
		throw new Error('Not a valid sealed box');
	}
	return parsed as SealedBox;
}
