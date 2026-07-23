/**
 * Messaging over Server-Sent Events, fanned out across pods via Postgres
 * LISTEN/NOTIFY.
 *
 * Sending inserts a durable row and announces its id on the `chat` channel;
 * every pod hears the announcement via {@link watchMessages} and, if it holds
 * the recipient's live stream, loads the row and pushes it. Only the id travels
 * over NOTIFY — its payload is capped at 8 KB and a message (a file, say) can
 * exceed that. Queued rows are the durable backstop — replayed on (re)connect
 * and cleared when the client reads them. Presence is derived from the
 * `sessions` table so any pod can answer "is X online?" and decide whether to
 * nudge an offline recipient with a web push.
 *
 * NOTIFY is best-effort: Postgres does not queue it for a disconnected backend,
 * so the listener owns its connection lifecycle — it reconnects, re-LISTENs,
 * and replays the durable queue to every held stream afterwards, since any
 * announcement fired while it was deaf is gone.
 */

import {
	createEventStream,
	defineHandler,
	getValidatedRouterParams,
	readValidatedBody,
} from 'h3';
import { log } from '@/shared/log';
import {
	type Message,
	messageParamsSchema,
	type PresenceResponse,
	presenceParamsSchema,
	type RandomMatchResponse,
	randomMatchSchema,
	sendMessageSchema,
} from '@/shared/protocol';
import { sleep } from '@/shared/utils.ts';
import { type PendingMessage, Prisma } from '../db/generated/client.ts';
import { createListener, db } from '../db/index.ts';
import { notify } from './push.ts';

const CHANNEL = 'chat';
/** How often to nudge each open stream so it flushes and stays visibly alive. */
const HEARTBEAT_MS = 20_000;
/** How long a session counts as "online" without a heartbeat touching it. */
const PRESENCE_TTL_MS = HEARTBEAT_MS * 3;

const connections = new Map<string, ReturnType<typeof createEventStream>>();

const toMessage = (row: PendingMessage): Message => ({
	id: row.id,
	sender: row.sender,
	payload: row.payload,
	createdAt: row.createdAt.toISOString(),
});

/** True while address has at least 1 recently-heartbeated session on some pod. */
const isOnline = async (address: string): Promise<boolean> => {
	const fresh = new Date(Date.now() - PRESENCE_TTL_MS);
	const row = await db.session.findFirst({
		where: { address, createdAt: { gt: fresh } },
		select: { id: true },
	});
	return Boolean(row);
};

/** Announce a message id on the `chat` channel so the recipient's pod loads and
 * delivers it. Only the id travels — NOTIFY payloads are capped at 8 KB. */
const announce = async (recipient: string, id: string): Promise<void> => {
	await db.$executeRaw`select pg_notify(${CHANNEL}, ${JSON.stringify({ recipient, id })})`;
};

/** Nudge an offline recipient with a web push (best-effort). */
const nudge = async (recipient: string, message: Message): Promise<void> => {
	if (await isOnline(recipient)) return;
	await notify(recipient, {
		type: 'message',
		from: message.sender,
		id: message.id,
	});
};

const handleNotification = async (msg: {
	channel: string;
	payload?: string;
}): Promise<void> => {
	if (msg.channel !== CHANNEL || !msg.payload) return;
	let announced: { recipient: string; id: string };
	try {
		announced = JSON.parse(msg.payload);
	} catch {
		return;
	}
	const stream = connections.get(announced.recipient);
	if (!stream) return;

	// Only the id was announced; load the row now (it may already be gone if the
	// recipient read it via another path — that's fine, we just skip).
	const row = await db.pendingMessage.findFirst({
		where: { id: announced.id, recipient: announced.recipient },
	});
	if (!row) return;

	try {
		await stream.push(JSON.stringify(toMessage(row)));
	} catch {
		// The stream may have just closed; the row stays queued as the backstop.
	}
};

const deliverQueued = async (address: string): Promise<void> => {
	const stream = connections.get(address);
	if (!stream) return;
	const queued = await db.pendingMessage.findMany({
		where: { recipient: address },
		orderBy: { createdAt: 'asc' },
	});
	for (const row of queued) {
		await stream.push(JSON.stringify(toMessage(row)));
	}
};

/** Replay the durable queue to every stream this pod holds. Runs after each
 * (re)connect, because NOTIFYs fired while the listener was down are lost. */
