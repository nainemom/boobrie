import type { Identity } from '@/shared/auth';
import { decrypt, deriveConversationKey, encrypt } from '@/shared/crypto';
import { base58ToBytes } from '@/shared/encoding';
import type { EncryptedPayload } from '@/shared/types';

// Keys are stable for the life of an (identity, peer) pair, so derive once.
const keyCache = new Map<string, Promise<CryptoKey>>();

function conversationKey(identity: Identity, peer: string): Promise<CryptoKey> {
	const cacheKey = `${identity.address}|${peer}`;
	let key = keyCache.get(cacheKey);
	if (!key) {
		key = deriveConversationKey(
			identity.keyPair.privateKey,
			base58ToBytes(peer),
			identity.address,
			peer,
		);
		keyCache.set(cacheKey, key);
	}
	return key;
}

/** Encrypt a plaintext message for `peer`, ready to send as the relay's
 * `payload` string. */
export async function encryptFor(
	identity: Identity,
	peer: string,
	message: string,
): Promise<string> {
	const payload = await encrypt(await conversationKey(identity, peer), message);
	return JSON.stringify(payload);
}

/** Decrypt a `payload` string that came from `peer`. Throws if it wasn't sealed
 * for this conversation (wrong peer, tampered ciphertext). */
export async function decryptFrom(
	identity: Identity,
	peer: string,
	payload: string,
): Promise<string> {
	return decrypt(
		await conversationKey(identity, peer),
		JSON.parse(payload) as EncryptedPayload,
	);
}
