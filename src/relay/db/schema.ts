import { bigint, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { FLAGS, ROLES } from '@/shared/types';

export const pendingMessages = pgTable(
	'pending_messages',
	{
		id: text('id')
			.primaryKey()
			.$default(() => crypto.randomUUID()),
		sender: text('sender').notNull(),
		recipient: text('recipient').notNull(),
		payload: text('payload').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		index('pending_messages_recipient_idx').on(table.recipient, table.id),
	],
);

export const users = pgTable('users', {
	address: text('address').primaryKey(),
	role: text('role', { enum: ROLES }).notNull().default('user'),
	handle: text('handle').notNull().unique(),
	createdAt: timestamp('created_at', { withTimezone: true })
		.notNull()
		.defaultNow(),
});

export const pushSubscriptions = pgTable('push_subscriptions', {
	address: text('address')
		.primaryKey()
		.references(() => users.address, { onDelete: 'cascade' }),
	subscription: text('subscription').notNull(),
	createdAt: timestamp('created_at', { withTimezone: true })
		.notNull()
		.defaultNow(),
});

export const userFlags = pgTable('user_flags', {
	address: text('address')
		.primaryKey()
		.references(() => users.address, { onDelete: 'cascade' }),
	flag: text('flag', {
		enum: FLAGS,
	}).notNull(),
	createdAt: timestamp('created_at', { withTimezone: true })
		.notNull()
		.defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true })
		.notNull()
		.defaultNow(),
});

// One settled USDT deposit — the sole source of paid-membership truth and the
// idempotency guard. Keyed by the provider's `payment_id`, so a replayed IPN is a
// no-op via `INSERT … ON CONFLICT DO NOTHING`. `grantedMs` is the paid time this
// deposit bought, frozen at the rate in effect when it settled — so paid-until is
// reconstructed by folding a user's deposits (see `paidUntilOf`) and a later
// price change never re-prices past purchases. `amountMicros` is the USDT
// actually received, kept for audit.
export const deposits = pgTable(
	'deposits',
	{
		paymentId: text('payment_id').primaryKey(),
		address: text('address').notNull(),
		amountMicros: bigint('amount_micros', { mode: 'number' }).notNull(),
		grantedMs: bigint('granted_ms', { mode: 'number' }).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [index('deposits_address_idx').on(table.address)],
);

// One row per live SSE connection (a device). Presence across pods is derived
// from these rows: an address is online while at least one recently-touched
// row exists. `createdAt` is stamped at connect and then re-stamped by that
// connection's own heartbeat — it's a "last seen alive" timestamp, not just a
// creation time, so a connection that dies without cleanly closing (crash,
// dropped network, a server restart that wipes the in-memory tracking) still
// ages out quickly instead of leaving its recipient falsely "online".
export const sessions = pgTable(
	'sessions',
	{
		id: text('id')
			.primaryKey()
			.$default(() => crypto.randomUUID()),
		address: text('address').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [index('sessions_address_idx').on(table.address)],
);
