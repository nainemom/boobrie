/**
 * What the app promises about privacy, checked at the level the promise is
 * actually kept: the keys.
 *
 * The same shape as the other flows, told a layer down. There is no user story
 * for "an attacker flips a byte of the ciphertext", but there is a promise that
 * it gets them nowhere — so these call the crypto directly. They run in both
 * runtimes, because both halves of the app lean on them and each gets its
 * WebCrypto from somewhere different.
 */

import { describe, expect, it } from 'vitest';
import {
	addressOf,
	decryptMessage,
	encryptMessage,
	generateIdentity,
	parseSealedBox,
	serializeSealedBox,
} from '@/shared/auth.ts';
import {
	decrypt,
	deriveLocalStorageKey,
	encrypt,
	openSeal,
	seal,
} from '@/shared/crypto.ts';
import {
	base58ToBytes,
	bytesToBase58,
	utf8ToBytes,
} from '@/shared/encoding.ts';
import {
	generateMnemonic,
	isValidMnemonic,
	mnemonicToKeyPair,
} from '@/shared/mnemonic.ts';
import {
	conversationKey,
	testIdentities,
	testIdentity,
} from '@/test/setup/crypto';

/** The canonical bip39 test phrase — a real, valid phrase with a known
 * checksum, so tests about validity don't depend on a random draw. */
const CANONICAL_PHRASE = `${'abandon '.repeat(11)}about`;

describe('the words are the account', () => {
	it('generates a valid 12-word phrase', () => {
		const mnemonic = generateMnemonic();
		expect(mnemonic.split(' ')).toHaveLength(12);
		expect(isValidMnemonic(mnemonic)).toBe(true);
	});

	it('restores the same address on another device', async () => {
		const { mnemonic, address } = await generateIdentity();
		// A second device knows nothing but the words.
		const restored = await mnemonicToKeyPair(mnemonic as string);
		expect(await addressOf(restored)).toBe(address);
	});

	it('accepts a phrase the user typed untidily', async () => {
		const mnemonic = generateMnemonic();
		const untidy = `  ${mnemonic.toUpperCase().replace(/ /g, '   ')}\n`;
		expect(isValidMnemonic(untidy)).toBe(true);
		expect(await addressOf(await mnemonicToKeyPair(untidy))).toBe(
			await addressOf(await mnemonicToKeyPair(mnemonic)),
		);
	});

	it('rejects a phrase with a mistyped word', async () => {
		const wrong = generateMnemonic().replace(/^\S+/, 'zzzz');
		expect(isValidMnemonic(wrong)).toBe(false);
		await expect(mnemonicToKeyPair(wrong)).rejects.toThrow(
			'Invalid recovery phrase',
		);
	});

	it('rejects a phrase whose checksum does not match', () => {
		// All twelve are real words in the right positions, but the last one
		// carries a checksum over the other eleven — so this is not a phrase bip39
		// ever produced, and accepting it would mean silently creating a brand-new
		// empty account for someone who mistyped their real one.
		expect(isValidMnemonic(CANONICAL_PHRASE)).toBe(true);
		expect(isValidMnemonic(`${'abandon '.repeat(12).trim()}`)).toBe(false);
	});

	it('derives the address it has always derived', async () => {
		// A known answer, pinned deliberately: the words are the only way back
		// into an account, so if this mapping ever changes, every existing user is
		// locked out of theirs. Changing it is a migration, not a refactor.
		const keyPair = await mnemonicToKeyPair(CANONICAL_PHRASE);
		expect(await addressOf(keyPair)).toBe(
			'MbxFNkbNhnJQuWkVNkaUsQjkCz6CFGRbjwdjnGLUcJkJ9UQHBebqZ9RrnwuG713hCoyQqvNFQRRWfLBYyJFdYbdw',
		);
	});

	it('gives different phrases different identities', async () => {
		const [a, b] = await testIdentities();
		expect(a.address).not.toBe(b.address);
	});

	it('never exposes the private key, even for a restored identity', async () => {
		const { keyPair } = await generateIdentity();
		// Non-extractable by construction — persisting it can't leak the identity.
		expect(keyPair.privateKey.extractable).toBe(false);
		await expect(
			crypto.subtle.exportKey('jwk', keyPair.privateKey),
		).rejects.toThrow();
	});
});

