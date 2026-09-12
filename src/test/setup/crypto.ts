/**
 * Identities and conversation keys for tests — the two things nearly every test
 * needs before it can say anything interesting.
 */

import { addressOf, type Identity } from '@/shared/auth.ts';
import { deriveConversationKey, generateIdentity } from '@/shared/crypto.ts';
import { base58ToBytes } from '@/shared/encoding.ts';

/**
 * A fresh identity: a bare key pair, not one derived from a recovery phrase.
 * Nothing outside `mnemonic.ts` can tell the difference — an identity is a key
 * pair and the address is its public half — while BIP39's key stretching costs
 * ~70ms a time against ~1.4ms here, which was most of the suite's runtime for
 * nothing it tests. Where the phrase itself is the subject (the address it
 * derives, the non-extractable private key it imports), tests use the real
 * thing instead; see `security.test.ts`.
 */
export async function testIdentity(): Promise<Identity> {
	const keyPair = await generateIdentity();
	return { keyPair, address: await addressOf(keyPair) };
}

/** The two ends of a conversation. */
export function testIdentities(): Promise<[Identity, Identity]> {
	return Promise.all([testIdentity(), testIdentity()]);
}

/**
 * What one side computes for a conversation: its own private key, the peer's
 * address, and the pair of addresses. Both sides arrive at the same key, so
 * this doubles as "the key the peer would use" when a test needs to read what
 * the code under test wrote.
 */
export function conversationKey(
	self: Identity,
	peer: Identity,
): Promise<CryptoKey> {
	return deriveConversationKey(
		self.keyPair.privateKey,
		base58ToBytes(peer.address),
		self.address,
		peer.address,
	);
}
