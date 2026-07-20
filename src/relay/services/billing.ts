/**
 * Paid membership funded by USDT deposits (via NOWPayments).
 *
 * There is no stored balance and no stored expiry: paid membership is derived
 * entirely from the `deposits` ledger. `POST /billing/deposit` asks NOWPayments to
 * create a payment (passing the user's address as `order_id`) and returns where to
 * send USDT; NOWPayments later calls `POST /billing/ipn`, whose signature the SDK
 * verifies, and the first settled report records one deposit row — its `grantedMs`
 * (paid time bought, frozen at the current rate) alongside the amount. The
 * `payment_id` primary key makes a replayed callback a no-op. `paidUntilOf` then
 * reconstructs "paid until" on demand by folding a user's deposits in order: each
 * extends from whichever is later — the running expiry or the deposit's own time —
 * so a lapse resets the clock exactly as it would have live.
 */

import {
	NowPaymentsSDK,
	toSDKError,
} from '@nowpaymentsio/nowpayments-sdk-nodejs';
import Decimal from 'decimal.js';
import { eq } from 'drizzle-orm';
import { defineHandler, HTTPError, readBody, readValidatedBody } from 'h3';
import { log } from '@/shared/log';
import {
	type CreateDepositResponse,
	createDepositSchema,
} from '@/shared/protocol';
import { config } from '../config.ts';
import { db } from '../db/index.ts';
import { deposits } from '../db/schema.ts';

const MICROS_PER_UNIT = 1_000_000;
const MINUTE_MS = 60_000;

/** Price of paid membership, in micro-USDT per minute (1 USDT = 1_000_000). A
 * deposit buys `amount / rate` minutes of paid time. */
const PAID_RATE_MICROS_PER_MINUTE = 1_000_000; // $1.00 / minute

/** The SDK's normalized status once a payment is settled and forwarded (raw
 * provider status `finished`) — the point at which we extend paid time. */
const SETTLED_STATUS = 'paid';

/** Parse a decimal USDT amount into integer micro-USDT with exact decimal math
 * (no binary float error). Rounds down so a deposit never credits more than was
 * actually received; exact anyway for USDT's 6 decimals. */
const toMicros = (amount: Decimal.Value): number =>
	new Decimal(amount)
		.times(MICROS_PER_UNIT)
		.toDecimalPlaces(0, Decimal.ROUND_DOWN)
		.toNumber();

/** Milliseconds of paid time a deposit of `amountMicros` USDT buys at the current
 * rate. Called once when a payment settles; the result is frozen on the deposit
 * row as `grantedMs`, so a later price change never re-prices it. */
const grantMsFor = (amountMicros: number): number =>
	new Decimal(amountMicros)
		.div(PAID_RATE_MICROS_PER_MINUTE)
		.times(MINUTE_MS)
		.toDecimalPlaces(0, Decimal.ROUND_DOWN)
		.toNumber();

// --- NOWPayments SDK --------------------------------------------------------

let sdk: NowPaymentsSDK | null = null;

/** The shared SDK client, built once from config. Throws 503 when deposits are
 * not configured (no API key / IPN secret / public URL), like push without VAPID. */
const getSdk = (): NowPaymentsSDK => {
	const np = config.nowPayments;
	if (!np) {
		throw new HTTPError({
			status: 503,
			message: 'deposits are not configured',
		});
	}
	if (!sdk) {
		sdk = new NowPaymentsSDK({
			apiKey: np.apiKey,
			ipnSecret: np.ipnSecret,
			baseUrl: np.baseUrl,
			ipnCallbackUrl: new URL('/billing/ipn', np.publicUrl).toString(),
		});
	}
	return sdk;
};

/** Turn an SDK failure into an HTTP error: input problems surface as 4xx to the
 * caller, everything else as a 502 (the provider, not us, is at fault). */
const providerError = (error: unknown): HTTPError => {
	const sdkError = toSDKError(error);
	const status =
		sdkError.type === 'validation'
			? 400
			: sdkError.httpStatus && sdkError.httpStatus < 500
				? sdkError.httpStatus
				: 502;
	return new HTTPError({
		status,
		message: sdkError.message || 'payment provider error',
	});
};

// --- deposits & membership --------------------------------------------------

