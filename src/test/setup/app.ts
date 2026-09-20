/**
 * How the tests drive the app: somebody signed in on one side, a relay to talk
 * to on the other.
 *
 * Loaded as a setup file, so the hooks below apply to every flow — each test
 * starts with an empty device, nobody signed in, and a quiet console. A device
 * is per-test because that is what a device is: somebody opening the app for
 * the first time. The relay's database is not, and is never emptied — tests are
 * independent because each one signs up its own people and asserts about those
 * people, not because it got the world to itself.
 *
 * The relay itself is already running, served once for the whole run by
 * {@link file://./global.ts}. Requests go to it over HTTP, through the
 * same `serve()` the relay boots with, so they pass the whole stack: CORS,
 * routing, auth middleware, zod validation, the handlers, and the error
 * formatter. Logging in runs the genuine handshake against a genuine key pair:
 * a fabricated token would only test the test.
 */

import {
	cleanup,
	renderHook,
	waitFor as waitForRender,
} from '@testing-library/react';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { type H3, serve } from 'h3';
import { fetch as nodeFetch } from 'node-fetch-native/node';
import { ofetch } from 'ofetch';
import { afterEach, beforeEach, expect, vi } from 'vitest';
import { deviceIdFor, db as local, type StoredMessage } from '@/client/db';
import { env } from '@/client/env';
import { authState } from '@/client/services/auth';
import {
	type ConversationSummary,
	clearLocalKeyCache,
} from '@/client/services/chat';
import type { Identity } from '@/shared/auth';
import { openSeal } from '@/shared/crypto.ts';
import { bytesToBase58 } from '@/shared/encoding.ts';
import { generateMnemonic } from '@/shared/mnemonic';
import type {
	ChallengeResponse,
	Message,
	VerifyResponse,
} from '@/shared/protocol.ts';
import { testIdentity } from './crypto.ts';

// --- talking to the relay ---------------------------------------------------

/**
 * The same client the app talks to the relay with, configured for tests: bodies
 * and responses are JSON without anyone spelling it out, and a non-JSON body
 * (the HTML page a redirect carries) comes back as text on its own.
 *
 * Two settings differ from the app's, and both matter. An error response is
 * something these tests assert on rather than something to throw, and it's
 * never a reason to retry — the app retries a 500 three times over nine
 * seconds, which would be nine seconds for every test that provokes one.
 *
 * It also goes out through Node rather than the browser-ish `fetch` the flows
 * run under, which logs every non-2xx response it sees — and a good many of
 * these requests are meant to come back 400 or 401. This is the harness, not
 * the app; the app's own requests still go through the browser's.
 *
 * Its `baseURL` is the client's own {@link env}, not a copy of it, so the
 * harness and the app are pointed at one relay rather than two. `globalSetup`
 * serves it there, and refuses to run if it names somewhere it isn't.
 */
const api = ofetch.create(
	{
		baseURL: env.CLIENT_RELAY_URL,
		headers: { 'content-type': 'application/json' },
		ignoreResponseError: true,
		retry: false,
	},
	{ fetch: nodeFetch as unknown as typeof globalThis.fetch },
);

interface CallOptions {
	body?: unknown;
	/** Session token to send as `Bearer`. */
	token?: string;
	signal?: AbortSignal;
	/** Redirects are not followed by default, so a 302 and its `location` are
	 * assertable; pass `'follow'` to see where it lands instead. */
	redirect?: RequestRedirect;
}

/** How long a helper waits for something to happen before calling it a
 * failure. Long enough to absorb a slow machine, short enough that a genuine
 * hang fails while you're still watching. */
const WAIT_BUDGET_MS = 5_000;

/** Make one request against the relay: its status, its parsed body, and its
 * headers — the three things assertions are written against. */
export async function call<T = unknown>(
	method: string,
	path: string,
	{ body, token, signal, redirect = 'manual' }: CallOptions = {},
): Promise<{ status: number; body: T; headers: Headers }> {
	const response = await api.raw<T>(path, {
		method,
		body: body as Record<string, unknown>,
		signal,
		redirect,
		headers: token ? { authorization: `Bearer ${token}` } : undefined,
	});
	return {
		status: response.status,
		// `_data` is what `.raw()` parked the parsed body on.
		body: response._data as T,
		headers: response.headers,
	};
}

