/**
 * Losing the connection and getting it back.
 *
 * Nothing here is stubbed but the network itself. The engine talks to the real
 * relay over a real stream, and where a test needs a failure it takes the
 * network away underneath ({@link interceptRelay}) rather than replacing the
 * module that uses it — so what is under test is the engine's conduct through
 * the whole client stack: it follows the session, it never loses a message it
 * could not send, and it says out loud whether it is connected.
 *
 * Two things are worth knowing about how the failures are staged. A route that
 * is *refused* answers 400, which the client does not retry, so the failure
 * lands at once instead of after nine seconds of trying. And a stream already
 * open cannot be cut by refusing anything — it is dropped the way the relay
 * really drops one, by connecting again as the same person.
 */

import { renderHook } from '@testing-library/react';
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vitest';
import {
	authState,
	restore,
	login as signIntoApp,
} from '@/client/services/auth';
import { enqueueOutgoing, getPendingOutgoing } from '@/client/services/chat';
import { startSync, useSyncStatus } from '@/client/services/sync';
import { createRetryingTask } from '@/client/utils/retryingTask';
import { closeDb, db } from '@/relay/db/index.ts';
import { generateMnemonic } from '@/shared/mnemonic';
import { sleep } from '@/shared/utils.ts';
import {
	call,
	interceptRelay,
	logInAs,
	login,
	openStream,
	signIn,
	signOut,
	waitFor,
} from '@/test/setup/app';

// Asserting against the relay's database gave this worker a pool of its own, and
// the global teardown that closes the relay's runs in another process. The pool
// reclaims idle sockets by itself, so this is tidiness rather than a leak fixed.
afterAll(closeDb);

/** How the network is treating a route, as `'<METHOD> <path>'`. */
const failing = new Map<string, 'offline' | 'refused'>();

const refusal = () =>
	new Response(JSON.stringify({ error: 'refused' }), {
		status: 400,
		headers: { 'content-type': 'application/json' },
	});

/** How many connections the relay is holding for them. */
const connections = (who: { address: string }) =>
	db.session.count({ where: { address: who.address } });

/** The connection record the relay holds for them — a new one every time the
 * stream is reopened, so an unchanged id means it never went away. */
const connectionOf = async (who: { address: string }) =>
	(await db.session.findFirst({ where: { address: who.address } }))?.id;

/** Messages the relay is still holding for them. */
const waitingFor = (who: { address: string }) =>
	db.pendingMessage.count({ where: { recipient: who.address } });

/** Whoever this test signed in, so the teardown can wait for them to go. */
let signedIn: Awaited<ReturnType<typeof login>> | undefined;

/** Sign somebody in for real, and wait until the relay has them. */
async function connect() {
	const user = await login();
	signedIn = user;
	signIn(user, user.token);
	await waitFor(async () => (await connections(user)) > 0);
	return user;
}

beforeAll(() => {
	// Idempotent, and the only entry point: from here the engine follows auth.
	startSync();
});

beforeEach(() => {
	failing.clear();
	interceptRelay((route) => {
		const how = failing.get(route);
		if (how === 'offline') return 'offline';
		if (how === 'refused') return refusal();
	});
});

afterEach(async () => {
	// Before the shared teardown, because the engine has to be seen to stop: one
	// left running would keep draining an outbox into the next test.
	signOut();
	if (signedIn) {
		const user = signedIn;
		signedIn = undefined;
		await waitFor(async () => (await connections(user)) === 0);
	}
});

