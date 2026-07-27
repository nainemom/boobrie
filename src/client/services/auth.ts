import { ofetch } from 'ofetch';
import { useSyncExternalStore } from 'react';
import { addressOf, type Identity } from '@/shared/auth';
import { openSeal } from '@/shared/crypto';
import { bytesToBase58 } from '@/shared/encoding';
import { mnemonicToKeyPair } from '@/shared/mnemonic';
import type { ChallengeResponse, VerifyResponse } from '@/shared/protocol';
import { db } from '../db';
import { createExternalStore } from '../utils/react';
import { unsubscribeFromPush } from './push';
import { editPushSubscription } from './relay';

export { generateIdentity as generate } from '@/shared/auth';

const RELAY_URL = import.meta.env.VITE_RELAY_URL ?? 'http://localhost:5200';

const api = ofetch.create({
	baseURL: RELAY_URL,
	headers: { 'content-type': 'application/json' },
	retry: 3,
	retryDelay: 3000,
	retryStatusCodes: [408, 425, 429, 500, 502, 503, 504],
});

const KEY_ID = 'keyPair';

const saveKeyPair = (keyPair: CryptoKeyPair): Promise<string> =>
	db.auth.put(keyPair, KEY_ID);

const loadKeyPair = (): Promise<CryptoKeyPair | undefined> =>
	db.auth.get(KEY_ID);

const deleteKeyPair = (): Promise<void> => db.auth.delete(KEY_ID);

/** A proven session: the token to present to the relay, and when it expires. */
export interface RelaySession {
	token: string;
	expiresAt: number;
	address: string;
}

interface AuthState {
	identity: Identity | null;
	session: RelaySession | null;
}

const { state, subscribe, set } = createExternalStore<AuthState>({
	identity: null,
	session: null,
});

export { subscribe };

export const getIdentity = (): Identity | null => state.identity;
export const getSession = (): RelaySession | null => state.session;

export const useToken = () =>
	useSyncExternalStore(subscribe, () => state.session?.token ?? null);

export const useIdentity = () =>
	useSyncExternalStore(subscribe, () => state.identity);

async function authenticate(
	keyPair: CryptoKeyPair,
	mnemonic?: string,
	handle?: string,
): Promise<Identity> {
	const identity: Identity = {
		keyPair,
		address: await addressOf(keyPair),
		mnemonic,
	};
	const { challengeToken, box } = await api<ChallengeResponse>(
		'/auth/challenge',
		{
			method: 'POST',
			body: { address: identity.address },
		},
	);
	const nonce = await openSeal(identity.keyPair.privateKey, box);
	const authResult = await api<VerifyResponse>('/auth/verify', {
		method: 'POST',
		body: { challengeToken, response: bytesToBase58(nonce), handle },
	});
	const session = {
		token: authResult.token,
		expiresAt: authResult.expiresAt,
		address: identity.address,
	};

	set({ identity, session });
	return identity;
}

export interface LoginParams {
	mnemonic: string;
	handle?: string;
}

export async function login({
	mnemonic,
	handle,
}: LoginParams): Promise<Identity> {
	const keyPair = await mnemonicToKeyPair(mnemonic);
	const identity = await authenticate(keyPair, mnemonic, handle);
	await saveKeyPair(keyPair);
	return identity;
}

export async function logout(): Promise<void> {
	// Unsubscribe while the session is still live — the relay call needs the
	// current token, and it's gone the moment `set` below clears it.
	try {
		await unsubscribeFromPush();
		await editPushSubscription({ pushSubscription: null });
	} catch (error) {
		console.error('Failed to remove push subscription:', error);
	}
	set({ identity: null, session: null });
	await deleteKeyPair();
}

let restoring: Promise<boolean> | null = null;
export function restore(): Promise<boolean> {
	if (!restoring) {
		restoring = (async () => {
			const keyPair = await loadKeyPair().catch(() => undefined);
			if (!keyPair) return false;
			try {
				await authenticate(keyPair);
				return true;
			} catch {
				await deleteKeyPair();
				return false;
			}
		})();
	}
	return restoring;
}
