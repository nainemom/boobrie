import { AUTH_KDF_INFO } from './constants.ts';
import {
	base58ToBytes,
	bytesToBase58,
	bytesToUtf8,
	utf8ToBytes,
} from './encoding.ts';
import type { EncryptedPayload, SealedBox } from './types.ts';

const ECDH_PARAMS: EcKeyGenParams = { name: 'ECDH', namedCurve: 'P-256' };

// --- identity key material -------------------------------------------------

/** Create a fresh ECDH identity key pair. */
export function generateIdentity(): Promise<CryptoKeyPair> {
	return crypto.subtle.generateKey(ECDH_PARAMS, true, ['deriveBits']);
}

export async function exportPublicKeyRaw(key: CryptoKey): Promise<Uint8Array> {
	return new Uint8Array(await crypto.subtle.exportKey('raw', key));
}

export function importPublicKeyRaw(raw: Uint8Array): Promise<CryptoKey> {
	return crypto.subtle.importKey(
		'raw',
		raw as BufferSource,
		ECDH_PARAMS,
		true,
		[],
	);
}

/** Import an identity private key. Non-extractable: it can derive bits (ECDH,
 * the auth challenge) but its raw material can never be read back out — so a
 * persisted key can't be exfiltrated even from a compromised page. */
export function importPrivateKeyJwk(jwk: JsonWebKey): Promise<CryptoKey> {
	return crypto.subtle.importKey('jwk', jwk, ECDH_PARAMS, false, [
		'deriveBits',
	]);
}

// --- shared-secret derivation ----------------------------------------------

async function deriveAesKey(
	privateKey: CryptoKey,
	publicKey: CryptoKey,
	info: string,
): Promise<CryptoKey> {
	const bits = await crypto.subtle.deriveBits(
		{ name: 'ECDH', public: publicKey },
		privateKey,
		256,
	);
	const hkdfKey = await crypto.subtle.importKey('raw', bits, 'HKDF', false, [
		'deriveKey',
	]);
	return crypto.subtle.deriveKey(
		{
			name: 'HKDF',
			hash: 'SHA-256',
			salt: new Uint8Array(0),
			info: utf8ToBytes(info),
		},
		hkdfKey,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt'],
	);
}

/**
 * Derive the symmetric key for a conversation between two identities via
 * static-static ECDH. Both peers compute the identical key, and the HKDF `info`
 * binds it to the pair of JIDs (order-independent) so it can't be repurposed.
 * A valid GCM tag therefore proves the message came from the peer, not just any
 * eavesdropper.
 */
export async function deriveConversationKey(
	myPrivateKey: CryptoKey,
	peerPublicKeyRaw: Uint8Array,
	selfBareJid: string,
	peerBareJid: string,
): Promise<CryptoKey> {
	const peerPublicKey = await importPublicKeyRaw(peerPublicKeyRaw);
	const info = `viska-convo|${[selfBareJid, peerBareJid].sort().join('|')}`;
	return deriveAesKey(myPrivateKey, peerPublicKey, info);
}

// --- message encryption ----------------------------------------------------

export async function encrypt(
	key: CryptoKey,
	plaintext: string,
): Promise<EncryptedPayload> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ct = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv },
		key,
		utf8ToBytes(plaintext) as BufferSource,
	);
	return { iv: bytesToBase58(iv), ct: bytesToBase58(new Uint8Array(ct)) };
}

export async function decrypt(
	key: CryptoKey,
	payload: EncryptedPayload,
): Promise<string> {
	const plaintext = await crypto.subtle.decrypt(
		{ name: 'AES-GCM', iv: base58ToBytes(payload.iv) as BufferSource },
		key,
		base58ToBytes(payload.ct) as BufferSource,
	);
	return bytesToUtf8(new Uint8Array(plaintext));
}

// --- sealed box (auth challenge) -------------------------------------------

/**
 * Encrypt `data` so that only the holder of the private key matching
 * `recipientPublicKeyRaw` can read it. Uses a fresh ephemeral ECDH key pair
 * (classic ECIES). The server uses this to challenge a logging-in client.
 */
export async function seal(
	recipientPublicKeyRaw: Uint8Array,
	data: Uint8Array,
): Promise<SealedBox> {
	const ephemeral = await generateIdentity();
	const recipientPublicKey = await importPublicKeyRaw(recipientPublicKeyRaw);
	const key = await deriveAesKey(
		ephemeral.privateKey,
		recipientPublicKey,
		AUTH_KDF_INFO,
	);
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ct = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv },
		key,
		data as BufferSource,
	);
	return {
		epk: bytesToBase58(await exportPublicKeyRaw(ephemeral.publicKey)),
		iv: bytesToBase58(iv),
		ct: bytesToBase58(new Uint8Array(ct)),
	};
}

/** Open a {@link seal}ed box with the matching private key. Throws if the box
 * was not sealed to this key (GCM authentication failure). */
export async function openSeal(
	myPrivateKey: CryptoKey,
	box: SealedBox,
): Promise<Uint8Array> {
	const ephemeralPublicKey = await importPublicKeyRaw(base58ToBytes(box.epk));
	const key = await deriveAesKey(
		myPrivateKey,
		ephemeralPublicKey,
		AUTH_KDF_INFO,
	);
	const data = await crypto.subtle.decrypt(
		{ name: 'AES-GCM', iv: base58ToBytes(box.iv) as BufferSource },
		key,
		base58ToBytes(box.ct) as BufferSource,
	);
	return new Uint8Array(data);
}