describe('opening and closing the app', () => {
	it('connects when someone signs in', async () => {
		const user = await connect();
		expect(await connections(user)).toBe(1);
	});

	it('disconnects when they sign out', async () => {
		const user = await connect();
		signOut();
		// The relay learns of it from the socket closing, not from a request.
		await waitFor(async () => (await connections(user)) === 0);
	});

	it('stays connected through a re-authentication', async () => {
		const user = await connect();
		const before = await connectionOf(user);

		// A token refresh hands over a new identity object for the same address;
		// tearing the stream down and back up over that would drop messages.
		signIn({ ...user }, user.token);
		await new Promise((resolve) => setTimeout(resolve, 100));

		expect(await connectionOf(user)).toBe(before);
	});

	it('switches connections when a different account signs in', async () => {
		const first = await connect();
		const second = await connect();

		await waitFor(async () => (await connections(first)) === 0);
		expect(await connections(second)).toBe(1);
	});

	it('sends nothing at all while nobody is signed in', async () => {
		const alice = await login();
		const bob = await login();

		await enqueueOutgoing(alice, bob.address, 'no session');
		await new Promise((resolve) => setTimeout(resolve, 100));

		// Written down, but nothing is running to carry it anywhere.
		expect(await getPendingOutgoing(alice)).toHaveLength(1);
		expect(await waitingFor(bob)).toBe(0);
	});
});

describe('what the app shows about being connected', () => {
	it('follows signing in and out', async () => {
		const rendered = renderHook(() => useSyncStatus());
		expect(rendered.result.current).toBe(false);

		await connect();
		await vi.waitFor(() => expect(rendered.result.current).toBe(true));

		// Signing out is a deliberate disconnect, not an outage — but the badge
		// still has to stop claiming a live connection.
		signOut();
		await vi.waitFor(() => expect(rendered.result.current).toBe(false));
	});

	it('reports a connection dropping, and coming back', async () => {
		const rendered = renderHook(() => useSyncStatus());
		const user = await connect();
		await vi.waitFor(() => expect(rendered.result.current).toBe(true));

		// The relay holds one stream per account, so connecting again retires this
		// one. As *this* device, so it is a reconnect, not the account moving.
		const elsewhere = await openStream(user.token);
		await vi.waitFor(() => expect(rendered.result.current).toBe(false), {
			timeout: 10_000,
		});

		// Nothing prompts the reconnect but the app's own timer, so this is the
		// one wait in the suite with nothing to poll for.
		await elsewhere.close();
		await vi.waitFor(() => expect(rendered.result.current).toBe(true), {
			timeout: 15_000,
		});
		expect(await connections(user)).toBe(1);
	}, 30_000);
});

describe('when the account is signed in on another device', () => {
	// An account is signed in in one place at a time. Logging in moves it without
	// asking anybody, and the device that had it signs itself out.

	/** Not {@link signIn}, which fakes the end state and so has no key to lose. */
	async function signInHere() {
		const identity = await signIntoApp({ mnemonic: generateMnemonic() });
		signedIn = { ...identity, token: authState.state.session?.token ?? '' };
		await waitFor(async () => (await connections(identity)) > 0);
		return identity;
	}

	/** Wait for the app to notice it is no longer the device. */
	const waitSignedOut = () =>
		vi.waitFor(() => expect(authState.state.identity).toBeNull(), {
			timeout: 15_000,
		});

	it('signs the old device out, with nothing asked and nothing offered', async () => {
		const identity = await signInHere();

		// Somebody types the same words into another browser. No prompt either end.
		await logInAs(identity, 'the-new-device');

		await waitSignedOut();
		expect(authState.state.session).toBeNull();
	}, 30_000);

	it('leaves it unable to let itself back in', async () => {
		const identity = await signInHere();
		await logInAs(identity, 'the-new-device');
		await waitSignedOut();

		// The key pair went with the session, so a restore has nothing to use.
		expect(await restore()).toBe(false);
		expect(authState.state.identity).toBeNull();
	}, 30_000);

	it('does not move the account when a device merely restores its session', async () => {
		const identity = await signInHere();
		const before = await connectionOf(identity);

		// If restoring claimed, a device would take the account back on every
		// token refresh.
		expect(await restore()).toBe(true);
		await sleep(500);

		expect(authState.state.identity).not.toBeNull();
		expect(await connectionOf(identity)).toBe(before);
	}, 30_000);

	it('takes the push subscription with it', async () => {
		const identity = await signInHere();
		await db.pushSubscription.upsert({
			where: { address: identity.address },
			create: { address: identity.address, subscription: '{}' },
			update: { subscription: '{}' },
		});

		await logInAs(identity, 'the-new-device');

		// Notifications follow the account; the device that lost it cannot read them.
		await waitFor(
			async () =>
				(await db.pushSubscription.count({
					where: { address: identity.address },
				})) === 0,
		);
	}, 30_000);

	it('will not let the device it displaced go on writing', async () => {
		const identity = await signInHere();
		const bob = await login();
		const displaced = authState.state.session?.token ?? '';

		await logInAs(identity, 'the-new-device');
		await waitSignedOut();

		// The token stays valid for the rest of its hour. Refusing only the stream
		// would leave this device able to send as somebody it is not, and to delete
		// the messages waiting for the one that now holds the account.
		const { status } = await call('POST', '/messages', {
			token: displaced,
			body: { recipient: bob.address, payload: 'from a device that lost it' },
		});
		expect(status).toBe(409);
		expect(await waitingFor(bob)).toBe(0);
	}, 30_000);

	it('leaves what is still in the outbox unsent, and goes anyway', async () => {
		const identity = await signInHere();
		const bob = await login();

		// After the account has moved, so this is not a send racing the handover.
		await logInAs(identity, 'the-new-device');
		await enqueueOutgoing(identity, bob.address, 'typed after the handover');
		await waitSignedOut();

		// Nothing is drained on the way out: the rule above refuses every write this
		// device makes, so waiting for the outbox would be waiting to be refused.
		expect(await waitingFor(bob)).toBe(0);
		expect(await getPendingOutgoing(identity)).toHaveLength(1);
	}, 30_000);
});

