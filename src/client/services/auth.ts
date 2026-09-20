import { liveQuery } from 'dexie';
import { ofetch } from 'ofetch';
import { db, deviceIdFor, type StoredKeyPair } from '@/client/db';
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

const saveKeyPair = (
	keyPair: CryptoKeyPair,
	address: string,
): Promise<string> => db.auth.put({ keyPair, address }, KEY_ID);

const loadKeyPair = (): Promise<StoredKeyPair | undefined> =>
	db.auth.get(KEY_ID);

const deleteKeyPair = (): Promise<void> => db.auth.delete(KEY_ID);

/** How a sign-out reaches the other tabs: the one key-pair slot is shared, so
 * writing to it is the announcement, and Dexie carries it to every tab. A tab
 * loses its session when the slot is emptied, and equally when another account
 * logs in over it — a browser holds one account, newest login wins. */
liveQuery(() => db.auth.get(KEY_ID)).subscribe({
	next: (stored) => {
		const identity = authState.state.identity;
		if (!identity || stored?.address === identity.address) return;
		clearLocalKeyCache();
		authState.set({ identity: null, session: null });
	},
	error: (error) => console.error('Sign-out watch failed:', error),
});

/** Run the relay handshake and put the resulting session in state. */
async function authenticate(
	keyPair: CryptoKeyPair,
	/** Logging in, not coming back — takes the account from the device that had
	 * it. Restoring never claims, or the laptop left at home would sign the phone
	 * out on being opened. */
	claim: boolean,
	mnemonic?: string,
	handle?: string,
): Promise<Identity> {
	const identity: Identity = {
		keyPair,
		address: await addressOf(keyPair),
		mnemonic,
	};
	const deviceId = await deviceIdFor(identity.address);
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
		body: {
			challengeToken,
			response: bytesToBase58(nonce),
			handle,
			deviceId,
			claim,
		},
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
	// Typing the words in is the deliberate act that moves an account.
	const identity = await authenticate(keyPair, true, mnemonic, handle);
	await saveKeyPair(keyPair, identity.address);
	return identity;
}

/** Sign out deliberately: everything {@link relinquish} does, plus telling the
 * relay to stop pushing to this account at all. */
export async function logout(): Promise<void> {
	// While the session is still live: the relay call needs the current token.
	try {
		await editPushSubscription({ pushSubscription: null });
	} catch (error) {
		console.error('Failed to remove push subscription:', error);
	}
	await relinquish();
}

/** Sign out because the account was signed in somewhere else. The relay's push
 * subscription stays: it belongs to the device that took the account now. */
export async function relinquish(): Promise<void> {
	// Not awaited: `serviceWorker.ready` inside never settles when no worker
	// activates for this scope, and a sign-out must not hang there.
	void unsubscribeFromPush().catch((error) =>
		console.error('Failed to remove push subscription:', error),
	);

	// Before clearing state, which remounts the session restorer: it must find no
	// key, or it re-authenticates on the way out.
	try {
		await deleteKeyPair();
	} catch (error) {
		// The session goes regardless; a key that outlives it only fails a restore.
		console.error('Failed to delete the saved key pair:', error);
	}
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
				const stored = await loadKeyPair().catch(() => undefined);
				if (!stored?.keyPair) return false;
				try {
					await authenticate(stored.keyPair, false);
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
