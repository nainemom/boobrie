/**
 * The profile & push store: the user's relay profile (handle, VAPID key) and
 * this device's Web Push wiring. Who you are — identity + session token — lives
 * in the auth service ({@link file://./services/auth.ts}); this store *reacts*
 * to it, fetching the profile and reasserting push when a session appears and
 * clearing everything when it goes.
 *
 * Chat lives elsewhere now: the UI reads and writes the local database via
 * {@link file://./services/chat.ts}, and the always-on
 * {@link file://./services/sync.ts} service moves messages between that database
 * and the relay. Pages read this store with {@link useStore}.
 */

import { useSyncExternalStore } from 'react';
import type { Identity } from '@/shared/auth';
import {
	existingPushSubscription,
	notificationPermission,
	requestNotificationPermission,
	subscribeToPush,
	unsubscribeFromPush,
} from './push';
import { editPushSubscription, getMe, updateHandle } from './relay';
import {
	getIdentity,
	getSession,
	type RelaySession,
	subscribe as subscribeAuth,
} from './services/auth';

/** Where the relay lives. Set VITE_RELAY_URL in .env to point elsewhere. */
export const RELAY_URL =
	import.meta.env.VITE_RELAY_URL ?? 'http://localhost:5200';

type PushStatus =
	| 'idle'
	| 'subscribing'
	| 'subscribed'
	| 'unsubscribing'
	| 'error';

interface State {
	identity: Identity | null;
	session: RelaySession | null;
	handle: string | null;
	vapidPublicKey: string | null;
	permission: NotificationPermission | 'unsupported';
	pushStatus: PushStatus;
	pushError: string | null;
}

const initialState: State = {
	identity: null,
	session: null,
	handle: null,
	vapidPublicKey: null,
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

export function useStore(): State {
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
function reassertPushSubscription(session: RelaySession): void {
	void existingPushSubscription().then((subscription) => {
		if (!subscription) {
			set({ pushStatus: 'idle' });
			return;
		}
		editPushSubscription(RELAY_URL, session.token, subscription)
			.then(() => set({ pushStatus: 'subscribed' }))
			.catch((error) => {
				// The browser still holds its subscription, but the relay didn't
				// record it — reflect that instead of claiming we're subscribed
				// when the relay has nothing on file to push to.
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
	set({
		...initialState,
		permission: state.permission,
		identity,
		session,
	});
	try {
		const me = await getMe(RELAY_URL, session.token);
		set({ handle: me.handle, vapidPublicKey: me.vapidPublicKey });
	} catch (error) {
		console.error('Failed to fetch user profile:', error);
	}
	reassertPushSubscription(session);
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

export async function changeHandle(handle: string): Promise<void> {
	if (!state.session) throw new Error('Not authenticated.');
	const res = await updateHandle(RELAY_URL, state.session.token, handle);
	set({ handle: res.handle });
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
	if (!state.vapidPublicKey || !state.session) return;
	set({ pushError: null, pushStatus: 'subscribing' });
	try {
		const subscription = await subscribeToPush(state.vapidPublicKey);
		await editPushSubscription(RELAY_URL, state.session.token, subscription);
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
		await editPushSubscription(RELAY_URL, state.session.token, null);
		set({ pushStatus: 'idle' });
	} catch (error) {
		set({
			pushError: error instanceof Error ? error.message : String(error),
			pushStatus: 'error',
		});
	}
}