describe('only the two of you can read your conversation', () => {
	it('lets two peers agree on a key without exchanging one', async () => {
		const [alice, bob] = await testIdentities();
		// Each derives from its own private key and the other's public address —
		// and the pair is sorted internally, so the argument order doesn't matter.
		const message = 'meet me at the usual place';
		const sealed = await encrypt(await conversationKey(alice, bob), message);
		expect(await decrypt(await conversationKey(bob, alice), sealed)).toBe(
			message,
		);
	});

	it('keeps a third party out, even with both addresses in hand', async () => {
		const [alice, bob] = await testIdentities();
		const eve = await testIdentity();
		const sealed = await encrypt(await conversationKey(alice, bob), 'private');
		// Eve knows who is talking, and derives against Alice's address — but she
		// isn't Bob, so the key she gets is not the key that opened this.
		await expect(
			decrypt(await conversationKey(eve, alice), sealed),
		).rejects.toThrow();
	});

	it('binds a message to its conversation', async () => {
		const [alice, bob] = await testIdentities();
		const carol = await testIdentity();
		const sealed = await encrypt(await conversationKey(alice, bob), 'for bob');
		// Alice's key for Carol cannot open what she wrote for Bob: the pair of
		// addresses is mixed into the derivation, so each chat has its own key.
		await expect(
			decrypt(await conversationKey(alice, carol), sealed),
		).rejects.toThrow();
	});

	it('rejects a tampered ciphertext instead of returning garbage', async () => {
		const [alice, bob] = await testIdentities();
		const key = await conversationKey(alice, bob);
		const sealed = await encrypt(key, 'transfer 10');

		const bytes = base58ToBytes(sealed.ct);
		bytes[0] ^= 0xff;
		await expect(
			decrypt(key, { ...sealed, ct: bytesToBase58(bytes) }),
		).rejects.toThrow();

		const iv = base58ToBytes(sealed.iv);
		iv[0] ^= 0xff;
		await expect(
			decrypt(key, { ...sealed, iv: bytesToBase58(iv) }),
		).rejects.toThrow();
	});

	it('never reuses an IV, so identical messages look different', async () => {
		const [alice, bob] = await testIdentities();
		const key = await conversationKey(alice, bob);
		const first = await encrypt(key, 'same words');
		const second = await encrypt(key, 'same words');
		expect(first.iv).not.toBe(second.iv);
		expect(first.ct).not.toBe(second.ct);
		expect(await decrypt(key, second)).toBe('same words');
	});

	it('survives a round trip through unicode and empty text', async () => {
		const [alice, bob] = await testIdentities();
		const key = await conversationKey(alice, bob);
		// The long case is 1 KB rather than anything bigger because base58 is
		// quadratic in its input: a 10 KB payload takes ~2s to encode and ~2s to
		// decode, and 20 KB takes ~8s each way.
		for (const text of ['', 'سلام دنیا 🌍', 'a'.repeat(1_000)]) {
			expect(await decrypt(key, await encrypt(key, text))).toBe(text);
		}
	});
});

describe('what is on the device is unreadable without the account', () => {
	it('re-derives from the identity alone, with nothing else stored', async () => {
		const mnemonic = generateMnemonic();
		// Same words on a fresh device: the at-rest database must still open.
		const first = await deriveLocalStorageKey(
			await mnemonicToKeyPair(mnemonic),
		);
		const second = await deriveLocalStorageKey(
			await mnemonicToKeyPair(mnemonic),
		);
		const sealed = await encrypt(first, 'chat history');
		expect(await decrypt(second, sealed)).toBe('chat history');
	});

	it('is unreadable by any other identity', async () => {
		const [alice, bob] = await testIdentities();
		const sealed = await encrypt(
			await deriveLocalStorageKey(alice.keyPair),
			'alice history',
		);
		await expect(
			decrypt(await deriveLocalStorageKey(bob.keyPair), sealed),
		).rejects.toThrow();
	});

	it('is not the same key as a conversation with yourself', async () => {
		const alice = await testIdentity();
		// Both are self-ECDH; only the HKDF label separates them. If the labels
		// ever collided, local storage and a self-chat would share a key.
		const sealed = await encrypt(
			await deriveLocalStorageKey(alice.keyPair),
			'history',
		);
		await expect(
			decrypt(await conversationKey(alice, alice), sealed),
		).rejects.toThrow();
	});
});

describe('writing to someone you have only an address for', () => {
	it('lets anyone with an address write to it, and only its owner read', async () => {
		const [alice, bob] = await testIdentities();
		const box = await encryptMessage(bob.address, 'hello bob');
		expect(await decryptMessage(bob, box)).toBe('hello bob');
		await expect(decryptMessage(alice, box)).rejects.toThrow();
	});

	it('uses a fresh ephemeral key each time', async () => {
		const bob = await testIdentity();
		const first = await encryptMessage(bob.address, 'x');
		const second = await encryptMessage(bob.address, 'x');
		expect(first.epk).not.toBe(second.epk);
	});

	it('rejects a box resealed with a substituted ephemeral key', async () => {
		const bob = await testIdentity();
		const genuine = await seal(base58ToBytes(bob.address), utf8ToBytes('ok'));
		const forged = await seal(base58ToBytes(bob.address), utf8ToBytes('no'));
		// Swapping in another ephemeral key changes the derived key, so the GCM
		// tag fails: a box can't be recombined from parts of two others.
		await expect(
			openSeal(bob.keyPair.privateKey, { ...genuine, epk: forged.epk }),
		).rejects.toThrow();
	});

	it('round-trips through the wire format', async () => {
		const bob = await testIdentity();
		const box = await encryptMessage(bob.address, 'over the wire');
		const parsed = parseSealedBox(serializeSealedBox(box));
		expect(parsed).toEqual(box);
		expect(await decryptMessage(bob, parsed)).toBe('over the wire');
	});

	it('refuses text that is not a sealed box', () => {
		expect(() => parseSealedBox('not json')).toThrow();
		expect(() => parseSealedBox('null')).toThrow('Not a valid sealed box');
		expect(() => parseSealedBox('{"epk":"a","iv":"b"}')).toThrow(
			'Not a valid sealed box',
		);
		expect(() => parseSealedBox('{"epk":1,"iv":"b","ct":"c"}')).toThrow(
			'Not a valid sealed box',
		);
	});

	it('refuses to seal to something that is not a public key', async () => {
		// What the relay relies on to answer 400 rather than 500 for a junk
		// address on `POST /auth/challenge`.
		await expect(
			seal(base58ToBytes('deadbeef'), utf8ToBytes('x')),
		).rejects.toThrow();
	});
});
