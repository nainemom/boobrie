/**
 * Web Push — client side.
 *
 * Two separate concerns, deliberately not bundled into one call:
 *   - Notification *permission* is a per-origin browser setting. Once denied,
 *     re-requesting it from script can't reopen the prompt — only the user can
 *     fix that in browser settings.
 *   - The *subscription* is this device registering (or unregistering) itself
 *     as the relay's push target. It requires permission to already be
 *     granted, but is otherwise independent — a user can hold permission
 *     without being subscribed (e.g. after clicking "unsubscribe").
 *
 * {@link subscribeToPush} hands back the subscription to send over the socket
 * (`{ t: 'push' }`); the relay stores exactly one per address, so whichever
 * device subscribes last becomes the push target. {@link unsubscribeFromPush}
 * only undoes the browser side — the caller still owes the relay a
 * `{ t: 'unpush' }` so it forgets the target too.
 *
 * Client-only (like relay.ts): the relay never registers service workers.
 */

import type { PushSubscriptionJson } from '@/shared/types';

/** Whether this browser can do Web Push at all. */
export function pushSupported(): boolean {
	return (
		'serviceWorker' in navigator &&
		'PushManager' in window &&
		'Notification' in window
	);
}

/** The current notification permission, or 'unsupported' where there is none. */
export function notificationPermission():
	| NotificationPermission
	| 'unsupported' {
	return pushSupported() ? Notification.permission : 'unsupported';
}

/**
 * Ask the browser for notification permission. Call this from a user gesture
 * (a click handler) — browsers ignore the prompt otherwise. A no-op resolving
 * to the current state if permission was already decided one way or the other.
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
	if (!pushSupported()) {
		throw new Error('Push notifications are not supported in this browser.');
	}
	return Notification.requestPermission();
}

/**
 * Register the service worker (idempotent — the browser dedupes by URL) and
 * resolve once it is active. Safe to call on every load.
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
	await navigator.serviceWorker.register('/sw.js');
	return navigator.serviceWorker.ready;
}

/** VAPID keys travel as URL-safe base64; the Push API wants the raw bytes. */
function urlBase64ToBytes(base64: string): Uint8Array {
	const padding = '='.repeat((4 - (base64.length % 4)) % 4);
	const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
	const raw = atob(normalized);
	const bytes = new Uint8Array(raw.length);
	for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
	return bytes;
}

/**
 * This device's existing push subscription, if any — read-only, no permission
 * prompt and no new subscription created. Used to reflect true state in the UI
 * (e.g. after a reload) without re-asking the user for anything.
 */
export async function existingPushSubscription(): Promise<PushSubscriptionJson | null> {
	if (!pushSupported() || Notification.permission !== 'granted') return null;
	const registration = await registerServiceWorker();
	const subscription = await registration.pushManager.getSubscription();
	return subscription ? (subscription.toJSON() as PushSubscriptionJson) : null;
}

/**
 * Subscribe this device for push, reusing an existing subscription when there
 * is one. Returns the subscription to register with the relay.
 *
 * Requires notification permission to already be granted — call
 * {@link requestNotificationPermission} first. Kept separate so a caller can
 * offer "grant permission" and "subscribe" as distinct steps.
 */
export async function subscribeToPush(
	vapidPublicKey: string,
): Promise<PushSubscriptionJson> {
	if (!pushSupported()) {
		throw new Error('Push notifications are not supported in this browser.');
	}
	if (Notification.permission !== 'granted') {
		throw new Error('Notification permission has not been granted yet.');
	}

	const registration = await registerServiceWorker();
	const existing = await registration.pushManager.getSubscription();
	const subscription =
		existing ??
		(await registration.pushManager.subscribe({
			userVisibleOnly: true,
			applicationServerKey: urlBase64ToBytes(vapidPublicKey) as BufferSource,
		}));

	return subscription.toJSON() as PushSubscriptionJson;
}

/**
 * Unsubscribe this device from push, browser-side only. The caller is still
 * responsible for sending `{ t: 'unpush' }` so the relay forgets this device
 * as its push target.
 */
export async function unsubscribeFromPush(): Promise<void> {
	if (!pushSupported()) return;
	const registration = await registerServiceWorker();
	const subscription = await registration.pushManager.getSubscription();
	if (subscription) await subscription.unsubscribe();
}
