/**
 * All client state, in memory only — no localStorage, no persistence. A page
 * refresh means a fresh login (see the "no local storage" rule this app
 * follows for auth/chats). Pages read it with {@link useStore} and act on it
 * through the exported functions below; the message stream and push wiring
 * run here so they survive navigating between pages.
 */

import { useSyncExternalStore } from 'react';
import { createIdentity, type Identity, recoverIdentity } from '@/shared/auth';
import type { Message } from '@/shared/protocol';
import type { ChatMessage } from '@/shared/types';
import { decryptFrom, encryptFor } from './chat';
import {
	existingPushSubscription,
	notificationPermission,
	requestNotificationPermission,
	subscribeToPush,
	unsubscribeFromPush,
} from './push';
import {
	authenticate,
	editPushSubscription,
	getMe,
	type MessageStream,
	type RelaySession,
	readMessage,
	sendMessage,
	streamMessages,
	updateHandle,
} from './relay';

/** Where the relay lives. Set VITE_RELAY_URL in .env to point elsewhere. */
export const RELAY_URL =
	import.meta.env.VITE_RELAY_URL ?? 'http://localhost:5200';

type StreamStatus =
	| 'idle'
	| 'authenticating'
	| 'connecting'
	| 'connected'
	| 'closed'
	| 'error';

type PushStatus =
	| 'idle'
	| 'subscribing'
	| 'subscribed'
	| 'unsubscribing'
	| 'error';

interface State {
	identity: Identity | null;
	session: RelaySession | null;
	status: StreamStatus;
	error: string | null;
	handle: string;
	vapidPublicKey: string | null;
	permission: NotificationPermission | 'unsupported';
	pushStatus: PushStatus;
	pushError: string | null;
	messages: ChatMessage[];
	/** Peer addresses, in the order they were first seen. */
	conversations: string[];
}

const initialState: State = {
	identity: null,
	session: null,
	status: 'idle',
	error: null,
	handle: '',
	vapidPublicKey: null,
	permission: notificationPermission(),
	pushStatus: 'idle',
	pushError: null,
	messages: [],
	conversations: [],
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

let stream: MessageStream | null = null;
// Ids already shown — delivery is at-least-once, so guard against redelivery.
const seenIncoming = new Set<string>();

function closeStream(): void {
	stream?.close();
	stream = null;
}

export function addConversation(peer: string): void {
	if (state.conversations.includes(peer)) return;
	set({ conversations: [...state.conversations, peer] });
}

function handleIncoming(
	identity: Identity,
	session: RelaySession,
	message: Message,
): void {
	// Ack unconditionally so the relay drops its copy, even for a dup.
	readMessage(RELAY_URL, session.token, message.id).catch((error) =>
		console.error('Failed to ack message:', error),
	);
	if (seenIncoming.has(message.id)) return;
	seenIncoming.add(message.id);
	decryptFrom(identity, message.sender, message.payload)
		.then((body) => {
			addConversation(message.sender);
			set({
				messages: [
					...state.messages,
					{
						id: message.id,
						peer: message.sender,
						direction: 'in',
						body,
						at: new Date(message.createdAt).getTime(),
					},
				],
			});
		})
		.catch((error) => console.error('Failed to decrypt message:', error));
}

// Once connected, reflect whether this device already has a push subscription
// — and if so, reassert it with the relay (a fresh session may mean the relay
// forgot the target, or another device took it over). Never creates a new
// subscription or prompts for permission; that only happens via the explicit
// actions below.
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

async function login(identity: Identity): Promise<void> {
	closeStream();
	seenIncoming.clear();
	set({
		...initialState,
		permission: state.permission,
		identity,
		status: 'authenticating',
	});
	try {
		const session = await authenticate(RELAY_URL, identity);
		set({ session });

		try {
			const me = await getMe(RELAY_URL, session.token);
			set({ handle: me.handle, vapidPublicKey: me.vapidPublicKey });
		} catch (error) {
			console.error('Failed to fetch user profile:', error);
		}

		set({ status: 'connecting' });
		stream = streamMessages(RELAY_URL, session.token, {
			onOpen: () => {
				set({ status: 'connected' });
				reassertPushSubscription(session);
			},
			onMessage: (message) => handleIncoming(identity, session, message),
			onClose: () => set({ status: 'closed' }),
			onError: () => {
				set({
					status: 'error',
					error: 'Message stream failed (token rejected?).',
				});
			},
		});
	} catch (error) {
		set({
			identity: null,
			status: 'error',
			error: error instanceof Error ? error.message : String(error),
		});
		throw error;
	}
}

/** Generate a brand-new account and log in with it. Returns the identity so the
 * caller can show its recovery phrase once. */
export async function loginWithNewIdentity(): Promise<Identity> {
	const identity = await createIdentity();
	await login(identity);
	return identity;
}

/** Commit an already-created identity as the session. Used when the caller has
 * generated a draft identity, let the user preview it (e.g. its signature), and
 * only now — on accept — wants to authenticate with the relay. */
export async function loginWithIdentity(identity: Identity): Promise<void> {
	await login(identity);
}

/** Rebuild an account from its 12 words and log in with it. Throws if the words
 * aren't a valid recovery phrase or the relay rejects the proof. */
export async function loginWithMnemonic(mnemonic: string): Promise<void> {
	const identity = await recoverIdentity(mnemonic);
	await login(identity);
}

export async function sendChat(peer: string, body: string): Promise<void> {
	if (!state.identity || !state.session) {
		throw new Error('Not authenticated.');
	}
	const payload = await encryptFor(state.identity, peer, body);
	const message = await sendMessage(
		RELAY_URL,
		state.session.token,
		peer,
		payload,
	);
	addConversation(peer);
	set({
		messages: [
			...state.messages,
			{
				id: message.id,
				peer,
				direction: 'out',
				body,
				at: new Date(message.createdAt).getTime(),
			},
		],
	});
}

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
