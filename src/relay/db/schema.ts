import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
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

// One row per live SSE connection (a device). Presence across pods is derived
// from these rows: an address is online while at least one recent row exists.
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