/** An identity with a live session, as a logged-in client would hold it. */
interface TestUser extends Identity {
	token: string;
}

/**
 * Ask the relay for a challenge and open it with the private key — everything a
 * client does bar sending the answer back, so a test can tamper with either
 * piece first, or answer it and be logged in.
 */
export async function solveChallenge(
	identity: Identity,
): Promise<{ challengeToken: string; nonce: Uint8Array }> {
	const challenge = await call<ChallengeResponse>('POST', '/auth/challenge', {
		body: { address: identity.address },
	});
	if (challenge.status !== 200) {
		throw new Error(`challenge failed: ${JSON.stringify(challenge.body)}`);
	}
	return {
		challengeToken: challenge.body.challengeToken,
		nonce: await openSeal(identity.keyPair.privateKey, challenge.body.box),
	};
}

/**
 * A handle nobody holds.
 *
 * Handles are exclusive across the whole relay and these tests never give
 * theirs back, so a fixed one would be taken by the time the suite ran a second
 * time. Lowercase letters and digits only, which is all a handle may contain.
 */
export const someHandle = (): string =>
	`h${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** Log in as somebody who already exists, from the device of your choosing.
 * Naming one other than this browser's stands for somebody typing the same words
 * into a different browser, and takes the account from wherever it was. */
export async function logInAs(
	identity: Identity,
	deviceId: string,
	handle?: string,
): Promise<string> {
	const { challengeToken, nonce } = await solveChallenge(identity);

	const verified = await call<VerifyResponse>('POST', '/auth/verify', {
		body: {
			challengeToken,
			response: bytesToBase58(nonce),
			handle,
			deviceId,
			claim: true,
		},
	});
	if (verified.status !== 200) {
		throw new Error(`verify failed: ${JSON.stringify(verified.body)}`);
	}
	return verified.body.token;
}

/** Register and log in a fresh identity, from this browser — so the session it
 * returns is one the app's own engine can go on using. */
export async function login(handle?: string): Promise<TestUser> {
	const identity = await testIdentity();
	const deviceId = await deviceIdFor(identity.address);
	return { ...identity, token: await logInAs(identity, deviceId, handle) };
}

/**
 * Serve a second relay, in this worker's own process, for the few tests that
 * need to reach inside one — to take its subscription away and give it back, or
 * to watch what its handlers decide. Same routes and same database as the
 * shared one; only its address differs.
 *
 * The app is passed in rather than built here, and that matters twice over.
 * This is a setup file, so importing the relay would load `web-push` and the
 * rest before a test file could mock them; and every {@link signUp} resets the
 * module registry, so a relay imported later would be a *different* copy of
 * `messaging.ts` from the one the test holds — serving from one and calling
 * into the other.
 */
export async function serveRelay(app: H3): Promise<{
	url: string;
	close(): Promise<void>;
}> {
	const server = await serve(app, {
		port: 0,
		hostname: '127.0.0.1',
	}).ready();
	// Free port, so the address is only known once it is listening.
	if (!server.url) throw new Error('relay reported no address');
	return { url: server.url, close: () => server.close(true) };
}

/**
 * Poll until `predicate` holds. For assertions that follow a socket closing
 * rather than a response arriving: the relay cleans up on the disconnect, which
 * is not something a request can be awaited on.
 */
export async function waitFor(
	predicate: () => boolean | Promise<boolean>,
	timeoutMs = WAIT_BUDGET_MS,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		if (await predicate()) return;
		if (Date.now() > deadline) throw new Error('timed out waiting');
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
}

// --- reading the message stream --------------------------------------------

interface OpenStream {
	/** Messages received so far, oldest first. */
	received: Message[];
	/** Wait until `count` messages have arrived and return them. */
	take(count: number): Promise<Message[]>;
	/** Disconnect, and wait for the read to unwind. */
	close(): Promise<void>;
}

/** Each `data:` payload in an SSE body. Comment frames — the `connected` hello
 * and the heartbeats — carry no data and are skipped. */
async function* frames(
	body: ReadableStream<Uint8Array>,
): AsyncGenerator<Message> {
	const decoder = new TextDecoder();
	let buffer = '';
	for await (const chunk of body) {
		buffer += decoder.decode(chunk, { stream: true });
		const parts = buffer.split('\n\n');
		buffer = parts.pop() ?? '';
		for (const part of parts) {
			const data = part
				.split('\n')
				.filter((line) => line.startsWith('data:'))
				.map((line) => line.slice(5).trim())
				.join('\n');
			if (data) yield JSON.parse(data) as Message;
		}
	}
}

/** Open `GET /messages` and collect the frames as they arrive — the same
 * framing the client's own reader handles, so what's asserted is what a browser
 * would actually receive. Which device is asking rides in the token. */
export async function openStream(
	token: string,
	baseURL?: string,
): Promise<OpenStream> {
	const controller = new AbortController();
	// `responseType: 'stream'` hands back the raw body instead of buffering and
	// parsing it — the same way the app reads this endpoint.
	const response = await api.raw('/messages', {
		method: 'GET',
		responseType: 'stream',
		// Only when given: passing `undefined` would override the instance's own
		// base URL rather than leave it alone.
		...(baseURL ? { baseURL } : {}),
		headers: { authorization: `Bearer ${token}` },
		signal: controller.signal,
	});
	if (!response.ok || !response._data) {
		throw new Error(`message stream failed: ${response.status}`);
	}

	const received: Message[] = [];
	const reading = (async () => {
		for await (const message of frames(
			response._data as ReadableStream<Uint8Array>,
		)) {
			received.push(message);
		}
	})().catch(() => {
		// Aborted, or the relay hung up: `take` reports it as a timeout.
	});

	return {
		received,
		async take(count) {
			await waitFor(() => received.length >= count);
			return received.slice(0, count);
		},
		async close() {
			controller.abort();
			await reading;
		},
	};
}

/**
 * Put `identity` in the signed-in state the services read from — the same thing
 * a real login ends with, minus the relay round trip.
 *
 * Pass the token from {@link login} whenever the relay is going to be asked to
 * honour the session; the default only has to look like one.
 */
export function signIn(identity: Identity, token = 'test-session'): void {
	authState.set({
		identity,
		session: {
			token,
			expiresAt: Date.now() + 60_000,
			address: identity.address,
		},
	});
}

/**
 * Put a test in charge of the network under the *app's* own requests.
 *
 * `answer` sees every one as `'<METHOD> <path>'` and decides: return nothing and
 * it goes to the real relay, return `'offline'` and it fails as a dropped
 * connection would, or return a `Response` to answer it yourself. So the client
 * stack — ofetch, its retry policy, the SSE reader — runs exactly as it does in
 * the app, and only what is underneath it misbehaves.
 *
 * Undone by the `vi.unstubAllGlobals()` below, so nothing has to remember to.
 * This file's own {@link call} is unaffected: it has its own `fetch`.
 */
export function interceptRelay(
	answer: (route: string) => Response | 'offline' | undefined,
): void {
	const real = globalThis.fetch.bind(globalThis);
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const request = input instanceof Request ? input : null;
			const { pathname } = new URL(String(request ? request.url : input));
			const method = init?.method ?? request?.method ?? 'GET';
			const answered = answer(`${method.toUpperCase()} ${pathname}`);
			if (answered === 'offline') throw new TypeError('network error');
			return answered ?? real(input, init);
		}),
	);
}

export function signOut(): void {
	authState.set({ identity: null, session: null });
}

// --- the Web Locks API ------------------------------------------------------

/**
 * happy-dom has no lock manager, and the sync engine picks the driving tab with
 * one — so without this every copy of the client below would lead.
 *
 * Exclusive by name, granted in order, released when the callback settles,
 * withdrawable while queued: the whole of what the app asks of it.
 */
function installWebLocks(): void {
	type Grant = (lock: unknown) => Promise<unknown>;
	/** The back of each name's queue — whoever asks next waits on it. */
	const tails = new Map<string, Promise<unknown>>();

	const request = async (
		name: string,
		second: LockOptions | Grant,
		third?: Grant,
	): Promise<unknown> => {
		const { signal } = third ? (second as LockOptions) : {};
		const granted = third ?? (second as Grant);

		const ahead = tails.get(name) ?? Promise.resolve();
		let release!: () => void;
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		tails.set(
			name,
			ahead.then(() => held),
		);

		try {
			await (signal
				? Promise.race([
						ahead,
						new Promise<never>((_, reject) => {
							const fail = () =>
								reject(new DOMException('lock request aborted', 'AbortError'));
							if (signal.aborted) fail();
							else signal.addEventListener('abort', fail, { once: true });
						}),
					])
				: ahead);
		} catch (error) {
			// Withdrawn before it was granted — it still has to let go of its place,
			// or everyone behind it waits on a lock nobody holds.
			release();
			throw error;
		}

		try {
			return await granted({ name, mode: 'exclusive' });
		} finally {
			release();
		}
	};

	Object.defineProperty(navigator, 'locks', {
		value: { request } as LockManager,
		configurable: true,
	});
}

installWebLocks();

beforeEach(async () => {
	// `device` too: inheriting the last test's id would be a browser that had been
	// here before, not the fresh one this file promises.
	await Promise.all([
		local.messages.clear(),
		local.auth.clear(),
		local.device.clear(),
	]);
	clearLocalKeyCache();
	// Several tests provoke an error the app is meant to log and carry on from.
	// Capturing it keeps the run's output clean and lets those tests assert the
	// log rather than merely tolerate it.
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
	// The library registers no global cleanup of its own, and a live query left
	// subscribed would go on reading a database the next test has cleared.
	cleanup();
	signOut();
	// Every person a test created has their own engine, still holding a stream
	// open and still draining an outbox. Left running they would pile up across
	// the file and keep working against a database the next test has emptied.
	for (const copy of copies) {
		copy.auth.authState.set({ identity: null, session: null });
	}
	copies.length = 0;
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	// Not covered by either of the above. A test that installs fake timers and
	// fails before restoring them would otherwise leave every test after it on
	// fake time, where the real `setTimeout` these helpers poll with never fires.
	vi.useRealTimers();
});

// --- people ----------------------------------------------------------------

/**
 * An independent copy of the client, as a separate device would run it. The
 * services keep their state in module scope — one `authState`, one sync engine
 * — so a second person needs a second copy of the modules, not a second call
 * into the same ones.
 */
const copies: ClientCopy[] = [];

/**
 * Boot a copy of the client against `storage` — the IndexedDB it will call its
 * own. A device gets one nobody else has; a second tab is handed the one its
 * first tab already uses, which is what makes them tabs.
 *
 * Dexie reads the factory when the database object is constructed, and each copy
 * constructs its own on import, so swapping it around the import is enough.
 * Imported here rather than at the top of the file, where it would load before
 * `fake-indexeddb/auto` and latch on to a global that does not exist yet.
 */
async function bootClient(storage: IDBFactory) {
	vi.resetModules();
	const { default: Dexie } = await import('dexie');
	const shared = Dexie.dependencies.indexedDB;
	Dexie.dependencies.indexedDB = storage;
	const [auth, chat, sync] = await Promise.all([
		import('@/client/services/auth'),
		import('@/client/services/chat'),
		import('@/client/services/sync'),
	]).finally(() => {
		Dexie.dependencies.indexedDB = shared;
	});
	// Idempotent per copy: from here the engine follows this copy's auth state.
	sync.startSync();
	const copy = { auth, chat, sync };
	// Remembered so the teardown below can stop its engine. `signOut` reaches
	// only the copy this file imported, and each of these has its own.
	copies.push(copy);
	return copy;
}

type ClientCopy = { auth: AuthModule; chat: ChatModule; sync: SyncModule };
type AuthModule = typeof import('@/client/services/auth');
type ChatModule = typeof import('@/client/services/chat');
type SyncModule = typeof import('@/client/services/sync');

/** Somebody using the app, and the things a person does with it. */
export interface Person {
	identity: Identity;
	address: string;
	/** Type a message and hit send. Returns as soon as it's queued locally,
	 * which is all the UI waits for. */
	send(to: Person | string, body: string): Promise<void>;
	/** Wait for `body` to show up in their conversation with `peer`, and return
	 * that conversation as the screen would show it. */
	sees(peer: Person | string, body: string): Promise<StoredMessage[]>;
	/** Their conversation with `peer`, oldest first, once it has loaded. */
	conversation(peer: Person | string): Promise<StoredMessage[]>;
	/** Their chat list, freshest first. */
	chats(): Promise<ConversationSummary[]>;
	/** Close the app: the engine stops and the relay sees them go offline. */
	closeApp(): void;
	/** Open it again, and wait until it reports itself connected. */
	openApp(): Promise<void>;
	/** As the settings screen does: not closing the app, and not undone by
	 * opening it again. */
	logOut(): Promise<void>;
	/** Wait until this copy is no longer signed in, however that came about. */
	waitSignedOut(): Promise<void>;
	/** As a second tab: another copy of the client over the database they share.
	 * Signs in as the same person unless given somebody else's words. */
	openTab(mnemonic?: string): Promise<Person>;
}

const addressOf = (who: Person | string) =>
	typeof who === 'string' ? who : who.address;

/** Render one of this copy's hooks and wait for `settled` to hold of it. */
async function read<T>(
	hook: () => T | undefined,
	settled: (value: T | undefined) => boolean,
): Promise<T> {
	const { result } = renderHook(hook);
	// The library waits one second by default, which even a real database can
	// exceed once a message has to cross the relay.
	await waitForRender(() => expect(settled(result.current)).toBe(true), {
		timeout: WAIT_BUDGET_MS,
	});
	return result.current as T;
}

/**
 * Open the app on a copy of the client of its own and sign in with `mnemonic`.
 * A device when it gets its own `storage`, another tab of one when it is handed
 * the storage a tab already has — which is the whole of the difference.
 */
async function openClient(
	mnemonic: string,
	handle?: string,
	storage: IDBFactory = new IDBFactory(),
): Promise<Person> {
	const client: ClientCopy = await bootClient(storage);
	const identity = await client.auth.login({ mnemonic, handle });
	let session = client.auth.authState.state.session;

	const person: Person = {
		identity,
		address: identity.address,
		send: (to, body) =>
			client.chat.enqueueOutgoing(identity, addressOf(to), body),
		conversation: (peer) =>
			read(
				() => client.chat.useMessages(addressOf(peer)),
				(messages) => messages !== undefined,
			),
		sees: (peer, body) =>
			read(
				() => client.chat.useMessages(addressOf(peer)),
				(messages) => Boolean(messages?.some((m) => m.body === body)),
			),
		chats: () =>
			read(
				() => client.chat.useConversations(),
				(summaries) => summaries !== undefined,
			),
		closeApp() {
			session = client.auth.authState.state.session;
			client.auth.authState.set({ identity: null, session: null });
		},
		async openApp() {
			client.auth.authState.set({ identity, session });
			await read(
				() => client.sync.useSyncStatus(),
				(connected) => connected === true,
			);
		},
		openTab: (words = mnemonic) => openClient(words, undefined, storage),
		logOut: () => client.auth.logout(),
		waitSignedOut: () =>
			waitFor(() => client.auth.authState.state.identity === null),
	};
	// Signing in already started the engine; wait until it says so, so a test
	// that sends immediately isn't racing it. A second tab reports the leading
	// tab's connection, having none of its own.
	await read(
		() => client.sync.useSyncStatus(),
		(connected) => connected === true,
	);
	return person;
}

/** Create an account and sign in: twelve words nobody else holds, and everything
 * {@link openClient} does with them. */
export async function signUp(handle?: string): Promise<Person> {
	return openClient(generateMnemonic(), handle);
}
