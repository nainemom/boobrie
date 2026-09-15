/**
 * The user service: everything about *who you are on the relay* — your profile
 * (handle, discoverability, VAPID key) and this device's Web Push wiring. The
 * relay calls it drives live in {@link file://./relay.ts}. A handle is claimed
 * once at sign-up and never edited, so it is read here but never written.
 *
 * Identity and session (the mnemonic-derived key pair and its relay token) live
 * in the auth service ({@link file://./auth.ts}); this service *reacts* to it,
 * fetching your profile and reasserting push when a session appears and clearing
 * everything when it goes. Pages read the reactive slice with {@link useUser}.
 *
 * Chat lives elsewhere: {@link file://./chat.ts} owns conversations and
 * messages, and {@link file://./sync.ts} bridges them to the relay.
 */

import type { Identity } from '@/shared/auth';
import type { MeResponse } from '@/shared/protocol';
import { errorMessage } from '../utils/errors';
import { createExternalState, useExternalState } from '../utils/externalState';
import { authState, type RelaySession } from './auth';
import {
	existingPushSubscription,
	notificationPermission,
	requestNotificationPermission,
	subscribeToPush,
	unsubscribeFromPush,
} from './push';
import { editPushSubscription, getMe, setDiscoverable } from './relay';

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

const userState = createExternalState<State>(initialState);

/** The reactive user slice: identity, profile, membership, and push state. */
export const useUser = () => useExternalState(userState);

// Once a session is up, reflect whether this device already has a push
// subscription — and if so, reassert it with the relay (a fresh session may
// mean the relay forgot the target, or another device took it over). Never
// creates a new subscription or prompts for permission; that only happens via
// the explicit actions below.
function reassertPushSubscription(): void {
	void existingPushSubscription().then((subscription) => {
		if (!subscription) {
			userState.patch({ pushStatus: 'idle' });
			return;
		}
		editPushSubscription({ pushSubscription: subscription })
			.then(() => userState.patch({ pushStatus: 'subscribed' }))
			.catch((error) => {
				// The browser still holds its subscription, but the relay didn't
				// record it — reflect that instead of claiming we're subscribed when
				// the relay has nothing on file to push to.
				console.error('Failed to reassert push subscription:', error);
				userState.patch({
					pushStatus: 'error',
					pushError: errorMessage(error),
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
	userState.set({
		...initialState,
		permission: userState.state.permission,
		identity,
		session,
	});
	try {
		userState.patch({ me: await getMe() });
	} catch (error) {
		console.error('Failed to fetch user profile:', error);
	}
	reassertPushSubscription();
}

/** Tear the session down and return to a clean logged-out state. */
function disconnect(): void {
	userState.set({ ...initialState, permission: userState.state.permission });
}

// The token we last connected for — so a new session reconnects but repeat
// notifications for the same one are ignored.
let connectedToken: string | null = null;

function syncFromAuth(): void {
	const { identity, session } = authState.state;
	if (identity && session) {
		if (session.token === connectedToken) return;
		connectedToken = session.token;
		void connect(identity, session);
	} else if (connectedToken !== null) {
		connectedToken = null;
		disconnect();
	}
}

authState.subscribe(syncFromAuth);
// Pick up a session that auto-login may have restored before this module ran.
syncFromAuth();

// --- actions ---------------------------------------------------------------

export async function changeDiscoverable(discoverable: boolean): Promise<void> {
	const res = await setDiscoverable({ discoverable });
	const { me } = userState.state;
	userState.patch({ me: me ? { ...me, discoverable: res.discoverable } : me });
}

/** Subscribe this device in one step: request notification permission if it
 * hasn't been decided yet, then register the push subscription. Call from a
 * user gesture (a click handler) — browsers ignore the permission prompt
 * otherwise. A no-op once permission is denied or unsupported; that's
 * reflected through `permission`, not a thrown error. */
export async function subscribeDevice(): Promise<void> {
	userState.patch({ pushError: null });
	let { permission } = userState.state;
	if (permission !== 'granted') {
		try {
			permission = await requestNotificationPermission();
			userState.patch({ permission });
		} catch (error) {
			userState.patch({ pushError: errorMessage(error) });
			return;
		}
	}
	if (permission !== 'granted') return;
	await enablePush();
}

async function enablePush(): Promise<void> {
	const { me, session } = userState.state;
	const vapidPublicKey = me?.vapidPublicKey;
	if (!vapidPublicKey || !session) return;
	userState.patch({ pushError: null, pushStatus: 'subscribing' });
	try {
		const subscription = await subscribeToPush(vapidPublicKey);
		await editPushSubscription({ pushSubscription: subscription });
		userState.patch({ pushStatus: 'subscribed' });
	} catch (error) {
		userState.patch({ pushError: errorMessage(error), pushStatus: 'error' });
	}
}

export async function disablePush(): Promise<void> {
	if (!userState.state.session) return;
	userState.patch({ pushError: null, pushStatus: 'unsubscribing' });
	try {
		await unsubscribeFromPush();
		await editPushSubscription({ pushSubscription: null });
		userState.patch({ pushStatus: 'idle' });
	} catch (error) {
		userState.patch({ pushError: errorMessage(error), pushStatus: 'error' });
	}
}