describe('when a send fails', () => {
	it('keeps the message, and sends it once the relay will take it', async () => {
		const alice = await connect();
		const bob = await login();

		failing.set('POST /messages', 'refused');
		await enqueueOutgoing(alice, bob.address, 'while the relay says no');
		await vi.waitFor(() =>
			expect(console.error).toHaveBeenCalledWith(
				'Task failed; will retry:',
				expect.any(Error),
			),
		);

		// It stays in the outbox rather than being lost or marked sent.
		expect(await getPendingOutgoing(alice)).toHaveLength(1);
		expect(await waitingFor(bob)).toBe(0);

		// A second message drives the outbox again — and both go out, so the one
		// that failed was never dropped.
		failing.delete('POST /messages');
		await enqueueOutgoing(alice, bob.address, 'and once it will');
		await waitFor(async () => (await waitingFor(bob)) === 2);
		// Polled, not asserted outright: the outbox is cleared one message at a
		// time and each `markSent` runs *after* its send has landed, so the relay
		// holding both is not yet the client having let go of either.
		await waitFor(async () => (await getPendingOutgoing(alice)).length === 0);
	});

	it('carries on when the network goes away entirely', async () => {
		const alice = await connect();
		const bob = await login();

		// Not a refusal this time but a dead socket, which the client does retry —
		// so what matters is only that the message is still there afterwards.
		failing.set('POST /messages', 'offline');
		await enqueueOutgoing(alice, bob.address, 'into the void');
		await new Promise((resolve) => setTimeout(resolve, 200));

		expect(await getPendingOutgoing(alice)).toHaveLength(1);
		expect(await waitingFor(bob)).toBe(0);
	});
});

