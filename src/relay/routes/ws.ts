import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { log } from '@/shared/log';
import type { ClientMsg, ServerMsg } from '@/shared/protocol';
import {
	type EncryptedPayload,
	type Feature,
	FLAG_FEATURES,
	type Flag,
	type PushSubscriptionJson,
} from '@/shared/types';
import { db } from '../db/index.ts';
import { pendingMessages, userFlags } from '../db/schema.ts';
import { isOnline, register, sendTo, unregister } from '../hub.ts';
import {
	deleteSubscription,
	notify,
	saveSubscription,
	vapidPublicKey,
} from '../push.ts';

// The gate stashes the verified address here for the handler to read.
declare module 'fastify' {
	interface FastifyRequest {
		authAddress?: string;
	}
}

interface WsQuery {
	token?: string;
}

function send(socket: WebSocket, msg: ServerMsg): void {
	socket.send(JSON.stringify(msg));
}

async function getFeaturesForUser(address: string): Promise<Feature[]> {
	const userFlagRecords = await db
		.select()
		.from(userFlags)
		.where(eq(userFlags.address, address));

	const flags =
		userFlagRecords.length > 0 ? userFlagRecords.map((r) => r.flag) : ['free'];
	const featuresSet = new Set<Feature>();
	for (const flag of flags) {
		const flagFeatures = FLAG_FEATURES[flag as Flag] || [];
		for (const f of flagFeatures) {
			featuresSet.add(f);
		}
	}
	return Array.from(featuresSet);
}

function isEncryptedPayload(value: unknown): value is EncryptedPayload {
	if (typeof value !== 'object' || value === null) return false;
	const p = value as Record<string, unknown>;
	return typeof p.iv === 'string' && typeof p.ct === 'string';
}

/** Parse a text frame into a known {@link ClientMsg}, or null if it is malformed. */
function parseClientMsg(raw: string): ClientMsg | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (typeof parsed !== 'object' || parsed === null) return null;
	const m = parsed as Record<string, unknown>;
	switch (m.t) {
		case 'msg':
			return typeof m.to === 'string' &&
				m.to !== '' &&
				typeof m.id === 'string' &&
				m.id !== '' &&
				isEncryptedPayload(m.enc)
				? { t: 'msg', to: m.to, id: m.id, enc: m.enc }
				: null;
		case 'ack':
			return typeof m.id === 'string' && m.id !== ''
				? { t: 'ack', id: m.id }
				: null;
		case 'probe':
			return typeof m.address === 'string' && m.address !== ''
				? { t: 'probe', address: m.address }
				: null;
		case 'push':
			return typeof m.subscription === 'object' && m.subscription !== null
				? { t: 'push', subscription: m.subscription as PushSubscriptionJson }
				: null;
		case 'unpush':
			return { t: 'unpush' };
		default:
			return null;
	}
}

/** Replay everything still queued for `address`, oldest first. Delivery is
 * ack-driven, so we only read here — rows are cleared when their acks arrive. */
async function flushPending(socket: WebSocket, address: string): Promise<void> {
	const queued = await db
		.select()
		.from(pendingMessages)
		.where(eq(pendingMessages.recipient, address))
		.orderBy(asc(pendingMessages.id));
	for (const row of queued) {
		send(socket, {
			t: 'msg',
			from: row.sender,
			id: row.messageId,
			enc: JSON.parse(row.payload) as EncryptedPayload,
		});
	}
}

async function handleMessage(
	socket: WebSocket,
	address: string,
	raw: string,
): Promise<void> {
	const msg = parseClientMsg(raw);
	if (!msg) {
		send(socket, {
			t: 'error',
			code: 'bad-request',
			message: 'unrecognized message',
		});
		return;
	}

	switch (msg.t) {
		case 'msg': {
			// `from` is the authenticated socket, never a client-supplied value.
			const features = await getFeaturesForUser(address);
			if (!features.includes('message')) {
				send(socket, {
					t: 'error',
					code: 'unauthorized',
					message: 'direct messages are not enabled for your account',
				});
				break;
			}
			// Store first (the delivery guarantee), then hand off if online.
			await db.insert(pendingMessages).values({
				recipient: msg.to,
				sender: address,
				messageId: msg.id,
				payload: JSON.stringify(msg.enc),
			});
			const delivered = sendTo(msg.to, {
				t: 'msg',
				from: address,
				id: msg.id,
				enc: msg.enc,
			});
			if (!delivered) {
				const recipientFeatures = await getFeaturesForUser(msg.to);
				if (recipientFeatures.includes('notifications')) {
					void notify(msg.to, {
						type: 'message',
						from: address,
						id: msg.id,
					}).catch((err) => log('warn', 'push notify failed', msg.to, err));
				}
			}
			break;
		}
		case 'ack': {
			// The recipient has it — drop our stored copy.
			await db
				.delete(pendingMessages)
				.where(
					and(
						eq(pendingMessages.recipient, address),
						eq(pendingMessages.messageId, msg.id),
					),
				);
			break;
		}
		case 'probe': {
			send(socket, {
				t: 'presence',
				address: msg.address,
				online: isOnline(msg.address),
			});
			break;
		}
		case 'push': {
			const features = await getFeaturesForUser(address);
			if (!features.includes('notifications')) {
				send(socket, {
					t: 'error',
					code: 'unauthorized',
					message: 'push notifications are not enabled for your account tier',
				});
				break;
			}
			// Replace this address's single push target with the caller's device.
			await saveSubscription(address, msg.subscription);
			log('info', 'ws push subscription registered', address);
			break;
		}
		case 'unpush': {
			await deleteSubscription(address);
			log('info', 'ws push subscription removed', address);
			break;
		}
	}
}

export async function wsRoutes(app: FastifyInstance): Promise<void> {
	app.get<{ Querystring: WsQuery }>(
		'/ws',
		{
			websocket: true,
			preValidation: async (req, reply) => {
				try {
					const claims = app.jwt.verify<{ address?: string }>(
						req.query.token ?? '',
					);
					if (!claims.address) throw new Error('token has no address');
					req.authAddress = claims.address;
				} catch {
					await reply.code(401).send({ error: 'unauthorized' });
				}
			},
		},
		(socket, req) => {
			const address = req.authAddress ?? '';
			log('info', 'ws connected', address);

			register(address, socket);
			send(socket, {
				t: 'ready',
				address,
				vapidPublicKey: vapidPublicKey() ?? undefined,
			});
			// Deliver anything that piled up while this address was offline.
			void flushPending(socket, address).catch((err) =>
				log('error', 'ws flush failed', address, err),
			);

			socket.on('message', (raw) => {
				void handleMessage(socket, address, raw.toString()).catch((err) => {
					log('error', 'ws message failed', address, err);
					send(socket, {
						t: 'error',
						code: 'bad-request',
						message: 'could not process message',
					});
				});
			});

			socket.on('close', () => {
				unregister(address, socket);
				log('info', 'ws disconnected', address);
			});
		},
	);
}
