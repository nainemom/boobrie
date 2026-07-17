import { eq } from 'drizzle-orm';
import { defineHandler, getValidatedRouterParams, HTTPError } from 'h3';
import { fingerprint } from '@/shared/crypto';
import { type UserResponse, userParamsSchema } from '@/shared/protocol';
import { db } from '../db/index.ts';
import { users } from '../db/schema.ts';

export const getUserHandler = defineHandler(async (event) => {
	const { user } = await getValidatedRouterParams(event, userParamsSchema);

	const column: keyof typeof users = user.startsWith('@')
		? 'handle'
		: 'address';
	const searchValue = column === 'handle' ? user.slice(1).toLowerCase() : user;

	const [record] = await db
		.select()
		.from(users)
		.where(eq(users[column], searchValue))
		.limit(1);

	if (!record) {
		throw new HTTPError({ status: 404, message: 'user not found' });
	}

	return {
		address: record.address,
		handle: record.handle,
		fingerprint: await fingerprint(record.address),
		createdAt: record.createdAt,
	} satisfies UserResponse;
});