describe('the driver behind the outbox', () => {
	// Small, but it is what stands between "several things asked for a flush at
	// once" and two flushes racing to send the same message twice — and between
	// "the network was down" and a message sitting in the outbox for good. Its
	// whole behaviour is about timing, so time is controlled here.

	const RETRY_MS = 5000;

	/** A task whose runs a test can hold open and resolve on demand. */
	function controllableTask() {
		const calls: { resolve: () => void; reject: (error: Error) => void }[] = [];
		const task = () =>
			new Promise<void>((resolve, reject) => {
				calls.push({ resolve, reject });
			});
		return {
			task,
			get runs() {
				return calls.length;
			},
			/** Finish the run that is currently in flight. */
			settle: async (outcome: 'resolve' | 'reject' = 'resolve') => {
				const current = calls[calls.length - 1];
				if (outcome === 'resolve') current.resolve();
				else current.reject(new Error('failed'));
				// Let the `.catch`/`.finally` chain inside the driver run.
				await vi.advanceTimersByTimeAsync(0);
			},
		};
	}

	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('runs at once, and coalesces triggers during a run into one more', async () => {
		const controllable = controllableTask();
		const driver = createRetryingTask(controllable.task, RETRY_MS);

		// Synchronously, not on a tick: a queued message shouldn't wait.
		driver.trigger();
		expect(controllable.runs).toBe(1);

		// A reconnect, a new message, and a poll all landing mid-flush: they must
		// not each start their own run, but the work they queued can't be lost
		// either — so exactly one more run follows, and then no more.
		driver.trigger();
		driver.trigger();
		driver.trigger();
		expect(controllable.runs).toBe(1);

		await controllable.settle();
		expect(controllable.runs).toBe(2);
		await controllable.settle();
		expect(controllable.runs).toBe(2);

		// A trigger arriving after the last run finished starts a fresh one.
		driver.trigger();
		expect(controllable.runs).toBe(3);
	});

	it('keeps retrying after the delay until it succeeds', async () => {
		const controllable = controllableTask();
		const driver = createRetryingTask(controllable.task, RETRY_MS);

		driver.trigger();
		await controllable.settle('reject');

		// Nothing happens early — the retry is scheduled, not spun on.
		await vi.advanceTimersByTimeAsync(RETRY_MS - 1);
		expect(controllable.runs).toBe(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(controllable.runs).toBe(2);

		await controllable.settle('reject');
		await vi.advanceTimersByTimeAsync(RETRY_MS);
		expect(controllable.runs).toBe(3);

		// A success ends it: no further retry is pending.
		await controllable.settle();
		await vi.advanceTimersByTimeAsync(RETRY_MS * 3);
		expect(controllable.runs).toBe(3);
	});

	it('schedules only one retry however many failures pile up', async () => {
		const controllable = controllableTask();
		const driver = createRetryingTask(controllable.task, RETRY_MS);

		driver.trigger();
		driver.trigger(); // queued behind the first
		await controllable.settle('reject'); // first fails, schedules a retry
		expect(controllable.runs).toBe(2); // the queued trigger ran straight away
		await controllable.settle('reject'); // and failed too

		// One timer, not two: the retry re-enters through `trigger`, so a second
		// failure while a retry is already pending must not double it up.
		await vi.advanceTimersByTimeAsync(RETRY_MS);
		expect(controllable.runs).toBe(3);
	});

	it('stops a pending retry, and can be used again after', async () => {
		const controllable = controllableTask();
		const driver = createRetryingTask(controllable.task, RETRY_MS);

		driver.trigger();
		await controllable.settle('reject');
		// Signing out while the outbox is failing: the retry must not fire against
		// an account that is no longer signed in.
		driver.stop();
		await vi.advanceTimersByTimeAsync(RETRY_MS * 5);
		expect(controllable.runs).toBe(1);

		// Signing back in triggers it again; stopping is not a shutdown, and
		// stopping when nothing is pending is not an error.
		driver.trigger();
		expect(controllable.runs).toBe(2);
		expect(() => {
			driver.stop();
			driver.stop();
		}).not.toThrow();
	});

	it('does not report failure to the caller', async () => {
		// The driver owns the retrying, so `trigger` is fire-and-forget: an
		// unhandled rejection here would take down whatever called it.
		const driver = createRetryingTask(async () => {
			throw new Error('always fails');
		}, RETRY_MS);

		expect(() => driver.trigger()).not.toThrow();
		await vi.advanceTimersByTimeAsync(0);
		driver.stop();
	});
});
