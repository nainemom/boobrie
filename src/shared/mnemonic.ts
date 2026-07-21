/**
 * Recovery phrases: the 12 words that back up an account.
 *
 * Think of the 12 words as the master password for an account. From those
 * words we build a "key pair" — two matching keys:
 *
 *   - a public key: like your address. Safe to share; people use it to send
 *     you private messages.
 *   - a private key: your secret. It's the only thing that can open those
 *     messages. Never share it.
 *
 * The 12 words are the real secret. Type the same words on any device and you
 * get back the exact same key pair (and therefore the same address) — that's
 * how you restore an account on a new phone.
 *
 * It only works one way: the words rebuild the keys, but the keys can't be
 * turned back into words. So back up the words, not the keys.
 */

import { p256 } from '@noble/curves/nist.js';
import { base64urlnopad } from '@scure/base';
import {
	generateMnemonic as bip39GenerateMnemonic,
	validateMnemonic as bip39ValidateMnemonic,
	mnemonicToSeed,
} from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { importPrivateKeyJwk, importPublicKeyRaw } from './crypto.ts';
import { bigIntToBytes, bytesToBigInt } from './encoding.ts';

/** How much randomness a phrase carries. This number is what makes it exactly
 * 12 words long. */
const MNEMONIC_STRENGTH = 128;

/** Tidy up a phrase a user typed or pasted — trim, collapse extra spaces, and
 * lowercase — so small formatting differences still match. */
function normalizeMnemonic(mnemonic: string): string {
	return mnemonic.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Make a brand-new, random 12-word recovery phrase. */
export function generateMnemonic(): string {
	return bip39GenerateMnemonic(wordlist, MNEMONIC_STRENGTH);
}

/** True if `mnemonic` is a valid recovery phrase, forgiving of casing and
 * stray whitespace. Lets the UI check a typed phrase before trying to use it. */
export function isValidMnemonic(mnemonic: string): boolean {
	return bip39ValidateMnemonic(normalizeMnemonic(mnemonic), wordlist);
}

// --- turning the words into actual keys ------------------------------------

export async function mnemonicToKeyPair(
	mnemonic: string,
): Promise<CryptoKeyPair> {
	const normalized = normalizeMnemonic(mnemonic);
	if (!bip39ValidateMnemonic(normalized, wordlist)) {
		throw new Error('Invalid recovery phrase');
	}
	const seed = new Uint8Array(await mnemonicToSeed(normalized));

	const order = p256.Point.Fn.ORDER;
	const scalar = (bytesToBigInt(seed) % (order - 1n)) + 1n;
	const priv = bigIntToBytes(scalar, 32);
	const pub = p256.getPublicKey(priv, false);

	const [privateKey, publicKey] = await Promise.all([
		importPrivateKeyJwk({
			kty: 'EC',
			crv: 'P-256',
			d: base64urlnopad.encode(priv),
			x: base64urlnopad.encode(pub.slice(1, 33)),
			y: base64urlnopad.encode(pub.slice(33, 65)),
			ext: true,
			key_ops: ['deriveBits'],
		}),
		importPublicKeyRaw(pub),
	]);
	return { privateKey, publicKey };
}
