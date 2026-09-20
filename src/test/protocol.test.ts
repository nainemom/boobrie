/**
 * The rules both sides hold each other to.
 *
 * These schemas are the one place the client and the relay agree, so what
 * matters is that a handle the client offers is one the relay accepts, and that
 * a malformed request is turned away here rather than reaching a handler.
 * Checked directly, and in both runtimes, for the same reason as the security
 * flow next door.
 */

import { describe, expect, it } from 'vitest';
import { RESERVED_HANDLES } from '@/shared/constants.ts';
import {
	challengeSchema,
	editDiscoverableSchema,
	handleSchema,
	pushSubscriptionSchema,
	randomMatchSchema,
	sendMessageSchema,
	verifySchema,
} from '@/shared/protocol.ts';

describe('what makes a usable handle', () => {
	it.each(['amir', 'a', 'user123', 'a_b', 'a-b', 'one-two_three', '0'])(
		'accepts %j',
		(handle) => {
			expect(handleSchema.parse(handle)).toBe(handle);
		},
	);

	it.each([
		['Amir', 'uppercase'],
		['-amir', 'leading delimiter'],
		['amir-', 'trailing delimiter'],
		['_amir', 'leading underscore'],
		['a--b', 'consecutive delimiters'],
		['a__b', 'consecutive underscores'],
		['a-_b', 'mixed consecutive delimiters'],
		['a b', 'inner space'],
		['a.b', 'dot'],
		['امیر', 'non-ascii'],
		['', 'empty'],
	])('rejects %j (%s)', (handle) => {
		expect(handleSchema.safeParse(handle).success).toBe(false);
	});

	it('trims before validating, so a pasted handle still works', () => {
		expect(handleSchema.parse('  amir  ')).toBe('amir');
	});

	it('rejects every reserved handle', () => {
		for (const reserved of RESERVED_HANDLES) {
			expect(handleSchema.safeParse(reserved).success).toBe(false);
		}
	});

	it('allows a reserved word as part of a longer handle', () => {
		expect(handleSchema.parse('admin-tools')).toBe('admin-tools');
	});
});

describe('what the relay will not accept', () => {
	it('requires an address to ask for a challenge', () => {
		expect(challengeSchema.safeParse({ address: 'abc' }).success).toBe(true);
		expect(challengeSchema.safeParse({ address: '' }).success).toBe(false);
		expect(challengeSchema.safeParse({}).success).toBe(false);
	});

	it('requires both halves of the challenge response, and a device', () => {
		const valid = { challengeToken: 't', response: 'r', deviceId: 'd' };
		// Off unless asked for: a device that does not say it is logging in must not
		// take the account off whoever has it.
		expect(verifySchema.parse(valid)).toEqual({ ...valid, claim: false });
		// A handle is optional on verify — it's only passed on first login.
		expect(verifySchema.parse({ ...valid, handle: 'amir' }).handle).toBe(
			'amir',
		);
		expect(verifySchema.safeParse({ ...valid, handle: 'Amir' }).success).toBe(
			false,
		);
		expect(
			verifySchema.safeParse({ challengeToken: 't', deviceId: 'd' }).success,
		).toBe(false);
		expect(
			verifySchema.safeParse({ response: 'r', deviceId: 'd' }).success,
		).toBe(false);
		// Without one the relay could not tell a reconnect from a login.
		expect(
			verifySchema.safeParse({ challengeToken: 't', response: 'r' }).success,
		).toBe(false);
	});

	it('requires a recipient and a payload to send a message', () => {
		expect(
			sendMessageSchema.parse({ recipient: 'bob', payload: '{}' }),
		).toEqual({ recipient: 'bob', payload: '{}' });
		expect(
			sendMessageSchema.safeParse({ recipient: 'bob', payload: '' }).success,
		).toBe(false);
		expect(sendMessageSchema.safeParse({ payload: '{}' }).success).toBe(false);
	});

	it('defaults the random-match exclusion list to empty', () => {
		expect(randomMatchSchema.parse({}).exclude).toEqual([]);
		expect(randomMatchSchema.parse({ exclude: ['a'] }).exclude).toEqual(['a']);
		expect(randomMatchSchema.safeParse({ exclude: 'a' }).success).toBe(false);
	});

	it('takes a discoverable flag as a boolean only', () => {
		expect(editDiscoverableSchema.parse({ discoverable: false })).toEqual({
			discoverable: false,
		});
		expect(
			editDiscoverableSchema.safeParse({ discoverable: 'yes' }).success,
		).toBe(false);
	});

	it('accepts a browser push subscription, or null to unregister', () => {
		const subscription = {
			endpoint: 'https://push.example/abc',
			keys: { p256dh: 'p', auth: 'a' },
		};
		expect(pushSubscriptionSchema.parse(subscription)).toEqual(subscription);
		expect(pushSubscriptionSchema.parse(null)).toBeNull();
		// A subscription without its keys can't be encrypted to — reject it here
		// rather than fail later inside web-push.
		expect(
			pushSubscriptionSchema.safeParse({ endpoint: 'https://push.example/abc' })
				.success,
		).toBe(false);
		expect(
			pushSubscriptionSchema.safeParse({
				...subscription,
				keys: { p256dh: '', auth: 'a' },
			}).success,
		).toBe(false);
	});
});
