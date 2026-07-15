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
	entropyToMnemonic as bip39EntropyToMnemonic,
	generateMnemonic as bip39GenerateMnemonic,
	mnemonicToEntropy as bip39MnemonicToEntropy,
	validateMnemonic as bip39ValidateMnemonic,
	mnemonicToSeed,
} from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { importPrivateKeyJwk, importPublicKeyRaw } from './crypto.ts';

/** How many words a recovery phrase has. */
export const MNEMONIC_WORDS = 12;

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

/** Check whether a phrase is a real recovery phrase: the right words in a valid
 * combination. Catches typos and made-up phrases. */
export function validateMnemonic(mnemonic: string): boolean {
	return bip39ValidateMnemonic(normalizeMnemonic(mnemonic), wordlist);
}

/** Turn the words into the raw data they stand for. Opposite of
 * {@link entropyToMnemonic}. */
export function mnemonicToEntropy(mnemonic: string): Uint8Array {
	return Uint8Array.from(
		bip39MnemonicToEntropy(normalizeMnemonic(mnemonic), wordlist),
	);
}

/** Turn raw data back into the words that represent it. Opposite of
 * {@link mnemonicToEntropy}. */
export function entropyToMnemonic(entropy: Uint8Array): string {
	return bip39EntropyToMnemonic(entropy, wordlist);
}

// --- turning the words into actual keys ------------------------------------

/** Read a block of bytes as one (big) number. */
function bytesToBigInt(bytes: Uint8Array): bigint {
	let value = 0n;
	for (const byte of bytes) value = (value << 8n) | BigInt(byte);
	return value;
}

/** Write a number back out as a fixed block of 32 bytes. */
function scalarToBytes(scalar: bigint): Uint8Array {
	const out = new Uint8Array(32);
	let value = scalar;
	for (let i = 31; i >= 0; i -= 1) {
		out[i] = Number(value & 0xffn);
		value >>= 8n;
	}
	return out;
}

/** From the phrase's seed, work out the two keys: the private key (a big secret
 * number) and the matching public key that goes with it. */
function keyMaterialFromSeed(seed: Uint8Array): {
	priv: Uint8Array;
	pub: Uint8Array;
} {
	const order = p256.Point.Fn.ORDER;
	const scalar = (bytesToBigInt(seed) % (order - 1n)) + 1n;
	const priv = scalarToBytes(scalar);
	return { priv, pub: p256.getPublicKey(priv, false) };
}

/** Repackage the raw key numbers into the shape the browser's built-in crypto
 * expects, so it can use them. */
function privateJwk(priv: Uint8Array, pub: Uint8Array): JsonWebKey {
	return {
		kty: 'EC',
		crv: 'P-256',
		d: base64urlnopad.encode(priv),
		x: base64urlnopad.encode(pub.slice(1, 33)),
		y: base64urlnopad.encode(pub.slice(33, 65)),
		ext: true,
		key_ops: ['deriveBits'],
	};
}

/**
 * Rebuild the key pair from a recovery phrase. The same words always give back
 * the same keys — that's how an account is restored on a new device.
 *
 * The optional `passphrase` is an extra secret word only you know: add one and
 * the same 12 words unlock a completely different account.
 */
export async function mnemonicToIdentity(
	mnemonic: string,
	passphrase = '',
): Promise<CryptoKeyPair> {
	const normalized = normalizeMnemonic(mnemonic);
	if (!bip39ValidateMnemonic(normalized, wordlist)) {
		throw new Error('Invalid recovery phrase');
	}
	const seed = new Uint8Array(await mnemonicToSeed(normalized, passphrase));
	const { priv, pub } = keyMaterialFromSeed(seed);
	const [privateKey, publicKey] = await Promise.all([
		importPrivateKeyJwk(privateJwk(priv, pub)),
		importPublicKeyRaw(pub),
	]);
	return { privateKey, publicKey };
}
