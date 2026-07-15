import {
	bigserial,
	index,
	pgTable,
	text,
	timestamp,
} from 'drizzle-orm/pg-core';

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

// export const pushSubscriptions = pgTable(
// 	'push_subscriptions',
// 	{
// 		id: bigserial('id', { mode: 'number' }).primaryKey(),
// 		address: text('address')
// 			.notNull()
// 			.references(() => users.address, { onDelete: 'cascade' }),
// 		subscription: text('subscription').notNull(),
// 		createdAt: timestamp('created_at', { withTimezone: true })
// 			.notNull()
// 			.defaultNow(),
// 	},
// 	(table) => [index('push_subscriptions_address_idx').on(table.address)],
// );

export const users = pgTable('users', {
	address: text('address').primaryKey(),
	createdAt: timestamp('created_at', { withTimezone: true })
		.notNull()
		.defaultNow(),
});
