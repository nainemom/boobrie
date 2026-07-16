import {
	bigserial,
	index,
	pgTable,
	primaryKey,
	text,
	timestamp,
} from 'drizzle-orm/pg-core';
import { FLAGS, ROLES } from '@/shared/types';

export const pendingMessages = pgTable(
	'pending_messages',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		recipient: text('recipient').notNull(),
		sender: text('sender').notNull(),
		messageId: text('message_id').notNull(),
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

export const userFlags = pgTable(
	'user_flags',
	{
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
	},
	(table) => [primaryKey({ columns: [table.address, table.flag] })],
);
