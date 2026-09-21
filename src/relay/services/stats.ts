/**
 * What the relay looks like from outside: counts, and nothing else.
 *
 * Open to anyone who asks, so every number here is one the relay would be happy
 * to put on a status page — how many people are connected, how much mail is
 * waiting, how many accounts exist. No address, no handle, no payload, and
 * nothing that narrows to a person.
 *
 * Every count but the last is the whole relay's, read from the database each
 * pod shares. Uptime is the one thing a pod can only answer for itself.
 */

import { defineHandler } from 'h3';
import { db } from '../db/index.ts';
import { PRESENCE_TTL_MS } from './messaging.ts';

/** `GET /stats` reply. The client has no use for it — it is here to be looked
 * at — so it stays out of the shared protocol. */
export interface StatsResponse {
	/** Message streams being heartbeated right now, across every pod. */
	sessions: number;
	/** Accounts behind them: people, where `sessions` is connections. The two
	 * part company around a reconnect, whose old row outlives it by a sweep. */
	online: number;
	/** Accounts registered, ever. */
	users: number;
	/** Of those, the ones a stranger can be offered. */
	discoverable: number;
	/** Of those, the ones holding a handle. */
	handles: number;
	/** Messages sent and not yet read off the queue. */
	pendingMessages: number;
	/** Devices the relay can nudge with a web push. */
	pushSubscriptions: number;
	/** How long this pod has been up. */
	uptimeSeconds: number;
}

export const getStatsHandler = defineHandler(
	async (): Promise<StatsResponse> => {
		const fresh = new Date(Date.now() - PRESENCE_TTL_MS);

		const [
			[live],
			users,
			discoverable,
			handles,
			pendingMessages,
			pushSubscriptions,
		] = await Promise.all([
			// Both numbers come off the same rows under the same freshness cutoff,
			// so they are read together — separately they could disagree.
			db.$queryRaw<{ sessions: bigint; online: bigint }[]>`
				select count(*) as sessions, count(distinct address) as online
				from sessions
				where created_at > ${fresh}
			`,
			db.user.count(),
			db.user.count({ where: { discoverable: true } }),
			db.user.count({ where: { handle: { not: null } } }),
			db.pendingMessage.count(),
			db.pushSubscription.count(),
		]);

		return {
			// Postgres counts in bigint, which JSON has no notion of — serialising
			// one throws rather than rounding it.
			sessions: Number(live?.sessions ?? 0),
			online: Number(live?.online ?? 0),
			users,
			discoverable,
			handles,
			pendingMessages,
			pushSubscriptions,
			uptimeSeconds: Math.floor(process.uptime()),
		};
	},
);
