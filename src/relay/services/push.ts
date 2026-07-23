import { defineHandler, readValidatedBody } from 'h3';
import webPush from 'web-push';
import { log } from '@/shared/log';
import {
	type EditPushSubscriptionResponse,
	editPushSubscriptionSchema,
} from '@/shared/protocol.ts';
import type { PushPayload, PushSubscriptionJson } from '@/shared/types';
import { config } from '../config.ts';
import { db } from '../db/index.ts';

const { sendNotification, setVapidDetails, WebPushError } = webPush;

let enabled = false;

export const initPush = (): void => {
	if (!config.vapid) return;
	setVapidDetails(
		config.vapid.subject,
		config.vapid.publicKey,
		config.vapid.privateKey,
	);
	enabled = true;
};

export const vapidPublicKey = (): string | null =>
	enabled ? (config.vapid?.publicKey ?? null) : null;

export const saveSubscription = async (
	address: string,
	subscription: PushSubscriptionJson,
) => {
	const serialized = JSON.stringify(subscription);
	return await db.pushSubscription.upsert({
		where: { address },
		create: { address, subscription: serialized },
		update: { subscription: serialized },
	});
};

export const deleteSubscription = async (address: string) => {
	return await db.pushSubscription.deleteMany({ where: { address } });
};

export const editPushSubscriptionHandler = defineHandler(async (event) => {
	const address = event.context.claim?.address || '';
	const { pushSubscription } = await readValidatedBody(
		event,
		editPushSubscriptionSchema,
	);

	if (pushSubscription === null) {
		await deleteSubscription(address);
	} else {
		await saveSubscription(address, pushSubscription);
	}

	return {
		pushSubscription,
	} satisfies EditPushSubscriptionResponse;
});

export const getSubscription = async (
	address: string,
): Promise<PushSubscriptionJson | null> => {
	const row = await db.pushSubscription.findUnique({
		where: { address },
		select: { subscription: true },
	});
	if (!row) return null;
	try {
		return JSON.parse(row.subscription) as PushSubscriptionJson;
	} catch {
		return null;
	}
};

export const notify = async (
	address: string,
	payload: PushPayload,
): Promise<void> => {
	if (!enabled) return;

	const subscription = await getSubscription(address);
	if (!subscription) return;

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
};
