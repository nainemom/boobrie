/**
 * The user service: everything about *who you are on the relay* — your profile
 * (handle, membership, VAPID key) and this device's Web Push wiring — plus
 * looking other users up by address or handle.
 *
 * Identity and session (the mnemonic-derived key pair and its relay token) live
 * in the auth service ({@link file://./auth.ts}); this service *reacts* to it,
 * fetching your profile and reasserting push when a session appears and clearing
 * everything when it goes. Pages read the reactive slice with {@link useUser}.
 *
 * Chat lives elsewhere: {@link file://./chat.ts} owns conversations and
 * messages, and {@link file://./sync.ts} bridges them to the relay.
 */

import { useSyncExternalStore } from 'react';
import type { Identity } from '@/shared/auth';
import type {
	CreateDepositRequest,
	CreateDepositResponse,
	EditHandleRequest,
	EditHandleResponse,
	EditPushSubscriptionRequest,
	EditPushSubscriptionResponse,
	MeResponse,
	UserResponse,
} from '@/shared/protocol';
import type { PushSubscriptionJson } from '@/shared/types';
import { authHeaders, jsonHeaders, request } from '../utils/request';
import {
	getIdentity,
	getSession,
	type RelaySession,
	subscribe as subscribeAuth,
} from './auth';
import {
	existingPushSubscription,
	notificationPermission,
	requestNotificationPermission,
	subscribeToPush,
	unsubscribeFromPush,
} from './push';

// --- relay calls -----------------------------------------------------------
// Each presents the current session token; they throw if there isn't one.

function requireToken(): string {
	const token = getSession()?.token;
	if (!token) throw new Error('Not authenticated.');
	return token;
}

/** This account's own profile — handle, membership, VAPID key. */
export function getMe(): Promise<MeResponse> {
	return request('/auth/me', { headers: authHeaders(requireToken()) });
}

/** Set (or clear, with `null`) this account's handle. */
export function updateHandle(
	handle: string | null,
): Promise<EditHandleResponse> {
	return request('/auth/me/handle', {
		method: 'PATCH',
		headers: jsonHeaders(requireToken()),
		body: JSON.stringify({ handle } satisfies EditHandleRequest),
	});
}

/** Register (or clear, with `null`) this device's push subscription. */
export function editPushSubscription(
	pushSubscription: PushSubscriptionJson | null,
): Promise<EditPushSubscriptionResponse> {
	return request('/auth/me/push-subscription', {
		method: 'PUT',
		headers: jsonHeaders(requireToken()),
		body: JSON.stringify({
			pushSubscription,
		} satisfies EditPushSubscriptionRequest),
	});
}

/** Resolve a handle to its owner's public profile. */
export function getHandle(handle: string): Promise<UserResponse> {
	return request(`/handles/${encodeURIComponent(handle)}`, {
		headers: authHeaders(requireToken()),
	});
}

/** Another user's public profile, by address. */
export function getUser(address: string): Promise<UserResponse> {
	return request(`/users/${encodeURIComponent(address)}`, {
		headers: authHeaders(requireToken()),
	});
}

/** Open a USDT deposit for `amount` (USD); returns where and how much to send.
 * The account becomes paid once the provider confirms the transfer on-chain
 * (see `paid`/`paidUntil` on {@link getMe}). */
export function createDeposit(amount: number): Promise<CreateDepositResponse> {
	return request('/billing/deposit', {
		method: 'POST',
		headers: jsonHeaders(requireToken()),
		body: JSON.stringify({ amount } satisfies CreateDepositRequest),
	});
}

// --- reactive profile & push state -----------------------------------------

type PushStatus =
	| 'idle'
	| 'subscribing'
	| 'subscribed'
	| 'unsubscribing'
	| 'error';

interface State {
	identity: Identity | null;
	session: RelaySession | null;
	/** This account's relay profile, once fetched. */
	me: MeResponse | null;
	permission: NotificationPermission | 'unsupported';
	pushStatus: PushStatus;
	pushError: string | null;
}

