import { ofetch } from 'ofetch';
import { db } from '@/client/db';
import { env } from '@/client/env';
import { clearLocalKeyCache } from '@/client/services/chat';
import { unsubscribeFromPush } from '@/client/services/push';
import { editPushSubscription } from '@/client/services/relay';
import {
	createExternalState,
	useExternalState,
} from '@/client/utils/externalState';
import { addressOf, type Identity } from '@/shared/auth';
import { openSeal } from '@/shared/crypto';
import { bytesToBase58 } from '@/shared/encoding';
import { mnemonicToKeyPair } from '@/shared/mnemonic';
import type { ChallengeResponse, VerifyResponse } from '@/shared/protocol';

export { generateIdentity as generate } from '@/shared/auth';

// --- reactive session state -------------------------------------------

export interface RelaySession {
	token: string;
	expiresAt: number;
	address: string;
}

interface AuthState {
	identity: Identity | null;
	session: RelaySession | null;
}

export const authState = createExternalState<AuthState>({
	identity: null,
	session: null,
});

export const useAuth = () => useExternalState(authState);

// --- relay handshake ------------------------------------------------------

const api = ofetch.create({
	baseURL: env.CLIENT_RELAY_URL,
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

	authState.set({ identity, session });
	return identity;
}

// --- actions ---------------------------------------------------------------

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
	// Delete the key before clearing state: clearing state remounts the auth
	// modal's session restorer immediately, and it must find no key to load —
	// otherwise it races this delete and can kick off a fresh authenticate()
	// right as we're logging out.
	await deleteKeyPair();
	clearLocalKeyCache();
	authState.set({ identity: null, session: null });
}

/** Re-authenticate from the saved keypair — at boot, and again any time the
 * relay stops honoring the current session (e.g. after a 401). Concurrent
 * callers share one attempt, but each new call runs a fresh one: nothing here
 * remembers a past result past the point where it settles. */
let restoring: Promise<boolean> | null = null;
export function restore(): Promise<boolean> {
	if (!restoring) {
		restoring = (async () => {
			try {
				const keyPair = await loadKeyPair().catch(() => undefined);
				if (!keyPair) return false;
				try {
					await authenticate(keyPair);
					return true;
				} catch {
					await deleteKeyPair();
					return false;
				}
			} finally {
				restoring = null;
			}
		})();
	}
	return restoring;
}
