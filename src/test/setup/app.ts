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
import { type H3, serve } from 'h3';
import { fetch as nodeFetch } from 'node-fetch-native/node';
import { ofetch } from 'ofetch';
import { afterEach, beforeEach, expect, vi } from 'vitest';
import { db as local, type StoredMessage } from '@/client/db';
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
 * Where the relay is: the same value the client under test reads, resolved the
 * same way it resolves it, so the harness and the app are pointed at one relay
 * rather than two. `globalSetup` serves it there, and refuses to run if this
 * names somewhere it isn't.
 */
const relayUrl = import.meta.env.VITE_RELAY_URL ?? 'http://localhost:5200';

/**
 * The same client the app talks to the relay with, configured for tests: bodies
 * and responses are JSON without anyone spelling it out, and a non-JSON body
 * (the HTML page a redirect carries) comes back as text on its own.
 *
 * Two settings differ from the app's, and both matter. An error response is
 * something these tests assert on rather than something to throw, and it's
 * never a reason to retry — the app's own policy retries a 409 three times over
 * nine seconds, which would be nine seconds per test that checks a conflict.
 *
 * It also goes out through Node rather than the browser-ish `fetch` the flows
 * run under, which logs every non-2xx response it sees — and a good many of
 * these requests are meant to come back 400 or 401. This is the harness, not
 * the app; the app's own requests still go through the browser's.
 */
const api = ofetch.create(
	{
		baseURL: relayUrl,
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

/**
 * Register and log in a fresh identity, doing the real challenge/response: ask
 * for a challenge, open the sealed nonce with the private key, send it back.
 */
export async function login(handle?: string): Promise<TestUser> {
	const identity = await testIdentity();
	const { challengeToken, nonce } = await solveChallenge(identity);

	const verified = await call<VerifyResponse>('POST', '/auth/verify', {
		body: {
			challengeToken,
			response: bytesToBase58(nonce),
			handle,
		},
	});
	if (verified.status !== 200) {
		throw new Error(`verify failed: ${JSON.stringify(verified.body)}`);
	}

	return { ...identity, token: verified.body.token };
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
 * would actually receive. */
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

beforeEach(async () => {
	await Promise.all([local.messages.clear(), local.auth.clear()]);
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

async function bootClient() {
	vi.resetModules();
	const [auth, chat, sync] = await Promise.all([
		import('@/client/services/auth'),
		import('@/client/services/chat'),
		import('@/client/services/sync'),
	]);
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
 * Create an account and sign in — the real thing: twelve words, a key pair
 * derived from them, and the relay's challenge answered with the private key.
 */
export async function signUp(handle?: string): Promise<Person> {
	const client: ClientCopy = await bootClient();
	const identity = await client.auth.login({
		mnemonic: generateMnemonic(),
		handle,
	});
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
	};
	// Signing in already started the engine; wait until it says so, so a test
	// that sends immediately isn't racing the connection.
	await read(
		() => client.sync.useSyncStatus(),
		(connected) => connected === true,
	);
	return person;
}
