/**
 * Auth: everything you do with an account, in one place.
 *
 * An account is a key pair (see mnemonic.ts) backed by 12 words. There are three
 * everyday actions:
 *
 *   - create:  make a new account (fresh 12 words + its keys)  → "sign up"
 *   - recover: rebuild an account from its 12 words            → "log in on a new device"
 *   - address: the public key, written as text — what you share
 *
 * And two things you do with messages:
 *
 *   - encrypt: lock a message using someone's address. Anyone can lock a
 *     message to you; only you can open it.
 *   - decrypt: open a message that was locked to your address, using your
 *     private key.
 */

import { exportPublicKeyRaw, openSeal, seal } from './crypto.ts';
import {
	base58ToBytes,
	bytesToBase58,
	bytesToUtf8,
	utf8ToBytes,
} from './encoding.ts';
import { generateMnemonic, mnemonicToIdentity } from './mnemonic.ts';
import type { SealedBox } from './types.ts';

/** A ready-to-use account: the 12 words, the keys they build, and the address. */
export interface Identity {
	/** The 12 words that back up (and can rebuild) this account. */
	mnemonic: string;
	/** The public + private key. The private half stays on this device. */
	keyPair: CryptoKeyPair;
	/** The public key written as text — the address you hand out to others. */
	address: string;
}

/** Get the address (the public key as text) for a key pair. */
export async function addressOf(keyPair: CryptoKeyPair): Promise<string> {
	return bytesToBase58(await exportPublicKeyRaw(keyPair.publicKey));
}

async function identityFrom(mnemonic: string): Promise<Identity> {
	const keyPair = await mnemonicToIdentity(mnemonic);
	return { mnemonic, keyPair, address: await addressOf(keyPair) };
}

/** Make a brand-new account: fresh 12 words plus the keys and address they
 * build. Save the words somewhere safe — they're the only way back in. */
export function createIdentity(): Promise<Identity> {
	return identityFrom(generateMnemonic());
}

/** Rebuild an account from its 12 words. Throws if the words aren't a valid
 * recovery phrase. */
export function recoverIdentity(mnemonic: string): Promise<Identity> {
	return identityFrom(mnemonic);
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
