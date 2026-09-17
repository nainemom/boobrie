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
 * `sessions` table so any pod can answer "is X online?" — enough to decide
 * whether a recipient needs nudging with a web push, and who is around to be
 * offered to a stranger. The table holds live connections and nothing else: a
 * stream deletes its own row on the way out, and {@link sweepSessions} clears
 * what a pod that died without getting that far left behind.
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
	onDispose,
	readValidatedBody,
} from 'h3';
import { log } from '@/shared/log';
import {
	type Message,
	messageParamsSchema,
	type RandomMatchResponse,
	randomMatchSchema,
	sendMessageSchema,
} from '@/shared/protocol';
import { sleep } from '@/shared/utils.ts';
import { type PendingMessage, Prisma } from '../db/generated/client.ts';
import { createListener, db } from '../db/index.ts';
import { env } from '../env.ts';
import { notify } from './push.ts';

const CHANNEL = 'chat';
/** How long a session counts as "online" without a heartbeat touching it. */
const PRESENCE_TTL_MS = env.RELAY_HEARTBEAT_MS * 3;

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

/**
 * Delete every connection record nothing is heartbeating any more.
 *
 * A stream that closes cleanly takes its own row with it, so what this finds is
 * what a pod that went down hard — crashed, killed, partitioned away — left
 * behind. Presence tolerates those rows already, being a freshness check rather
 * than a lookup; this is what keeps the table from carrying one for every pod
 * that ever died, so what it holds is the connections that actually exist.
 */
export const sweepSessions = async (): Promise<void> => {
	await db.session.deleteMany({
		where: { createdAt: { lt: new Date(Date.now() - PRESENCE_TTL_MS) } },
	});
};

let sweeper: ReturnType<typeof setInterval> | null = null;

/** Sweep now, then every TTL. Sweeping faster would find nothing — a row isn't
 * dead until it has aged out of the presence window — and sweeping slower would
 * leave rows lying about for longer than the relay ever believes them. Runs on
 * every pod: the delete is a no-op for anyone who gets there second. */
const startSweeping = (): void => {
	// Idempotent, like `keepListening`: a second `watchMessages` must not leave a
	// timer behind that `stopWatching` has no handle on.
	if (sweeper) return;
	const run = () =>
		void sweepSessions().catch((err) =>
			log('warn', 'session sweep failed', err),
		);
	sweeper = setInterval(run, PRESENCE_TTL_MS);
	run();
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
/** The reconnect loop, while one is running. Held rather than merely flagged so
 * {@link stopWatching} can wait for it: a connect that finishes after a stop
 * was asked for would otherwise install a client nobody holds a handle on. */
let listening: Promise<void> | null = null;
let stopped = false;

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

	// A stop may have been asked for while the connect was in flight. Nothing
	// would ever close this client if it were kept — `stopWatching` had already
	// looked and found none — and a live one holds the process open for good.
	if (stopped) {
		await client.end().catch(() => {});
		return;
	}

	listener = client;
	await resyncAll();
};

/** Keep a live `LISTEN chat` connection, retrying with backoff. Idempotent: a
 * reconnect already in flight is returned rather than started again, so every
 * caller — and a stop — waits on the same attempt. */
const keepListening = (): Promise<void> => {
	if (listening) return listening;
	const loop = async (): Promise<void> => {
		while (!listener && !stopped) {
			try {
				await openListener();
				// Not if the connect was thrown away by a stop that landed mid-flight.
				if (listener) log('info', 'chat listener connected');
			} catch (err) {
				log('warn', 'chat listener connect failed; retrying', err);
				await sleep(2000);
			}
		}
	};
	// Cleared through the chained `finally`, which runs in a microtask — so it
	// cannot clear the slot before the assignment below fills it, as it would if
	// the loop ran to completion without ever awaiting.
	const running = loop().finally(() => {
		if (listening === running) listening = null;
	});
	listening = running;
	return running;
};

/** Establish (and thereafter maintain) the cross-pod `chat` subscription, and
 * start sweeping dead connection records. */
export const watchMessages = async (): Promise<void> => {
	stopped = false;
	startSweeping();
	await keepListening();
};

/** Give up the subscription and close its connection, without the reconnect
 * that a connection dropping on its own would trigger. The one thing holding
 * the process open once the server has stopped listening, so shutting down
 * cleanly — or handing the process back to a test runner — needs it. */
export const stopWatching = async (): Promise<void> => {
	stopped = true;
	if (sweeper) clearInterval(sweeper);
	sweeper = null;
	// Before looking at `listener`: a reconnect in flight is about to set it, and
	// it checks `stopped` on the way through, so waiting here is what makes the
	// look below conclusive.
	await listening;
	const client = listener;
	// Cleared first, so the `end` handler sees a client that is no longer the
	// current one and doesn't try to reconnect it.
	listener = null;
	await client?.end().catch(() => {});
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
		// An upsert rather than an update, so that a row the sweeper took while
		// this connection was merely slow to report in costs one heartbeat rather
		// than the rest of the session: the next tick puts it back under the same
		// id, and nothing downstream can tell.
		db.session
			.upsert({
				where: { id: session.id },
				create: { id: session.id, address },
				update: { createdAt: new Date() },
			})
			.catch((err) =>
				log('warn', 'session heartbeat touch failed', address, err),
			);
	}, env.RELAY_HEARTBEAT_MS);

	onDispose(event, async () => {
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