/** `POST /billing/deposit` — open a deposit and return where to send USDT. */
export const createDepositHandler = defineHandler(async (event) => {
	const address = event.context.claim?.address || '';
	const { amount } = await readValidatedBody(event, createDepositSchema);
	const np = config.nowPayments;
	const client = getSdk();

	let payment: Awaited<ReturnType<NowPaymentsSDK['createDirectPayment']>>;
	try {
		payment = await client.createDirectPayment({
			amount,
			currency: 'usd',
			payCurrency: np?.payCurrency ?? 'usdttrc20',
			// Attribution: the IPN echoes `order_id` back, telling us whose time to extend.
			orderId: address,
			description: 'Paid membership',
			skipPreflight: true,
		});
	} catch (error) {
		throw providerError(error);
	}

	event.res.status = 201;
	return {
		payAddress: payment.pay_address ?? '',
		payAmount: payment.pay_amount != null ? String(payment.pay_amount) : '',
		payCurrency: payment.pay_currency ?? np?.payCurrency ?? 'usdttrc20',
	} satisfies CreateDepositResponse;
});

/** `POST /billing/ipn` — NOWPayments callback. Unauthenticated but verified by
 * HMAC signature; the first settled report extends the buyer's paid time once. */
export const ipnHandler = defineHandler(async (event) => {
	const client = getSdk();
	const body = await readBody<Record<string, unknown>>(event);
	const signature = event.req.headers.get('x-nowpayments-sig') || '';

	if (!body || typeof body !== 'object') {
		throw new HTTPError({ status: 400, message: 'invalid body' });
	}
	if (!client.verifyWebhookSignature(body, signature)) {
		throw new HTTPError({ status: 401, message: 'bad signature' });
	}

	// Signature already checked above, so normalize without re-verifying.
	const parsed = client.parseWebhook(body, signature, { verify: false });
	if (parsed.type !== 'payment.status_changed') return { ok: true };
	const payment = parsed.payment;
	if (payment.status !== SETTLED_STATUS) return { ok: true };

	const paymentId = payment.payment_id ? String(payment.payment_id) : '';
	const address = payment.order_id ? String(payment.order_id) : '';
	const amountMicros = toMicros(
		payment.actually_paid ?? payment.pay_amount ?? 0,
	);
	if (!paymentId || !address || amountMicros <= 0) return { ok: true };

	// Record the deposit with the time it bought, frozen at the current rate. The
	// `payment_id` PK makes a replayed callback a no-op — paid time is never
	// double-counted — and `paidUntilOf` folds these rows on read.
	const grantedMs = grantMsFor(amountMicros);
	const recorded = await db
		.insert(deposits)
		.values({ paymentId, address, amountMicros, grantedMs })
		.onConflictDoNothing()
		.returning({ paymentId: deposits.paymentId });
	if (recorded.length > 0) {
		log(
			'info',
			'deposit recorded',
			address,
			paymentId,
			amountMicros,
			grantedMs,
		);
	}

	return { ok: true };
});

/** Reconstruct the account's paid-until instant by folding its deposits in order:
 * each extends from whichever is later — the running expiry or the deposit's own
 * settlement time — so a lapse resets the clock. Uses each deposit's frozen
 * `grantedMs`, so a later price change never shifts past purchases. Returns null
 * for an account that has never deposited. */
export const paidUntilOf = async (address: string): Promise<Date | null> => {
	const rows = await db
		.select({ createdAt: deposits.createdAt, grantedMs: deposits.grantedMs })
		.from(deposits)
		.where(eq(deposits.address, address))
		.orderBy(deposits.createdAt, deposits.paymentId);
	if (rows.length === 0) return null;
	let expiry = 0;
	for (const row of rows) {
		expiry = Math.max(row.createdAt.getTime(), expiry) + row.grantedMs;
	}
	return new Date(expiry);
};

/** Whether `address` is a paid account right now (`now < paidUntil`). The gate is
 * owner-based: e.g. a handle resolves only while its owner is paid, regardless of
 * who is looking it up. */
export const isPaid = async (address: string): Promise<boolean> => {
	const paidUntil = await paidUntilOf(address);
	return paidUntil !== null && paidUntil > new Date();
};
