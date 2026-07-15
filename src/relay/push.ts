import { eq } from 'drizzle-orm';
import webPush from 'web-push';
import { log } from '@/shared/log';
import type { PushPayload, PushSubscriptionJson } from '@/shared/types';
import { config } from './config.ts';
import { db } from './db/index.ts';
import { pushSubscriptions } from './db/schema.ts';

const { sendNotification, setVapidDetails, WebPushError } = webPush;

let enabled = false;

export function initPush(): void {
	if (!config.vapid) {
		return;
	}
	setVapidDetails(
		config.vapid.subject,
		config.vapid.publicKey,
		config.vapid.privateKey,
	);
	enabled = true;
}

export function vapidPublicKey(): string | null {
	return enabled ? (config.vapid?.publicKey ?? null) : null;
}

export async function saveSubscription(
	address: string,
	subscription: PushSubscriptionJson,
): Promise<void> {
	const serialized = JSON.stringify(subscription);
	await db
		.insert(pushSubscriptions)
		.values({ address, subscription: serialized })
		.onConflictDoUpdate({
			target: pushSubscriptions.address,
			set: { subscription: serialized },
		});
}

export async function deleteSubscription(address: string): Promise<void> {
	await db
		.delete(pushSubscriptions)
		.where(eq(pushSubscriptions.address, address));
}

export async function notify(
	address: string,
	payload: PushPayload,
): Promise<void> {
	if (!enabled) return;

	const [row] = await db
		.select({ subscription: pushSubscriptions.subscription })
		.from(pushSubscriptions)
		.where(eq(pushSubscriptions.address, address))
		.limit(1);
	if (!row) return;

	const subscription = JSON.parse(row.subscription) as PushSubscriptionJson;
	try {
		await sendNotification(subscription, JSON.stringify(payload));
	} catch (err) {
		if (
			err instanceof WebPushError &&
			(err.statusCode === 404 || err.statusCode === 410)
		) {
			await deleteSubscription(address);
			log('info', 'push subscription expired, pruned', address);
			return;
		}
		log('warn', 'push send failed', address, err);
	}
}