const resyncAll = async (): Promise<void> => {
	await Promise.all([...connections.keys()].map(deliverQueued));
};

let listener: ReturnType<typeof createListener> | null = null;
let reconnecting = false;

const openListener = async (): Promise<void> => {
	const client = createListener();
	// Attach handlers before connecting so no early notification is dropped, and
	// so a connection error is caught rather than crashing the process.
	client.on('notification', handleNotification);
	client.on('error', (err) => log('error', 'chat listener error', err));
	client.on('end', () => {
		if (listener !== client) return;
		listener = null;
		log('warn', 'chat listener disconnected; reconnecting');
		void keepListening();
	});

	try {
		await client.connect();
		await client.query(`LISTEN ${CHANNEL}`);
	} catch (err) {
		await client.end().catch(() => {});
		throw err;
	}

	listener = client;
	await resyncAll();
};

/** Keep a live `LISTEN chat` connection, retrying with backoff. Idempotent: a
 * reconnect already in flight is a no-op. */
const keepListening = async (): Promise<void> => {
	if (reconnecting) return;
	reconnecting = true;
	try {
		while (!listener) {
			try {
				await openListener();
				log('info', 'chat listener connected');
			} catch (err) {
				log('warn', 'chat listener connect failed; retrying', err);
				await sleep(2000);
			}
		}
	} finally {
		reconnecting = false;
	}
};

/** Establish (and thereafter maintain) the cross-pod `chat` subscription. */
export const watchMessages = async (): Promise<void> => {
	await keepListening();
};

export const streamMessagesHandler = defineHandler(async (event) => {
	const address = event.context.claim?.address || '';
	const stream = createEventStream(event);

	// One live stream per address on this pod: retire any predecessor first.
	while (connections.has(address)) {
		await connections.get(address)?.close();
		await sleep(500);
	}

	connections.set(address, stream);
	const session = await db.session.create({
		data: { address },
		select: { id: true },
	});

	void stream.pushComment('connected');
	const heartbeat = setInterval(() => {
		void stream.pushComment('ping');
		db.session
			.update({ where: { id: session.id }, data: { createdAt: new Date() } })
			.catch((err) =>
				log('warn', 'session heartbeat touch failed', address, err),
			);
	}, HEARTBEAT_MS);

	stream.onClosed(async () => {
		clearInterval(heartbeat);
		connections.delete(address);
		await db.session.deleteMany({ where: { id: session.id } });
	});

	void deliverQueued(address);

	return stream.send();
});

export const sendMessageHandler = defineHandler(async (event) => {
	const sender = event.context.claim?.address || '';
	const { recipient, payload } = await readValidatedBody(
		event,
		sendMessageSchema,
	);

	const row = await db.pendingMessage.create({
		data: { sender, recipient, payload },
	});
	const message = toMessage(row);

	await announce(recipient, message.id);
	void nudge(recipient, message).catch((err) =>
		log('warn', 'push notify failed', recipient, err),
	);

	event.res.status = 201;
	return message;
});

export const readMessageHandler = defineHandler(async (event) => {
	const address = event.context.claim?.address || '';
	const { id } = await getValidatedRouterParams(event, messageParamsSchema);

	await db.pendingMessage.deleteMany({ where: { recipient: address, id } });
	event.res.status = 204;
	return null;
});

export const presenceHandler = defineHandler(async (event) => {
	const { address } = await getValidatedRouterParams(
		event,
		presenceParamsSchema,
	);
	return {
		address,
		online: await isOnline(address),
	} satisfies PresenceResponse;
});

export const randomMatchHandler = defineHandler(async (event) => {
	const self = event.context.claim?.address || '';
	const { exclude } = await readValidatedBody(event, randomMatchSchema);

	const fresh = new Date(Date.now() - PRESENCE_TTL_MS);
	const excluded = Prisma.join([self, ...exclude]);
	const [row] = await db.$queryRaw<{ address: string }[]>`
		select s.address
		from sessions s
		inner join users u on u.address = s.address
		where s.created_at > ${fresh}
			and u.discoverable = true
			and s.address not in (${excluded})
		group by s.address
		order by random()
		limit 1
	`;

	return { address: row?.address ?? null } satisfies RandomMatchResponse;
});
