import { eq } from 'drizzle-orm';
import { defineMiddleware, HTTPError } from 'h3';
import { type Feature, FLAG_FEATURES, type Flag } from '@/shared/types';
import { db } from '../db/index.ts';
import { userFlags } from '../db/schema.ts';

export const getFlag = async (address: string): Promise<Flag> => {
	const [record] = await db
		.select()
		.from(userFlags)
		.where(eq(userFlags.address, address))
		.limit(1);
	return record?.flag ?? 'margherita';
};

export const getFeatures = async (address: string): Promise<Feature[]> =>
	FLAG_FEATURES[await getFlag(address)];

/** Middleware: require the authenticated user's flag to grant `feature`. Runs
 * after {@link requireAuth}, reading `event.context.claim`. */
export const requireFeature = (feature: Feature) =>
	defineMiddleware(async (event) => {
		const features = await getFeatures(event.context.claim?.address || '');
		if (!features.includes(feature)) {
			throw new HTTPError({
				status: 403,
				message: `${feature} feature is not enabled for your account`,
			});
		}
	});