const initialState: State = {
	identity: null,
	session: null,
	me: null,
	permission: notificationPermission(),
	pushStatus: 'idle',
	pushError: null,
};

let state: State = initialState;
const listeners = new Set<() => void>();

function set(patch: Partial<State>): void {
	state = { ...state, ...patch };
	for (const listener of listeners) listener();
}

/** The reactive user slice: identity, profile, membership, and push state. */
export function useUser(): State {
	return useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		() => state,
	);
}

// Once a session is up, reflect whether this device already has a push
// subscription — and if so, reassert it with the relay (a fresh session may
// mean the relay forgot the target, or another device took it over). Never
// creates a new subscription or prompts for permission; that only happens via
// the explicit actions below.
function reassertPushSubscription(): void {
	void existingPushSubscription().then((subscription) => {
		if (!subscription) {
			set({ pushStatus: 'idle' });
			return;
		}
		editPushSubscription(subscription)
			.then(() => set({ pushStatus: 'subscribed' }))
			.catch((error) => {
				// The browser still holds its subscription, but the relay didn't
				// record it — reflect that instead of claiming we're subscribed when
				// the relay has nothing on file to push to.
				console.error('Failed to reassert push subscription:', error);
				set({
					pushStatus: 'error',
					pushError: error instanceof Error ? error.message : String(error),
				});
			});
	});
}

// --- react to the auth service ---------------------------------------------

/** Bring the session up: fetch the profile and reassert push. */
async function connect(
	identity: Identity,
	session: RelaySession,
): Promise<void> {
	set({ ...initialState, permission: state.permission, identity, session });
	try {
		set({ me: await getMe() });
	} catch (error) {
		console.error('Failed to fetch user profile:', error);
	}
	reassertPushSubscription();
}

/** Tear the session down and return to a clean logged-out state. */
function disconnect(): void {
	set({ ...initialState, permission: state.permission });
}

// The token we last connected for — so a new session reconnects but repeat
// notifications for the same one are ignored.
let connectedToken: string | null = null;

function syncFromAuth(): void {
	const identity = getIdentity();
	const session = getSession();
	if (identity && session) {
		if (session.token === connectedToken) return;
		connectedToken = session.token;
		void connect(identity, session);
	} else if (connectedToken !== null) {
		connectedToken = null;
		disconnect();
	}
}

subscribeAuth(syncFromAuth);
// Pick up a session that auto-login may have restored before this module ran.
syncFromAuth();

// --- actions ---------------------------------------------------------------

export async function changeHandle(handle: string): Promise<void> {
	const res = await updateHandle(handle);
	set({ me: state.me ? { ...state.me, handle: res.handle } : state.me });
}

/** Ask the browser for notification permission. Call from a user gesture (a
 * click handler) — browsers ignore the prompt otherwise. */
export async function grantPermission(): Promise<void> {
	set({ pushError: null });
	try {
		set({ permission: await requestNotificationPermission() });
	} catch (error) {
		set({ pushError: error instanceof Error ? error.message : String(error) });
	}
}

export async function enablePush(): Promise<void> {
	const vapidPublicKey = state.me?.vapidPublicKey;
	if (!vapidPublicKey || !state.session) return;
	set({ pushError: null, pushStatus: 'subscribing' });
	try {
		const subscription = await subscribeToPush(vapidPublicKey);
		await editPushSubscription(subscription);
		set({ pushStatus: 'subscribed' });
	} catch (error) {
		set({
			pushError: error instanceof Error ? error.message : String(error),
			pushStatus: 'error',
		});
	}
}

export async function disablePush(): Promise<void> {
	if (!state.session) return;
	set({ pushError: null, pushStatus: 'unsubscribing' });
	try {
		await unsubscribeFromPush();
		await editPushSubscription(null);
		set({ pushStatus: 'idle' });
	} catch (error) {
		set({
			pushError: error instanceof Error ? error.message : String(error),
			pushStatus: 'error',
		});
	}
}
